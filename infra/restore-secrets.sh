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

# Refuse values carrying shell-escape artifacts.
#
# The azd environment file is machine-local and gitignored, so nothing in the
# repo can check it -- but this script is what copies it into production. On
# 2026-09-02 the local .azure/GoodSort/.env held four values ending in a literal
# backslash-r, and a JWT_SECRET whose "!!" had become "\!\!" from a
# shell that escaped history expansion. Verified against the running app: the
# cleaned values matched production exactly, so the file -- not production --
# was wrong.
#
# Applying them would have been quiet and bad: a trailing backslash-r on
# GOODSORTDB_CONNECTION_STRING and TAILOR_VISION_API_URL, a corrupted vision
# key that fails auth and falls through to the paid Azure OpenAI path, and a
# different JWT_SECRET, which invalidates every issued token and signs out
# every member at once.
#
# None of that surfaces as an error. The deploy succeeds and the app starts.
BAD_ESCAPES=()
for k in "${REQUIRED[@]}"; do
  v="${!k:-}"
  case "$v" in
    *"\r"|*"\n"|*"\t"|*"\!"*) BAD_ESCAPES+=("$k") ;;
  esac
done
if [ ${#BAD_ESCAPES[@]} -gt 0 ]; then
  echo "ERROR: these azd env values contain literal escape sequences: ${BAD_ESCAPES[*]}" >&2
  echo "They would be written to the container app verbatim and break at runtime" >&2
  echo "without any error at deploy time. Fix them with:" >&2
  echo "  azd env set <NAME> '<correct value>'" >&2
  echo "and check .azure/<env>/.env for duplicate keys differing only by case --" >&2
  echo "the later one wins, and a stale lowercase block has shadowed this before." >&2
  exit 1
fi

RG="rg-GoodSort"
APP="api"

# GoodSort sends OTP email through its OWN Communication Service, goodsort-comm
# in rg-GoodSort. It used to send through tailor-app's shared tailor-prod-comm,
# whose linkedDomains array their Bicep declares - so every tailor-app infra
# deploy silently dropped our domain and killed every signup.
#
# A stale azd env is the one way that could quietly come back: this hook would
# restore the old connection string and email would keep "working" while being
# one tailor-app deploy away from dead again. Refuse instead of reverting.
case "$ACS_CONNECTION_STRING" in
  *goodsort-comm*) ;;
  *)
    echo "ERROR: ACS_CONNECTION_STRING does not point at goodsort-comm." >&2
    echo "  Refusing to restore it - this is how email silently reverts to" >&2
    echo "  tailor-app's shared service, which their deploys unlink us from." >&2
    echo "  Fix: azd env set ACS_CONNECTION_STRING \\" >&2
    echo "    \"\$(az communication list-key -n goodsort-comm -g rg-GoodSort \\" >&2
    echo "        --query primaryConnectionString -o tsv)\"" >&2
    exit 1
    ;;
esac

# Credentials go in Container App secrets, not plaintext env vars. They were
# plaintext until 2026-08-31, which meant anyone with read access on the app
# could read the database connection string, the JWT signing key and two API
# keys straight out of `az containerapp show`.
echo "Storing credentials as Container App secrets..."
az containerapp secret set -n "$APP" -g "$RG" --secrets     "jwt-secret=$JWT_SECRET"     "tailor-vision-api-key=$TAILOR_VISION_API_KEY"     "acs-connection-string=$ACS_CONNECTION_STRING"     "azure-openai-key=$AZURE_OPENAI_KEY"     "goodsortdb-connection-string=$GOODSORTDB_CONNECTION_STRING"   --output none

echo "Restoring env vars on $APP in $RG..."
az containerapp update -n "$APP" -g "$RG"   --set-env-vars     "JWT_SECRET=secretref:jwt-secret"     "TAILOR_VISION_API_KEY=secretref:tailor-vision-api-key"     "TAILOR_VISION_API_URL=$TAILOR_VISION_API_URL"     "ACS_CONNECTION_STRING=secretref:acs-connection-string"     "ACS_EMAIL_SENDER=$ACS_EMAIL_SENDER"     "AZURE_OPENAI_ENDPOINT=$AZURE_OPENAI_ENDPOINT"     "AZURE_OPENAI_KEY=secretref:azure-openai-key"     "AZURE_OPENAI_DEPLOYMENT=$AZURE_OPENAI_DEPLOYMENT"     "ConnectionStrings__goodsortdb=secretref:goodsortdb-connection-string"   --output none

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
