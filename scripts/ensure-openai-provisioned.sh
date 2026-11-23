#!/usr/bin/env bash
# Ensure The Good Sort has its own standalone Azure OpenAI resource and
# deployment in rg-GoodSort, wired into the api Container App with
# Tailor Vision variables removed and hello@thegoodsort.org configured as the
# standalone admin/ops address.
#
# Preserves an existing AZURE_OPENAI_DEPLOYMENT on the Container App when no
# override is supplied so upgrading to a faster non-reasoning deployment (e.g.
# gpt-4.1-mini) is never silently reverted back to gpt-5-mini on the next deploy.
#
# Exit codes:
#   0  provisioned and wired into the Container App
#   1  provisioning or secret/env update failed
set -euo pipefail

RG="${1:-rg-GoodSort}"
APP="${2:-api}"
OAI_NAME="${3:-oai-goodsort-prod}"
OAI_LOCATION="${4:-australiaeast}"
ADMIN_EMAIL="${ADMIN_SEED_EMAIL:-hello@thegoodsort.org}"
OPS_EMAIL="${OPS_ALERT_EMAIL:-hello@thegoodsort.org}"

LIVE_DEPLOYMENT=""
if [ -z "${AZURE_OPENAI_DEPLOYMENT:-}" ]; then
  LIVE_DEPLOYMENT=$(az containerapp show -n "$APP" -g "$RG" \
    --query "properties.template.containers[0].env[?name=='AZURE_OPENAI_DEPLOYMENT'].value | [0]" \
    -o tsv 2>/dev/null | tr -d '\r' || true)
  if [ "$LIVE_DEPLOYMENT" = "None" ]; then
    LIVE_DEPLOYMENT=""
  fi
fi

OAI_DEPLOYMENT="${AZURE_OPENAI_DEPLOYMENT:-${LIVE_DEPLOYMENT:-gpt-5-mini}}"
OAI_SKU="${AZURE_OPENAI_SKU:-GlobalStandard}"

if [ -n "${AZURE_OPENAI_MODEL_VERSION:-}" ]; then
  OAI_MODEL_VERSION="$AZURE_OPENAI_MODEL_VERSION"
else
  case "$OAI_DEPLOYMENT" in
    gpt-4.1|gpt-4.1-mini|gpt-4.1-nano) OAI_MODEL_VERSION="2025-04-14" ;;
    gpt-5.4-mini|gpt-5.4-nano)         OAI_MODEL_VERSION="2026-03-17" ;;
    gpt-4o-mini)                       OAI_MODEL_VERSION="2024-07-18" ;;
    *)                                 OAI_MODEL_VERSION="2025-08-07" ;;
  esac
fi

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
  echo "Creating deployment ${OAI_DEPLOYMENT} (${OAI_MODEL_VERSION}, ${OAI_SKU}) on ${OAI_NAME}..."
  az cognitiveservices account deployment create \
    -n "$OAI_NAME" \
    -g "$RG" \
    --deployment-name "$OAI_DEPLOYMENT" \
    --model-name "$OAI_DEPLOYMENT" \
    --model-version "$OAI_MODEL_VERSION" \
    --model-format OpenAI \
    --sku-name "$OAI_SKU" \
    --sku-capacity 50 \
    -o none
fi

OAI_ENDPOINT=$(az cognitiveservices account show -n "$OAI_NAME" -g "$RG" --query "properties.endpoint" -o tsv | tr -d '\r')
OAI_KEY=$(az cognitiveservices account keys list -n "$OAI_NAME" -g "$RG" --query "key1" -o tsv | tr -d '\r')
if [ "${GITHUB_ACTIONS:-}" = "true" ] && [ -n "$OAI_KEY" ]; then
  echo "::add-mask::$OAI_KEY"
fi

if [ -z "$OAI_ENDPOINT" ] || [ -z "$OAI_KEY" ]; then
  echo "::error title=OpenAI provisioning failed::Could not read endpoint or key from ${OAI_NAME} in ${RG}."
  exit 1
fi

echo "Updating Container App ${APP} in ${RG} with standalone OpenAI (${OAI_ENDPOINT}, deployment=${OAI_DEPLOYMENT}) and ${ADMIN_EMAIL}..."
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
