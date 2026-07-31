# GTM email ops — take control of thegoodsort.org mail

Last updated: 2026-07-31

## Current state

| Path | Status | Notes |
|------|--------|-------|
| **Outbound (ACS)** | Working for OTP | `DoNotReply@thegoodsort.org` via `tailor-prod-comm` ACS in `rg-tailor-app-prod` |
| **Outbound (founder)** | New | `POST /api/admin/outreach/send` — From `@thegoodsort.org`, Reply-To `knox@tailor.au` |
| **Inbound (M365)** | Broken for us | MX → `thegoodsort-org.mail.protection.outlook.com`; mailbox lives in tenant `NETORG20627853` (`1945399a-0691-45fb-8534-73a0c8919c69`) which is **not** in Tailor Azure / Entra |
| **DNS** | Controllable | Azure DNS (`ns1-07.azure-dns.com` …) — once `az login` works we own MX/TXT |

SPF already allows both Outlook and ACS:

```
v=spf1 include:spf.protection.outlook.com include:azurecomm.net -all
```

## Goal

1. **Send** founder / COEX / recycler mail from `@thegoodsort.org` today (ACS).
2. **Receive** replies at an inbox Knox can actually open (`knox@tailor.au` via Reply-To now; full catch-all after MX cutover).
3. Recover or retire the stranded M365 Basic mailbox so April COEX replies (if any) are found.

## Outbound — ACS (do this first)

### 1. Azure login

```bash
az login
az account set --subscription 5745cb5e-8c39-470f-ab6f-8a5897b7f9af   # Tailor prod (confirm with az account list)
```

### 2. Confirm domain + add MailFroms

```bash
# List email domains on tailor-prod-email
az communication email domain list \
  -g rg-tailor-app-prod \
  --email-service-name tailor-prod-email -o table

# Add founder-facing senders (once domain Verified)
az rest --method put \
  --url "https://management.azure.com/subscriptions/5745cb5e-8c39-470f-ab6f-8a5897b7f9af/resourceGroups/rg-tailor-app-prod/providers/Microsoft.Communication/emailServices/tailor-prod-email/domains/thegoodsort.org/senderUsernames/hello?api-version=2023-06-01-preview" \
  --body '{"properties":{"username":"hello","displayName":"The Good Sort"}}'

az rest --method put \
  --url "https://management.azure.com/subscriptions/5745cb5e-8c39-470f-ab6f-8a5897b7f9af/resourceGroups/rg-tailor-app-prod/providers/Microsoft.Communication/emailServices/tailor-prod-email/domains/thegoodsort.org/senderUsernames/admin?api-version=2023-06-01-preview" \
  --body '{"properties":{"username":"admin","displayName":"Knox Hart · The Good Sort"}}'
```

Then:

```bash
azd env set ACS_OUTREACH_SENDER "hello@thegoodsort.org"
# re-run infra/restore-secrets.sh or az containerapp update …
```

Until MailFroms exist, outreach falls back to `DoNotReply@thegoodsort.org` with `SenderDisplayName` set (payload already does this).

### 3. Send COEX follow-up

```bash
# Admin OTP → JWT, then:
export API_URL=https://api.livelyfield-64227152.eastasia.azurecontainerapps.io
export TOKEN=…
./scripts/send-coex-followup.sh
```

Or use Azure MCP `communication_email_send` with endpoint `https://tailor-prod-comm.australia.communication.azure.com` (confirm via `az communication list`).

## Inbound — reclaim replies (MX cutover)

The stranded M365 tenant cannot be managed from Tailor Azure. Two options:

### Option A (recommended): Forward all mail to knox@tailor.au

Use a free catch-all forwarder that supports custom MX (ImprovMX / Forward Email / Cloudflare Email Routing). DNS is already on Azure DNS, so:

1. Sign up forwarder for `thegoodsort.org` → catch-all → `knox@tailor.au`
2. Run `infra/email-inbound-cutover.sh` (sets MX + required TXT; keeps SPF `azurecomm.net`)
3. Keep ACS linked for outbound OTP/outreach
4. Optionally leave Outlook MX as secondary during a short dual-MX window, then remove

**Effect:** any new mail to `admin@` / `hello@` / `*` lands in Knox's Tailor inbox. Historical mail in the M365 tenant is **not** migrated — still need Option B for that.

### Option B: Recover the M365 tenant

Knox logs into https://admin.microsoft.com as the NETORG20627853 Global Admin (the account created when the domain was bought — often the onmicrosoft.com admin). Then:

1. Search `admin@thegoodsort.org` for COEX reply (from/to `expansion@coex.com.au`, since 2026-04-18)
2. Add `knox@tailor.au` as shared mailbox delegate **or** set inbox rule: forward everything → knox@tailor.au
3. Prefer Option A going forward so we are not dependent on that orphan tenant

## COEX / CDS funding reality (FY26–27)

COEX does **not** issue cash grants. Economic upside for GoodSort:

| Lever | What it pays | Fit |
|-------|--------------|-----|
| Handling fees as CRP operator | Per-container (RVM commercial = **5.90¢**; depot higher if secondary sort) | Need CRP registration |
| RVM Asset Hire | Capex relief (X30 from **$706/mo**; CBOX3 from **$4,160/mo**), SEQ only | Building lobbies / B2B |
| Bag-drop / mobile pop-up CRP | Matches kerbside model; listed on 2025 CRP form | Confirm category with Expansion |
| Bill 2026 expanded PRO functions | Environmental/community programmes + network plan + surplus investment plan | Soft pilot ask only |
| 10¢ refund | Unchanged (gov rejected increase) | Unit economics stay as modelled |

Primary ask to COEX: **category guidance → open-market CRP application → handling fees**, with RVM hire as secondary channel.

## Checklist

- [ ] `az login` as Knox (Tailor subscription)
- [ ] Add ACS MailFrom `hello` + `admin`
- [ ] Set `ACS_OUTREACH_SENDER=hello@thegoodsort.org` on Container App
- [ ] Deploy API with `/api/admin/outreach/send`
- [ ] Send COEX follow-up (`scripts/send-coex-followup.sh`)
- [ ] Recover M365 inbox OR cut over MX to forwarder
- [ ] Lodge open-market CRP application once category confirmed
- [ ] Apply RVM hire if building site identified
