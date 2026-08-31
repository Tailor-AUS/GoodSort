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

# gpt-5-mini is the only deployment in oai-tailor-app-prod verified to work
# for the vision fallback (gpt-4.1 does not exist there).
AZURE_OPENAI_DEPLOYMENT="${AZURE_OPENAI_DEPLOYMENT:-gpt-5-mini}"

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

echo "Env vars restored."

# Direct Sovrgn consumers were revoked (TailorAU/tailor-app#5223). Strip any
# leftover SOVRGN_* so the next azd deploy cannot re-inject a dead bearer.
az containerapp update -n "$APP" -g "$RG" \
  --remove-env-vars SOVRGN_API_KEY SOVRGN_API_URL SOVRGN_MODEL \
  --output none || true
if [ -n "${SOVRGN_API_KEY:-}" ]; then
  echo "WARNING: SOVRGN_API_KEY is set in azd env but will not be restored (revoked)."
fi

# thegoodsort.org must stay linked to goodsort-comm or every OTP fails with
# DomainNotLinked. One implementation, shared with both workflows — this used
# to be a third copy of the same code, and it carried the same latent crash.
echo "Ensuring thegoodsort.org email domain is linked to ACS..."
if ! bash "$(dirname "$0")/../scripts/ensure-acs-domain-linked.sh"; then
  echo "ERROR: ACS sender domain is not linked. Every OTP will fail." >&2
  exit 1
fi

echo "Done."
