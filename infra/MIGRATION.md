# Migration Supabase + Vercel → Azure

Vollständiges Runbook für den Umzug auf **Azure Container Apps** (Web + Cron-Jobs),
**Azure Database for PostgreSQL Flexible Server** und **Azure Blob Storage**.
Azure OpenAI / Speech / FLUX bleiben unverändert.

> Reihenfolge einhalten. Schritte 1–4 sind gefahrlos vorab machbar; der
> eigentliche **Cutover** (Schritt 7, DNS) schaltet Produktion um.

Ausgangslage im Code (bereits erledigt, auf `main`):
- `api/_lib/store.js` ersetzt `@supabase/supabase-js` (pg + Blob), alle Handler umgestellt.
- `server.js` (Express) bündelt die `/api`-Handler + liefert `dist/`.
- `scripts/cron-run.js` = Entrypoint der Cron-Jobs.
- `Dockerfile`, `db/schema.sql`, `infra/provision.sh`, `infra/deploy.sh`.

---

## 0. Voraussetzungen
- Azure CLI angemeldet: `az login` && `az account set --subscription "<SUB>"`
- Tools lokal: `psql`, `pg_dump` (PostgreSQL 16 Client), `az`, optional `rclone`/`azcopy`.
- Die bisherigen **Vercel-Env-Werte** griffbereit (Azure-OpenAI/Speech/FLUX-Keys,
  ADMIN_*, CRON_SECRET, USD_TO_EUR, RETENTION_DAYS). SUPABASE_URL/SERVICE_KEY werden
  nur noch für den einmaligen Daten-Export gebraucht.

## 1. Ressourcen provisionieren
```bash
export PG_PASSWORD='<starkes-Passwort>'
bash infra/provision.sh
```
Notiere die am Ende ausgegebenen Werte (RG, PG-Host, STORAGE, ACR, ACA_ENV).
Setze anschließend fürs Deploy:
```bash
export RG=lebenswerk-rg ACR=<acr> ACA_ENV=lebenswerk-env APP=lebenswerk-web
export STORAGE=<storage>
export STORAGE_KEY="$(az storage account keys list -g $RG -n $STORAGE --query '[0].value' -o tsv)"
export DATABASE_URL="postgres://lwadmin:${PG_PASSWORD}@<pg>.postgres.database.azure.com:5432/lebenswerk?sslmode=require"
```

## 2. Schema anlegen
```bash
psql "$DATABASE_URL" -f db/schema.sql
```
Prüfen: `psql "$DATABASE_URL" -c '\dt'` → alle Tabellen vorhanden; `\df` → beide
Funktionen (`memorial_contrib_stats`, `rate_limit_hit`).

## 3. Daten migrieren (aus Supabase)
**DB-Daten** (nur unsere Tabellen, data-only; FK-Reihenfolge via replica-Modus):
```bash
SUPA="postgres://postgres:<pw>@db.<ref>.supabase.co:5432/postgres"
pg_dump --data-only --no-owner --no-privileges \
  -t public.app_users -t public.question_catalogs -t public.memorials \
  -t public.contributions -t public.cost_events -t public.generation_jobs \
  -t public.rate_limits -t public.audit_log -t public.report_recipients \
  -t public.job_heartbeats "$SUPA" > /tmp/data.sql

( echo "SET session_replication_role = replica;"; cat /tmp/data.sql ) | psql "$DATABASE_URL"
```
Kontrolle: Zeilenzahlen vergleichen (`select count(*)` je Tabelle) Supabase vs. Azure.

**Storage → Blob.** Privater Bilder-Bucket `memorial-images` (rclone: je ein
Remote für Supabase-S3 und Azure-Blob konfigurieren):
```bash
rclone copy supabase-s3:memorial-images azure-blob:memorial-images --fast-list
```
Öffentliche Einzelassets direkt kopieren:
```bash
curl -sL "https://<ref>.supabase.co/storage/v1/object/public/Demo_books/Gedenkbuch_V2_Ingrid_Wagner_Demo_Druck.pdf" -o demo.pdf
az storage blob upload --account-name "$STORAGE" --account-key "$STORAGE_KEY" \
  -c demo-books -n Gedenkbuch_V2_Ingrid_Wagner_Demo_Druck.pdf -f demo.pdf
curl -sL "https://<ref>.supabase.co/storage/v1/object/public/memorial-videos/Intro_LD.mp4" -o intro.mp4
az storage blob upload --account-name "$STORAGE" --account-key "$STORAGE_KEY" \
  -c memorial-videos -n Intro_LD.mp4 -f intro.mp4
```
Öffentliche Asset-Basis merken:
`https://<storage>.blob.core.windows.net` → das ist `VITE_PUBLIC_ASSET_BASE`
und für `DEMO_BOOK_URL` der volle PDF-Blob-Link.

## 4. Env / Secrets setzen (fürs Deploy)
```bash
export AZURE_OPENAI_ENDPOINT=... AZURE_OPENAI_KEY=... AZURE_OPENAI_DEPLOYMENT=gpt-4.1
export AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=westeurope
export AZURE_FLUX_ENDPOINT=... AZURE_FLUX_KEY=...
# Live-Sprachgespräch (optional). EIGENE Ressource in Sweden Central – Voice Live
# gibt es in der EU nur dort. Angelegt am 2026-07-28 als `lebenswerk-voicelive`:
#   az cognitiveservices account create -n lebenswerk-voicelive -g lebenswerk-rg \
#     -l swedencentral --kind AIServices --sku S0 --custom-domain lebenswerk-voicelive
export AZURE_VOICELIVE_ENDPOINT=https://lebenswerk-voicelive.services.ai.azure.com
export AZURE_VOICELIVE_KEY=...   # az cognitiveservices account keys list -n lebenswerk-voicelive -g lebenswerk-rg --query key1 -o tsv
export ADMIN_USERNAME=... ADMIN_PASSWORD=... ADMIN_TOKEN_SECRET=...
export CRON_SECRET=... USD_TO_EUR=0.92 RETENTION_DAYS=90
export PUBLIC_BASE_URL="https://lebensgeschichten.ai"
export DEMO_BOOK_URL="https://${STORAGE}.blob.core.windows.net/demo-books/Gedenkbuch_V2_Ingrid_Wagner_Demo_Druck.pdf"
export VITE_PUBLIC_ASSET_BASE="https://${STORAGE}.blob.core.windows.net"
```
> **Wegfall:** `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` werden nicht mehr benötigt.
> **Neu:** `DATABASE_URL`, `AZURE_STORAGE_ACCOUNT`(=STORAGE), `AZURE_STORAGE_KEY`,
> `DEMO_BOOK_URL`, `VITE_PUBLIC_ASSET_BASE`.

## 5. Image bauen + App & Jobs deployen
```bash
bash infra/deploy.sh
```
Legt/aktualisiert die Web-App und die vier Cron-Jobs (purge 03:00, transcript 22:00,
report 23:00, generate alle 10 min — UTC). Gibt die Ingress-URL aus.

## 6. Verifikation (auf der Ingress-URL, VOR dem DNS-Umzug)
- SPA lädt, Login funktioniert, ein Gedenkbuch öffnet (Dashboard-Statistik = RPC ok).
- Beitragenden-Flow mit `?code=…`: Interview (LLM), TTS/STT, Foto-Upload (Blob),
  signierte Bild-URLs im Buch (SAS) werden angezeigt.
- Manueller Job-Testlauf ohne Löschen:
  ```bash
  az containerapp job start -g $RG -n ${APP}-cron-purge \
    --command "/bin/sh" "-c" "node scripts/cron-run.js purge dry=1"
  az containerapp job logs show -g $RG -n ${APP}-cron-purge --container ${APP}-cron-purge
  ```
- `/demobuch` leitet auf das Blob-PDF weiter.

## 7. Cutover (DNS) + Domain
- Custom Domain + verwaltetes Zertifikat an die Container-App binden:
  ```bash
  az containerapp hostname add -g $RG -n $APP --hostname lebensgeschichten.ai
  az containerapp hostname bind -g $RG -n $APP --hostname lebensgeschichten.ai --environment $ACA_ENV --validation-method CNAME
  ```
- Bei Porkbun DNS auf die Container-App umstellen (CNAME/A + asuid-TXT wie von Azure
  angezeigt). `www` weiter auf Apex. TTL vorab senken.
- Nach Umzug prüfen: HTTPS grün, alle Flows wie in Schritt 6.

## 8. Vercel/GitHub abschalten (nach erfolgreichem Cutover)
- Vercel-Projekt pausieren/Domain entfernen.
- Diese Dateien sind mit dem Azure-Setup **obsolet** und werden im selben Zug entfernt
  (siehe Cleanup-Commit): `vercel.json`, `.github/workflows/purge.yml`.
- Supabase-Projekt erst nach Bestätigung der Datenintegrität löschen (Aufbewahrung!).

## Rollback
Solange DNS nicht umgestellt ist, ist Vercel unverändert erreichbar → Rollback =
DNS gar nicht erst umstellen. Nach dem Umzug: DNS zurück auf Vercel zeigen
(Vercel-Deploy muss dafür wieder funktionsfähig sein — d. h. Rollback vor dem
Entfernen von `vercel.json` planen).

## Sicherheit / Nacharbeiten
- Postgres-Zugriff auf die Ausgangs-IPs der Container-App bzw. VNet-Integration
  einschränken (aktuell `--public-access 0.0.0.0` zum Einrichten).
- Storage-Account-Key regelmäßig rotieren; alternativ Managed Identity + User
  Delegation SAS statt Account-Key (Ausbaustufe).
- `require_secure_transport` bleibt an (store.js nutzt `sslmode=require`).
