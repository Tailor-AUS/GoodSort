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

echo "Env vars restored."

# Optional: ABA bank-settlement details. Only needed to generate cash-out payout
# files; the API fails loud at file-generation time if they're unset, so they're
# not required for the app to run. Set the ones you have with e.g.:
#   azd env set ABA_USER_ID "..."   ABA_TRACE_BSB "032-000"   ABA_TRACE_ACCOUNT "..."
# See infra/aba-settlement.md.
ABA_ARGS=()
for k in ABA_USER_ID ABA_TRACE_BSB ABA_TRACE_ACCOUNT ABA_BANK_CODE ABA_USER_NAME ABA_REMITTER CASHOUT_MAX_CENTS; do
  v="${!k:-}"
  if [ -n "$v" ]; then ABA_ARGS+=("$k=$v"); fi
done
if [ ${#ABA_ARGS[@]} -gt 0 ]; then
  echo "Applying settlement vars: ${ABA_ARGS[*]%%=*}"
  az containerapp update -n "$APP" -g "$RG" --set-env-vars "${ABA_ARGS[@]}" --output none
fi

# Re-link thegoodsort.org to ACS (keeps getting unlinked by M365 DNS changes)
echo "Re-linking thegoodsort.org email domain to ACS..."
COMM_ID="/subscriptions/5745cb5e-8c39-470f-ab6f-8a5897b7f9af/resourceGroups/rg-tailor-app-prod/providers/Microsoft.Communication/communicationServices/tailor-prod-comm"
az rest --method patch --url "${COMM_ID}?api-version=2023-04-01" --body '{
  "properties": {
    "linkedDomains": [
      "/subscriptions/5745cb5e-8c39-470f-ab6f-8a5897b7f9af/resourceGroups/rg-tailor-app-prod/providers/Microsoft.Communication/emailServices/tailor-prod-email/domains/AzureManagedDomain",
      "/subscriptions/5745cb5e-8c39-470f-ab6f-8a5897b7f9af/resourceGroups/rg-tailor-app-prod/providers/Microsoft.Communication/emailServices/tailor-prod-email/domains/tailor.au",
      "/subscriptions/5745cb5e-8c39-470f-ab6f-8a5897b7f9af/resourceGroups/rg-tailor-app-prod/providers/Microsoft.Communication/emailServices/tailor-prod-email/domains/thegoodsort.org"
    ]
  }
}' --output none 2>/dev/null || echo "WARNING: ACS domain re-link failed (non-fatal)"
echo "Done."
