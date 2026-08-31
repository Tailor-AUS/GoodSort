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

# Ensure thegoodsort.org is linked to the ACS resource we send through.
#
# It gets dropped because tailor-app's Bicep declares the shared linkedDomains
# array (tailor-app/infra/main.bicep:753) as [AzureManagedDomain, tailor.au]
# and ARM applies it declaratively, so every tailor-app infra deploy removes
# our domain. It is NOT "M365 DNS changes" as an earlier comment here claimed;
# DNS cannot alter an ARM resource association.
#
# Read-modify-write: append ours, never replace the array, or we clobber
# tailor-app's domains exactly the way theirs clobbers ours.
echo "Ensuring thegoodsort.org email domain is linked to ACS..."
COMM_ID="/subscriptions/5745cb5e-8c39-470f-ab6f-8a5897b7f9af/resourceGroups/rg-tailor-app-prod/providers/Microsoft.Communication/communicationServices/tailor-prod-comm"
GS_DOMAIN="/subscriptions/5745cb5e-8c39-470f-ab6f-8a5897b7f9af/resourceGroups/rg-tailor-app-prod/providers/Microsoft.Communication/emailServices/tailor-prod-email/domains/thegoodsort.org"

CURRENT_DOMAINS=$(az communication show -n tailor-prod-comm -g rg-tailor-app-prod   --query linkedDomains -o json) || {
    echo "ERROR: cannot read ACS linkedDomains. Every OTP will fail with DomainNotLinked." >&2
    exit 1
  }

if echo "$CURRENT_DOMAINS" | grep -q "domains/thegoodsort.org"; then
  echo "  already linked."
else
  echo "  missing - appending."
  BODY=$(printf '%s' "$CURRENT_DOMAINS" | python3 -c "
import json,sys
current = json.load(sys.stdin) or []
gs = sys.argv[1]
if gs not in current:
    current.append(gs)
print(json.dumps({'properties': {'linkedDomains': current}}))
" "$GS_DOMAIN")
  az rest --method patch --url "${COMM_ID}?api-version=2023-04-01"     --body "$BODY" --output none || {
      echo "ERROR: ACS domain re-link failed. Every OTP will fail with DomainNotLinked." >&2
      exit 1
    }
fi

# Prove it, rather than trusting that the PATCH returned 200.
az communication show -n tailor-prod-comm -g rg-tailor-app-prod   --query linkedDomains -o json | grep -q "domains/thegoodsort.org" || {
    echo "ERROR: thegoodsort.org still not linked after PATCH." >&2
    exit 1
  }
echo "  verified."

echo "Done."
