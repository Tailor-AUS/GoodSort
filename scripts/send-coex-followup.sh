#!/usr/bin/env bash
# Send the COEX Expansion follow-up via the GoodSort admin outreach API.
#
# Prerequisites:
#   1. Azure login (for optional MailFrom setup) — OR just a valid admin JWT
#   2. Admin JWT for thegoodsort.org API
#
# Usage:
#   export API_URL=https://api.livelyfield-64227152.eastasia.azurecontainerapps.io
#   export TOKEN=<admin jwt>
#   ./scripts/send-coex-followup.sh
#
# Get a token by OTP login as an admin (e.g. admin@tailorco.au), or via
# /api/admin/bootstrap when ADMIN_BOOTSTRAP_SECRET is set.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_URL="${API_URL:-https://api.livelyfield-64227152.eastasia.azurecontainerapps.io}"
PAYLOAD="${PAYLOAD:-$ROOT/docs/coex-followup-payload.json}"

if [ -z "${TOKEN:-}" ]; then
  echo "ERROR: set TOKEN to an admin JWT (Bearer token)." >&2
  echo "  curl -X POST \$API_URL/api/auth/send-otp -d '{\"email\":\"admin@tailorco.au\"}' -H 'Content-Type: application/json'" >&2
  echo "  curl -X POST \$API_URL/api/auth/verify-otp -d '{\"email\":\"admin@tailorco.au\",\"code\":\"NNNNNN\"}' -H 'Content-Type: application/json'" >&2
  exit 1
fi

if [ ! -f "$PAYLOAD" ]; then
  echo "ERROR: payload not found: $PAYLOAD" >&2
  exit 1
fi

echo "Sending COEX follow-up via $API_URL/api/admin/outreach/send ..."
resp="$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/api/admin/outreach/send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @"$PAYLOAD")"

body="$(echo "$resp" | sed '$d')"
code="$(echo "$resp" | tail -n1)"

echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
echo "HTTP $code"

if [ "$code" != "200" ]; then
  exit 1
fi

echo "Done. Watch knox@tailor.au for replies (Reply-To + Cc)."
