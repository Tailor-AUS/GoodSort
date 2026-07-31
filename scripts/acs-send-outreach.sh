#!/usr/bin/env bash
# Send an outreach email directly via Azure Communication Services REST,
# bypassing the API deploy. Useful the moment az login works.
#
# Usage:
#   ./scripts/acs-send-outreach.sh docs/coex-followup-payload.json
#
# Pulls ACS_CONNECTION_STRING from the api Container App if not set.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PAYLOAD="${1:-$ROOT/docs/coex-followup-payload.json}"
RG="${RG:-rg-GoodSort}"
APP="${APP:-api}"

if [ ! -f "$PAYLOAD" ]; then
  echo "ERROR: payload not found: $PAYLOAD" >&2
  exit 1
fi

if [ -z "${ACS_CONNECTION_STRING:-}" ]; then
  if ! az account show >/dev/null 2>&1; then
    echo "ERROR: az login required (or export ACS_CONNECTION_STRING)." >&2
    exit 1
  fi
  echo "Reading ACS_CONNECTION_STRING from Container App $APP..."
  ACS_CONNECTION_STRING="$(az containerapp show -n "$APP" -g "$RG" \
    --query "properties.template.containers[0].env[?name=='ACS_CONNECTION_STRING'].value | [0]" -o tsv)"
fi

if [ -z "${ACS_CONNECTION_STRING:-}" ] || [ "$ACS_CONNECTION_STRING" = "null" ]; then
  echo "ERROR: ACS_CONNECTION_STRING empty." >&2
  exit 1
fi

# Parse endpoint + access key from connection string
# format: endpoint=https://xxx.communication.azure.com/;accesskey=BASE64
endpoint="$(echo "$ACS_CONNECTION_STRING" | sed -n 's/.*endpoint=\([^;]*\).*/\1/Ip' | sed 's:/*$::')"
accesskey="$(echo "$ACS_CONNECTION_STRING" | sed -n 's/.*accesskey=\([^;]*\).*/\1/Ip')"

if [ -z "$endpoint" ] || [ -z "$accesskey" ]; then
  echo "ERROR: could not parse endpoint/accesskey from connection string." >&2
  exit 1
fi

python3 - "$PAYLOAD" "$endpoint" "$accesskey" <<'PY'
import base64, hashlib, hmac, json, sys, urllib.request
from datetime import datetime, timezone
from email.utils import format_datetime

payload_path, endpoint, accesskey = sys.argv[1], sys.argv[2].rstrip("/"), sys.argv[3]
data = json.load(open(payload_path))

to = [{"address": data["to"]}]
cc = [{"address": a} for a in data.get("cc") or []]
reply_to = [{"address": a} for a in data.get("replyTo") or []]
content = {"subject": data["subject"]}
if data.get("plainBody"):
    content["plainText"] = data["plainBody"]
if data.get("htmlBody"):
    content["html"] = data["htmlBody"]

body = {
    "senderAddress": data.get("from") or "DoNotReply@thegoodsort.org",
    "recipients": {"to": to},
    "content": content,
}
if data.get("senderDisplayName"):
    body["senderDisplayName"] = data["senderDisplayName"]
if cc:
    body["recipients"]["cc"] = cc
if reply_to:
    body["replyTo"] = reply_to

body_bytes = json.dumps(body).encode()
path_and_query = "/emails:send?api-version=2023-03-31"
url = endpoint + path_and_query
host = endpoint.replace("https://", "").replace("http://", "")
date = format_datetime(datetime.now(timezone.utc), usegmt=True)
content_hash = base64.b64encode(hashlib.sha256(body_bytes).digest()).decode()

string_to_sign = "\n".join([
    "POST",
    path_and_query,
    f"x-ms-date:{date};host:{host};x-ms-content-sha256:{content_hash}",
])
key = base64.b64decode(accesskey)
signature = base64.b64encode(hmac.new(key, string_to_sign.encode(), hashlib.sha256).digest()).decode()

req = urllib.request.Request(url, data=body_bytes, method="POST")
req.add_header("Content-Type", "application/json")
req.add_header("x-ms-date", date)
req.add_header("x-ms-content-sha256", content_hash)
req.add_header("Host", host)
req.add_header("Authorization", f"HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature={signature}")

try:
    with urllib.request.urlopen(req) as resp:
        print(resp.status, resp.read().decode())
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode(), file=sys.stderr)
    sys.exit(1)
PY

echo "Sent. Replies → knox@tailor.au (Reply-To + Cc)."
