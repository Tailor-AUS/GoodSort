#!/usr/bin/env bash
# Keep thegoodsort.org linked to the Communication Service we send OTP codes
# through. Unlinked means every signup fails with DomainNotLinked — the domain
# stays fully *verified* the whole time, so nothing about DNS looks wrong.
#
# Root cause is not in this repo: tailor-app's Bicep declares the shared
# linkedDomains array (infra/main.bicep:753) and ARM applies it declaratively,
# so its deploys drop our domain. Activity log names the principal:
# tailor-dev-deploy. Until that Bicep includes this domain, we re-link.
#
# Exit codes are the contract, because the two callers want different things:
#   0  linked (already, or repaired and verified)
#   1  repair was needed and failed — email is down
#   2  could not even check (no permission on the ACS resource)
set -uo pipefail

SUB="5745cb5e-8c39-470f-ab6f-8a5897b7f9af"
RG="rg-tailor-app-prod"
COMM="tailor-prod-comm"
COMM_ID="/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.Communication/communicationServices/${COMM}"
GS="/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.Communication/emailServices/tailor-prod-email/domains/thegoodsort.org"

if ! CURRENT=$(az communication show -n "$COMM" -g "$RG" --query linkedDomains -o json 2>&1); then
  echo "::warning title=ACS self-heal unavailable::Cannot read ${COMM} (likely AuthorizationFailed: this identity is scoped to rg-GoodSort, the ACS resource lives in ${RG}). Email cannot be self-healed here."
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
