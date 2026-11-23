#!/usr/bin/env bash
# Zero-secret audit of Azure Container Apps secretRef hygiene for The Good Sort.
# Queries ONLY env var names where secretRef is null — NEVER queries .value and
# NEVER prints any secret, token, password, or connection string.
#
# Usage:
#   bash scripts/check-secretref-hygiene.sh [--strict] [RG] [APP]
#
# Exit codes:
#   0  all sensitive env vars are secretRef-backed (or non-strict warning emitted)
#   1  --strict mode and one or more sensitive env vars are stored in plaintext
#   2  Azure CLI query failed
set -euo pipefail

STRICT=0
if [ "${1:-}" = "--strict" ]; then
  STRICT=1
  shift
fi

RG="${1:-rg-GoodSort}"
APP="${2:-api}"

SENSITIVE_KEYS=(
  JWT_SECRET
  ConnectionStrings__goodsortdb
  GOODSORTDB_CONNECTION_STRING
  ACS_CONNECTION_STRING
  AZURE_OPENAI_KEY
  TAILOR_VISION_API_KEY
  PACT_VISION_API_KEY
)

if ! PLAINTEXT_NAMES=$(az containerapp show -n "$APP" -g "$RG" \
  --query "properties.template.containers[0].env[?secretRef==\`null\`].name" \
  -o tsv 2>/dev/null | tr -d '\r'); then
  echo "::warning title=secretRef hygiene check skipped::Could not query Container App ${APP} in ${RG}." >&2
  exit 2
fi

VIOLATIONS=()
for key in "${SENSITIVE_KEYS[@]}"; do
  if printf '%s\n' "$PLAINTEXT_NAMES" | grep -Fxq "$key"; then
    VIOLATIONS+=("$key")
  fi
done

if [ ${#VIOLATIONS[@]} -eq 0 ]; then
  echo "secretRef hygiene OK: all sensitive env vars on ${RG}/${APP} use Container App secretRef."
  exit 0
fi

LIST="${VIOLATIONS[*]}"
MSG="Sensitive env var(s) stored in plaintext on ${RG}/${APP} (missing secretRef): ${LIST}. Migrate to Container App secrets via az containerapp secret set + secretref: (never plain env vars)."

if [ "$STRICT" -eq 1 ]; then
  echo "::error title=Plaintext secretRef violation::${MSG}" >&2
  exit 1
fi

echo "::warning title=Plaintext secretRef hygiene warning::${MSG}"
exit 0
