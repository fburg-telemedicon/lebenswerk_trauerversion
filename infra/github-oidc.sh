#!/usr/bin/env bash
# ============================================================================
# EINMALIG ausführen. Richtet den Azure-Zugang für den GitHub-Auto-Deploy ein
# (.github/workflows/deploy.yml).
#
# Verwendet OIDC / "Workload Identity Federation": GitHub tauscht bei jedem Lauf
# ein kurzlebiges Token gegen einen Azure-Zugang. Es wird KEIN Passwort und KEIN
# Client-Secret erzeugt oder in GitHub hinterlegt — nur die drei IDs unten.
#
# Rechte: Der Zugang bekommt "Contributor" NUR auf die Resource Group
# lebenswerk-rg, und nur der Branch main darf ihn benutzen.
#
# Aufruf:  bash infra/github-oidc.sh
# ============================================================================
set -euo pipefail

SUB=3923cedf-0c22-49e3-8c0d-25ee31e71d1d
RG=lebenswerk-rg
REPO=fburg-telemedicon/lebenswerk_trauerversion
APPNAME=lebenswerk-github-deploy

echo ">> App-Registrierung anlegen (oder bestehende verwenden)"
APP_ID=$(az ad app list --display-name "$APPNAME" --query "[0].appId" -o tsv)
if [ -z "$APP_ID" ]; then
  APP_ID=$(az ad app create --display-name "$APPNAME" --query appId -o tsv)
fi
echo "   appId = $APP_ID"

echo ">> Service Principal anlegen (falls noch nicht vorhanden)"
az ad sp show --id "$APP_ID" >/dev/null 2>&1 || az ad sp create --id "$APP_ID" -o none

echo ">> Contributor-Rolle auf die Resource Group $RG vergeben"
az role assignment create --assignee "$APP_ID" --role Contributor \
  --scope "/subscriptions/$SUB/resourceGroups/$RG" -o none 2>/dev/null || echo "   (bestand bereits)"

echo ">> Federated Credential für Branch main"
az ad app federated-credential create --id "$APP_ID" --parameters "{
  \"name\": \"github-main\",
  \"issuer\": \"https://token.actions.githubusercontent.com\",
  \"subject\": \"repo:${REPO}:ref:refs/heads/main\",
  \"audiences\": [\"api://AzureADTokenExchange\"]
}" -o none 2>/dev/null || echo "   (bestand bereits)"

TENANT=$(az account show --query tenantId -o tsv)

cat <<EOF

============================================================================
FERTIG. Jetzt noch in GitHub eintragen:

  https://github.com/${REPO}/settings/secrets/actions  → "New repository secret"

  AZURE_CLIENT_ID        $APP_ID
  AZURE_TENANT_ID        $TENANT
  AZURE_SUBSCRIPTION_ID  $SUB

Das sind nur IDs, keine Passwörter. Danach deployt jeder Push auf main
automatisch (Actions-Tab zeigt den Lauf).
============================================================================
EOF
