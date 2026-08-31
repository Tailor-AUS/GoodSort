#!/usr/bin/env bash
# Keep thegoodsort.org linked to goodsort-comm, the Communication Service we
# send OTP codes through. Unlinked means every signup fails with
# DomainNotLinked, while the domain stays fully *verified* the whole time — so
# nothing about DNS looks wrong and the failure reads as a code bug.
#
# We used to send through tailor-app's shared tailor-prod-comm, and that is
# what made this a recurring outage: tailor-app's Bicep declares the shared
# linkedDomains array (infra/main.bicep:753), ARM applies it declaratively, and
# every one of their infra deploys silently dropped our domain. It happened
# three times on 2026-08-31 alone. We now own the service, so nobody else's
# deploy can reach it, and the domain resource itself was never the thing that
# broke — only the association.
#
# This is therefore a safety net rather than a repair loop. If it ever fires,
# something changed that we did not expect.
#
# Exit codes are the contract, because the callers want different things:
#   0  linked (already, or repaired and verified)
#   1  repair was needed and failed — email is down
#   2  could not even check (no permission on the ACS resource)
set -uo pipefail

SUB="5745cb5e-8c39-470f-ab6f-8a5897b7f9af"
RG="rg-GoodSort"
COMM="goodsort-comm"
COMM_ID="/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.Communication/communicationServices/${COMM}"
# The domain resource still lives in tailor-app's email service. That is fine:
# it is only ever referenced, never rewritten, and re-verifying it under our own
# email service would mean new DNS records for no gain.
DOMAIN_RG="rg-tailor-app-prod"
GS="/subscriptions/${SUB}/resourceGroups/${DOMAIN_RG}/providers/Microsoft.Communication/emailServices/tailor-prod-email/domains/thegoodsort.org"

if ! CURRENT=$(az communication show -n "$COMM" -g "$RG" --query linkedDomains -o json 2>&1); then
  echo "::warning title=ACS self-heal unavailable::Cannot read ${COMM} in ${RG}. Email cannot be self-healed here."
  printf '%s\n' "$CURRENT" | tail -3
  exit 2
fi

if printf '%s' "$CURRENT" | grep -q "domains/thegoodsort.org"; then
  echo "thegoodsort.org already linked."
  exit 0
fi

echo "::error title=ACS sender domain was unlinked::thegoodsort.org missing from linkedDomains - every OTP would fail. Repairing."

# Read-modify-write. Never assign the array wholesale, or we clobber
# tailor-app's domains exactly the way theirs clobbers ours.
if ! BODY=$(printf '%s' "$CURRENT" | python3 -c '
import json, sys

raw = sys.stdin.read().strip()
# `az --query linkedDomains -o json` prints NOTHING — not "null" — when the
# property is absent, which is precisely the state this script exists to
# repair. A bare json.load() dies on it with "Expecting value: line 1
# column 1", so for two days the self-heal only ever crashed when it was
# actually needed, and took the deploy down with it.
current = json.loads(raw) if raw else []
if current is None:
    current = []
if not isinstance(current, list):
    raise SystemExit(f"linkedDomains was {type(current).__name__}, expected a list: {raw!r}")

gs = sys.argv[1]
if gs not in current:
    current.append(gs)
print(json.dumps({"properties": {"linkedDomains": current}}))
' "$GS"); then
  echo "::error title=ACS repair failed::Could not build the patch body from linkedDomains."
  exit 1
fi

if ! az rest --method patch --url "${COMM_ID}?api-version=2023-04-01" \
     --headers "Content-Type=application/json" --body "$BODY" --output none; then
  echo "::error title=ACS repair failed::PATCH of ${COMM} was rejected."
  exit 1
fi

# Trust the read-back, not the PATCH's exit code.
if ! az communication show -n "$COMM" -g "$RG" --query linkedDomains -o json \
     | grep -q "domains/thegoodsort.org"; then
  echo "::error title=ACS repair failed::PATCH returned success but the domain is still not linked."
  exit 1
fi

echo "Re-linked and verified."
