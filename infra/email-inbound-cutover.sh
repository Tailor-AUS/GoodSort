#!/usr/bin/env bash
# Cut over thegoodsort.org inbound MX from stranded M365 → a catch-all forwarder
# that delivers to knox@tailor.au, while keeping ACS outbound (azurecomm.net SPF).
#
# BEFORE running:
#   1. Create an ImprovMX (or Forward Email) account for thegoodsort.org
#   2. Set catch-all → knox@tailor.au
#   3. Copy the MX hosts the provider gives you into MX1/MX2 below
#   4. az login && az account set --subscription <dns-zone subscription>
#
# Usage:
#   MX1="mx1.improvmx.com" MX2="mx2.improvmx.com" ./infra/email-inbound-cutover.sh
#
# Dry-run (default): prints planned changes. Pass --apply to mutate DNS.

set -euo pipefail

ZONE="${ZONE:-thegoodsort.org}"
RG_DNS="${RG_DNS:-}"          # auto-discovered if empty
MX1="${MX1:-}"
MX2="${MX2:-}"
APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

if [ -z "$MX1" ] || [ -z "$MX2" ]; then
  echo "ERROR: set MX1 and MX2 to your forwarder's MX hosts." >&2
  echo "  Example: MX1=mx1.improvmx.com MX2=mx2.improvmx.com $0 --apply" >&2
  exit 1
fi

if ! az account show >/dev/null 2>&1; then
  echo "ERROR: az login required." >&2
  exit 1
fi

if [ -z "$RG_DNS" ]; then
  RG_DNS="$(az network dns zone list --query "[?name=='$ZONE'].resourceGroup | [0]" -o tsv)"
fi
if [ -z "$RG_DNS" ] || [ "$RG_DNS" = "null" ]; then
  echo "ERROR: could not find Azure DNS zone for $ZONE in this subscription." >&2
  echo "Run: az account list -o table && az network dns zone list -o table" >&2
  exit 1
fi

echo "Zone: $ZONE  RG: $RG_DNS"
echo "Current MX:"
az network dns record-set mx list -g "$RG_DNS" -z "$ZONE" -o table || true
echo
echo "Planned MX: 10 $MX1 , 20 $MX2"
echo "SPF will be set to: v=spf1 include:azurecomm.net include:spf.protection.outlook.com ~all"
echo "(keeps ACS send; Outlook include left during transition — tighten later)"

if [ "$APPLY" -ne 1 ]; then
  echo
  echo "Dry-run only. Re-run with --apply to mutate DNS."
  exit 0
fi

# Replace MX
az network dns record-set mx delete -g "$RG_DNS" -z "$ZONE" -n "@" --yes 2>/dev/null || true
az network dns record-set mx create -g "$RG_DNS" -z "$ZONE" -n "@" --ttl 300
az network dns record-set mx add-record -g "$RG_DNS" -z "$ZONE" -n "@" --exchange "$MX1" --preference 10
az network dns record-set mx add-record -g "$RG_DNS" -z "$ZONE" -n "@" --exchange "$MX2" --preference 20

# Ensure SPF still authorises ACS outbound
# (provider may also ask for a verification TXT — add manually from their dashboard)
echo "Update SPF TXT manually if needed — do not wipe MS=/domain-verification records ACS needs."
echo "Done. Propagate ~5–30 min, then send a test to admin@$ZONE and confirm it hits knox@tailor.au."
