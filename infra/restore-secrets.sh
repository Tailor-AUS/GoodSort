#!/usr/bin/env bash
# azd postdeploy hook: re-apply production env vars onto the api Container App
# because `azd deploy` strips anything the Aspire manifest doesn't declare.
#
# Values are read from the azd environment (.azure/<env>/.env), which is
# gitignored. Set them with:
#   azd env set JWT_SECRET "..."
#   azd env set TAILOR_VISION_API_KEY "..."
#   azd env set TAILOR_VISION_API_URL "..."
#   azd env set ACS_CONNECTION_STRING "..."
#   azd env set ACS_EMAIL_SENDER "..."
#   azd env set AZURE_OPENAI_ENDPOINT "..."
#   azd env set AZURE_OPENAI_KEY "..."
#   azd env set AZURE_OPENAI_DEPLOYMENT "..."
#   azd env set GOODSORTDB_CONNECTION_STRING "..."

set -euo pipefail

REQUIRED=(JWT_SECRET TAILOR_VISION_API_KEY TAILOR_VISION_API_URL
          ACS_CONNECTION_STRING ACS_EMAIL_SENDER
          AZURE_OPENAI_ENDPOINT AZURE_OPENAI_KEY AZURE_OPENAI_DEPLOYMENT
          GOODSORTDB_CONNECTION_STRING)

missing=()
for k in "${REQUIRED[@]}"; do
  if [ -z "${!k:-}" ]; then missing+=("$k"); fi
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "ERROR: missing azd env vars: ${missing[*]}" >&2
  echo "Set them with: azd env set <NAME> <VALUE>" >&2
  exit 1
fi

RG="rg-GoodSort"
APP="api"

echo "Restoring env vars on $APP in $RG..."
az containerapp update -n "$APP" -g "$RG" \
  --set-env-vars \
    "JWT_SECRET=$JWT_SECRET" \
    "TAILOR_VISION_API_KEY=$TAILOR_VISION_API_KEY" \
    "TAILOR_VISION_API_URL=$TAILOR_VISION_API_URL" \
    "ACS_CONNECTION_STRING=$ACS_CONNECTION_STRING" \
    "ACS_EMAIL_SENDER=$ACS_EMAIL_SENDER" \
    "AZURE_OPENAI_ENDPOINT=$AZURE_OPENAI_ENDPOINT" \
    "AZURE_OPENAI_KEY=$AZURE_OPENAI_KEY" \
    "AZURE_OPENAI_DEPLOYMENT=$AZURE_OPENAI_DEPLOYMENT" \
    "ConnectionStrings__goodsortdb=$GOODSORTDB_CONNECTION_STRING" \
  --output none

echo "Env vars restored. Triggering a fresh revision..."
echo "Done."
