# GoodSort — handoff (2026-07-31)

Previous handoff (2026-07-14 marketing + Sovrgn) is in git history. This pass
is **get-to-market**: email control + COEX/CDS follow-up.

## What landed this pass

1. **Admin outreach email API** — `POST /api/admin/outreach/send` sends via ACS
   from `@thegoodsort.org`, Reply-To defaults to `knox@tailor.au`.
2. **COEX follow-up pack** — `docs/coex-followup-2026-07.md` +
   `docs/coex-followup-payload.json` + `scripts/send-coex-followup.sh` /
   `scripts/acs-send-outreach.sh`.
3. **Email ops playbook** — `docs/gtm-email-ops.md` (outbound ACS MailFroms,
   inbound MX cutover, CDS funding reality for FY26–27).
4. **Inbound cutover script** — `infra/email-inbound-cutover.sh` (dry-run by
   default; needs forwarder MX hosts + `az login`).

## BLOCKED on Azure login (Knox)

This cloud agent has **no Azure credentials**. Device-code login was started;
complete it so the agent (or you) can:

1. Pull `ACS_CONNECTION_STRING` from Container App `api` / `rg-GoodSort`
2. Send the COEX follow-up **today** via `./scripts/acs-send-outreach.sh`
3. Add ACS MailFrom usernames `hello` + `admin` on `thegoodsort.org`
4. Cut over inbound MX off the stranded M365 tenant

```bash
# On a machine where Knox can complete device login:
az login
./scripts/acs-send-outreach.sh docs/coex-followup-payload.json
```

## Email situation (unchanged root cause)

- `thegoodsort.org` DNS is on **Azure DNS** (controllable once logged in).
- MX still points at Outlook tenant **NETORG20627853**
  (`1945399a-0691-45fb-8534-73a0c8919c69`) — not in Tailor `az account list`.
- April 18 EOI to `expansion@coex.com.au` may have a reply trapped there.
- Outbound OTP via ACS (`DoNotReply@thegoodsort.org`) still works; SPF already
  includes `azurecomm.net`.

**Immediate workaround:** send with Reply-To + Cc `knox@tailor.au` (payload
already does). **Durable fix:** ImprovMX/Forward Email catch-all → knox@tailor.au
via `infra/email-inbound-cutover.sh`, plus recover M365 for historical mail.

## COEX / CDS — FY26–27 policy snapshot

| Item | Status | Action |
|------|--------|--------|
| April 18 EOI | No reply seen at knox@tailor.au | Send follow-up (payload ready) |
| FY26–28 Strategic Plan | Partner for Growth; SEQ small formats | Pitch kerbside as waste partnership |
| CRP form | Includes **Bag Drop** + **Mobile Pop Up** | Ask Expansion for category, then apply |
| RVM Asset Hire | SEQ; new ops <$2.5m TO; X30 ~$706/mo; 5.90¢ | Secondary channel for buildings |
| Amendment Bill 2026 | Introduced Mar 26; committee pass recommended May 15; 2nd reading pending | Soft ask on pilot / surplus programmes |
| Refund increase | Gov **rejected** | Stay on 10¢ economics |

**Funding clarity:** COEX is industry-funded. Ask for **handling fees + RVM hire
(capex relief) + category guidance**, not a "grant".

## Still open from prior handoffs

- Sovrgn: code on main; prod flip blocked on API key + model name
- Tailor Vision BAINK: HTTP 402 since 2026-04-19 — fallback `gpt-5-mini` works
- ABA settlement account still placeholder — Knox only
- PR #3 launch hardening still open; PR #2 draft should stay unmerged
- Key Vault migration / BSB encryption still outstanding

## Prod

- Frontend: https://thegoodsort.org
- API: https://api.livelyfield-64227152.eastasia.azurecontainerapps.io
- Entity: Crispr Projects Pty Ltd (ABN 85 680 798 770)
