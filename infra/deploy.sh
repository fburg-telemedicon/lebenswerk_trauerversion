#!/usr/bin/env bash
# ============================================================================
# Lebenswerk – Image bauen/pushen, Web-App + Cron-Jobs deployen/aktualisieren.
# Nach provision.sh und gesetzten Secrets ausführen. Erneut ausführbar für
# Updates (Rollout eines neuen Images).
#
# Erwartete Variablen (aus provision.sh übernehmen):
#   RG, ACR, ACA_ENV, APP, STORAGE, STORAGE_KEY, DATABASE_URL
# Secrets (aus der bisherigen Vercel-Env; siehe MIGRATION.md „Env-Umzug"):
#   AZURE_OPENAI_ENDPOINT/KEY/DEPLOYMENT, AZURE_SPEECH_KEY/REGION,
#   AZURE_FLUX_ENDPOINT/KEY, ADMIN_USERNAME/PASSWORD/ADMIN_TOKEN_SECRET,
#   CRON_SECRET, USD_TO_EUR, RETENTION_DAYS, PUBLIC_BASE_URL, DEMO_BOOK_URL …
# ============================================================================
set -euo pipefail

# az streamt die ACR-Build-Logs; auf Windows (cp1252) crasht das an Unicode-
# Zeichen wie Vites „✓". UTF-8 erzwingen behebt das.
export PYTHONIOENCODING=utf-8

: "${RG:?}" "${ACR:?}" "${ACA_ENV:?}" "${APP:?}" "${STORAGE:?}" "${STORAGE_KEY:?}" "${DATABASE_URL:?}" "${CRON_SECRET:?}"
TAG="${TAG:-$(date +%Y%m%d%H%M%S)}"
IMAGE="${ACR}.azurecr.io/lebenswerk:${TAG}"

if [ "${SKIP_BUILD:-}" = "1" ]; then
  echo ">> Build übersprungen (SKIP_BUILD=1) — nutze vorhandenes Image $IMAGE"
else
  echo ">> Build & Push Image ($IMAGE)"
  # BUILD_CONTEXT erlaubt einen sauberen, kurzen Build-Kontext (z. B. via
  # `git archive` nach C:/azbuild) — nötig auf Windows, weil `az acr build` beim
  # Packen den ganzen Ordner inkl. node_modules durchläuft und die tiefen
  # @azure/*-Pfade sonst das 260-Zeichen-Limit sprengen. Default = aktuelles Verz.
  az acr build -r "$ACR" -t "$IMAGE" -f Dockerfile \
    --build-arg VITE_PUBLIC_ASSET_BASE="${VITE_PUBLIC_ASSET_BASE:-}" "${BUILD_CONTEXT:-.}" -o none
fi

# Gemeinsame Env/Secrets. Secrets als --secrets, Env referenziert sie via secretref.
SECRETS=(
  "database-url=$DATABASE_URL"
  "storage-key=$STORAGE_KEY"
  "cron-secret=$CRON_SECRET"
  "azure-openai-key=${AZURE_OPENAI_KEY:-}"
  "azure-speech-key=${AZURE_SPEECH_KEY:-}"
  "azure-flux-key=${AZURE_FLUX_KEY:-}"
  "admin-password=${ADMIN_PASSWORD:-}"
  "admin-token-secret=${ADMIN_TOKEN_SECRET:-}"
)
ENVVARS=(
  "DATABASE_URL=secretref:database-url"
  "AZURE_STORAGE_ACCOUNT=$STORAGE"
  "AZURE_STORAGE_KEY=secretref:storage-key"
  "CRON_SECRET=secretref:cron-secret"
  "AZURE_OPENAI_KEY=secretref:azure-openai-key"
  "AZURE_SPEECH_KEY=secretref:azure-speech-key"
  "AZURE_FLUX_KEY=secretref:azure-flux-key"
  "ADMIN_PASSWORD=secretref:admin-password"
  "ADMIN_TOKEN_SECRET=secretref:admin-token-secret"
  "AZURE_OPENAI_ENDPOINT=${AZURE_OPENAI_ENDPOINT:-}"
  "AZURE_OPENAI_DEPLOYMENT=${AZURE_OPENAI_DEPLOYMENT:-gpt-4.1}"
  "AZURE_OPENAI_API_VERSION=preview"
  "AZURE_SPEECH_REGION=${AZURE_SPEECH_REGION:-westeurope}"
  "AZURE_FLUX_ENDPOINT=${AZURE_FLUX_ENDPOINT:-}"
  "ADMIN_USERNAME=${ADMIN_USERNAME:-}"
  "USD_TO_EUR=${USD_TO_EUR:-0.92}"
  "RETENTION_DAYS=${RETENTION_DAYS:-90}"
  "PUBLIC_BASE_URL=${PUBLIC_BASE_URL:-}"
  "DEMO_BOOK_URL=${DEMO_BOOK_URL:-}"
  # WICHTIG: interne Selbst-Aufrufe des Generierungs-Workers (triggerWorker +
  # Bild-Endpunkte). Muss auf die EIGENE App-URL zeigen (Ingress-FQDN oder nach
  # Cutover lebensgeschichten.ai) — sonst ruft der Worker die alte Produktion mit
  # nicht passendem ADMIN_TOKEN_SECRET auf → „Nicht autorisiert". Leer ⇒ Code-
  # Default https://lebensgeschichten.ai (erst nach dem DNS-Cutover korrekt).
  "CRON_SELF_BASE_URL=${CRON_SELF_BASE_URL:-}"
)

ACR_USER="$(az acr credential show -n "$ACR" --query username -o tsv)"
ACR_PASS="$(az acr credential show -n "$ACR" --query 'passwords[0].value' -o tsv)"

echo ">> Web-App ($APP) deployen/aktualisieren"
if az containerapp show -g "$RG" -n "$APP" -o none 2>/dev/null; then
  az containerapp registry set -g "$RG" -n "$APP" --server "${ACR}.azurecr.io" --username "$ACR_USER" --password "$ACR_PASS" -o none
  az containerapp secret set -g "$RG" -n "$APP" --secrets "${SECRETS[@]}" -o none
  az containerapp update -g "$RG" -n "$APP" --image "$IMAGE" --set-env-vars "${ENVVARS[@]}" -o none
else
  az containerapp create -g "$RG" -n "$APP" --environment "$ACA_ENV" \
    --image "$IMAGE" --target-port 8080 --ingress external \
    --registry-server "${ACR}.azurecr.io" --registry-username "$ACR_USER" --registry-password "$ACR_PASS" \
    --secrets "${SECRETS[@]}" --env-vars "${ENVVARS[@]}" \
    --min-replicas 1 --max-replicas 3 --cpu 1 --memory 2Gi -o none
fi
echo "   Ingress-URL: $(az containerapp show -g "$RG" -n "$APP" --query properties.configuration.ingress.fqdn -o tsv)"

# --------------------------------------------------------------------------
# Cron-Jobs (ersetzen 3× Vercel-Cron + GitHub-Actions-Purge). Zeiten in UTC.
#   purge            0 3  * * *   (war GitHub Actions)
#   transcript-check 0 22 * * *
#   report           0 23 * * *
#   generate         */10 * * * * (Backstop-Worker; On-demand-Trigger bleibt HTTP)
# --------------------------------------------------------------------------
create_job () {
  local name="$1" schedule="$2" sub="$3"
  echo ">> Cron-Job $name ($schedule)"
  az containerapp job delete -g "$RG" -n "$name" --yes -o none 2>/dev/null || true
  # WICHTIG: Command als getrennte Tokens OHNE führenden Bindestrich (argparse
  # würde z. B. "-c" für eine Option halten) und OHNE Leerzeichen je Token
  # (sonst zerlegt die az.cmd-Kette unter Git-Bash das Argument). Daher direkt
  # `node scripts/cron-run.js <sub>` statt `/bin/sh -c "…"`.
  az containerapp job create -g "$RG" -n "$name" --environment "$ACA_ENV" \
    --trigger-type Schedule --cron-expression "$schedule" \
    --replica-timeout 1800 --replica-retry-limit 1 --parallelism 1 --replica-completion-count 1 \
    --image "$IMAGE" \
    --registry-server "${ACR}.azurecr.io" --registry-username "$ACR_USER" --registry-password "$ACR_PASS" \
    --secrets "${SECRETS[@]}" --env-vars "${ENVVARS[@]}" \
    --cpu 1 --memory 2Gi \
    --command "node" "scripts/cron-run.js" "$sub" -o none
}

create_job "${APP}-cron-purge"      "0 3 * * *"    "purge"
create_job "${APP}-cron-transcript" "0 22 * * *"   "transcript-check"
create_job "${APP}-cron-report"     "0 23 * * *"   "report"
create_job "${APP}-cron-generate"   "*/10 * * * *" "generate"

echo ">> Fertig. Manueller Job-Testlauf z. B.:"
echo "   az containerapp job start -g $RG -n ${APP}-cron-purge --command '/bin/sh' '-c' 'node scripts/cron-run.js purge dry=1'"
