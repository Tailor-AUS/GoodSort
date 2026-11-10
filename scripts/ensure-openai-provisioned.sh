#!/usr/bin/env bash
# Ensure The Good Sort has its own standalone Azure OpenAI resource and
# gpt-5-mini deployment in rg-GoodSort, wired into the api Container App with
# Tailor Vision variables removed and admin@thegoodsort.org configured as the
# standalone admin/ops address.
#
# Exit codes:
#   0  provisioned and wired into the Container App
#   1  provisioning or secret/env update failed
set -euo pipefail

RG="${1:-rg-GoodSort}"
APP="${2:-api}"
OAI_NAME="${3:-oai-goodsort-prod}"
OAI_LOCATION="${4:-australiaeast}"
OAI_DEPLOYMENT="${AZURE_OPENAI_DEPLOYMENT:-gpt-5-mini}"
OAI_MODEL_VERSION="2025-08-07"
ADMIN_EMAIL="${ADMIN_SEED_EMAIL:-admin@thegoodsort.org}"
OPS_EMAIL="${OPS_ALERT_EMAIL:-admin@thegoodsort.org}"

if ! az cognitiveservices account show -n "$OAI_NAME" -g "$RG" -o none 2>/dev/null; then
  echo "Creating standalone Azure OpenAI account ${OAI_NAME} in ${RG} (${OAI_LOCATION})..."
  az cognitiveservices account create \
    -n "$OAI_NAME" \
    -g "$RG" \
    --kind OpenAI \
    --sku S0 \
    --location "$OAI_LOCATION" \
    --custom-domain "$OAI_NAME" \
    --yes \
    -o none
fi

if ! az cognitiveservices account deployment show -n "$OAI_NAME" -g "$RG" --deployment-name "$OAI_DEPLOYMENT" -o none 2>/dev/null; then
  echo "Creating deployment ${OAI_DEPLOYMENT} (${OAI_MODEL_VERSION}) on ${OAI_NAME}..."
  az cognitiveservices account deployment create \
    -n "$OAI_NAME" \
    -g "$RG" \
    --deployment-name "$OAI_DEPLOYMENT" \
    --model-name "$OAI_DEPLOYMENT" \
    --model-version "$OAI_MODEL_VERSION" \
    --model-format OpenAI \
    --sku-name GlobalStandard \
    --sku-capacity 50 \
    -o none
fi

OAI_ENDPOINT=$(az cognitiveservices account show -n "$OAI_NAME" -g "$RG" --query "properties.endpoint" -o tsv | tr -d '\r')
OAI_KEY=$(az cognitiveservices account keys list -n "$OAI_NAME" -g "$RG" --query "key1" -o tsv | tr -d '\r')

if [ -z "$OAI_ENDPOINT" ] || [ -z "$OAI_KEY" ]; then
  echo "::error title=OpenAI provisioning failed::Could not read endpoint or key from ${OAI_NAME} in ${RG}."
  exit 1
fi

echo "Updating Container App ${APP} in ${RG} with standalone OpenAI (${OAI_ENDPOINT}) and ${ADMIN_EMAIL}..."
az containerapp secret set -n "$APP" -g "$RG" \
  --secrets "azure-openai-key=$OAI_KEY" \
  -o none

az containerapp update -n "$APP" -g "$RG" \
  --set-env-vars \
    "AZURE_OPENAI_ENDPOINT=$OAI_ENDPOINT" \
    "AZURE_OPENAI_KEY=secretref:azure-openai-key" \
    "AZURE_OPENAI_DEPLOYMENT=$OAI_DEPLOYMENT" \
    "ADMIN_SEED_EMAIL=$ADMIN_EMAIL" \
    "OPS_ALERT_EMAIL=$OPS_EMAIL" \
  -o none

az containerapp update -n "$APP" -g "$RG" \
  --remove-env-vars TAILOR_VISION_API_KEY TAILOR_VISION_API_URL SOVRGN_API_KEY \
  -o none 2>/dev/null || true

echo "Standalone Azure OpenAI (${OAI_NAME} / ${OAI_DEPLOYMENT}) and ${ADMIN_EMAIL} wired into ${APP}."
