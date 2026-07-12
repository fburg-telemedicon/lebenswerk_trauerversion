#!/usr/bin/env bash
# ============================================================================
# Lebenswerk – Azure-Provisionierung (einmalig, mit `az login` ausführen).
#
#   Voraussetzung: Azure CLI (`az`) angemeldet, richtiges Abo gewählt:
#     az login
#     az account set --subscription "<SUB-ID>"
#
#   Danach:  bash infra/provision.sh
#
# Idempotent gedacht (create-Befehle sind bei Wiederholung meist no-ops bzw.
# schlagen harmlos fehl). Region = West Europe (EU-Datenhaltung, passt zur
# bestehenden AZURE_SPEECH_REGION=westeurope). ALLES anpassbar über die
# Variablen unten bzw. gleichnamige Umgebungsvariablen.
# ============================================================================
set -euo pipefail

LOCATION="${LOCATION:-westeurope}"
RG="${RG:-lebenswerk-rg}"
PREFIX="${PREFIX:-lebenswerk}"

# Postgres
PG_SERVER="${PG_SERVER:-${PREFIX}-pg}"
PG_ADMIN="${PG_ADMIN:-lwadmin}"
PG_PASSWORD="${PG_PASSWORD:?PG_PASSWORD muss gesetzt sein (starkes Passwort)}"
PG_DB="${PG_DB:-lebenswerk}"
PG_TIER="${PG_TIER:-Burstable}"
PG_SKU="${PG_SKU:-Standard_B2s}"
PG_VERSION="${PG_VERSION:-16}"

# Storage
STORAGE="${STORAGE:-${PREFIX}store$RANDOM}"   # global eindeutig, 3-24 lowercase

# Container Registry + Container Apps
ACR="${ACR:-${PREFIX}acr$RANDOM}"             # global eindeutig, lowercase
ACA_ENV="${ACA_ENV:-${PREFIX}-env}"
APP="${APP:-${PREFIX}-web}"

echo ">> Resource Group"
az group create -n "$RG" -l "$LOCATION" -o none

echo ">> PostgreSQL Flexible Server ($PG_SERVER)"
az postgres flexible-server create \
  -g "$RG" -n "$PG_SERVER" -l "$LOCATION" \
  --admin-user "$PG_ADMIN" --admin-password "$PG_PASSWORD" \
  --tier "$PG_TIER" --sku-name "$PG_SKU" --version "$PG_VERSION" \
  --storage-size 32 --public-access 0.0.0.0 -y -o none || true
az postgres flexible-server db create -g "$RG" -s "$PG_SERVER" -d "$PG_DB" -o none || true
# require_secure_transport bleibt AN (store.js nutzt TLS). Zugriff später auf
# Container-App-Ausgangs-IPs bzw. VNet einschränken (siehe MIGRATION.md).

echo ">> Storage Account ($STORAGE) + Container"
az storage account create -g "$RG" -n "$STORAGE" -l "$LOCATION" \
  --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 -o none
STORAGE_KEY="$(az storage account keys list -g "$RG" -n "$STORAGE" --query '[0].value' -o tsv)"
# privat: Buch-/Upload-Bilder
az storage container create --account-name "$STORAGE" --account-key "$STORAGE_KEY" \
  -n memorial-images --public-access off -o none
# öffentlich lesbar: Demo-Buch-PDF + Intro-Video (Namen MÜSSEN lowercase sein)
az storage container create --account-name "$STORAGE" --account-key "$STORAGE_KEY" \
  -n demo-books --public-access blob -o none
az storage container create --account-name "$STORAGE" --account-key "$STORAGE_KEY" \
  -n memorial-videos --public-access blob -o none

echo ">> Container Registry ($ACR)"
az acr create -g "$RG" -n "$ACR" --sku Basic --admin-enabled true -o none

echo ">> Container Apps Environment ($ACA_ENV)"
az extension add --name containerapp --upgrade -y -o none || true
az containerapp env create -g "$RG" -n "$ACA_ENV" -l "$LOCATION" -o none

cat <<EOF

============================================================================
Provisionierung angelegt. Notiere für die nächsten Schritte (MIGRATION.md):

  RG                = $RG
  Postgres-Host     = ${PG_SERVER}.postgres.database.azure.com
  DATABASE_URL      = postgres://${PG_ADMIN}:<PASS>@${PG_SERVER}.postgres.database.azure.com:5432/${PG_DB}?sslmode=require
  Storage-Account   = $STORAGE
  Storage-Key       = (az storage account keys list -g $RG -n $STORAGE)
  Registry          = ${ACR}.azurecr.io
  ACA-Environment   = $ACA_ENV
  App-Name          = $APP

Weiter mit:  db/schema.sql einspielen, Image bauen/pushen, App + Jobs deployen,
Daten migrieren, DNS umstellen — siehe infra/MIGRATION.md.
============================================================================
EOF
