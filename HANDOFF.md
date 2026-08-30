# GoodSort — handoff (2026-07-15)

**Superseded 25 Aug 2026.** Do not follow the Sovrgn-on steps below. PR **#8**
revoked the Sovrgn consumer. Do not set `SOVRGN_API_KEY`. The live product
block is the waitlist ship — see
`C:\TailorOS\_session_handoffs\HANDOFF_TGS_WAITLIST_SHIP_2026-08-25.md`.
Conversion is scan-first suburb volume, not scan-every-can. Do not fill ABA.
Do not send mail.

---

Refresh of the 2026-07-14 handoff (in git history). The three PRs from that
pass — #4 marketing launch, #5 CI/vision fix, #6 Sovrgn inference routing —
have all **merged to main**. Main is synced with origin. PR **#8** later
revoked Sovrgn. Ignore the “flip prod” commands in the Sovrgn section.

## Uncommitted local change — commit first

`CLAUDE.md` has a new **"Mandatory QA — live browser preview"** section
(added 2026-07-15): any frontend/API-surface change must be QA'd by running
`npm run dev` and driving the changed flows via the Claude in Chrome browser
tools (console check + screenshot) before reporting done. This is now the QA
gate (no test suite exists). Commit this to main before starting new work.

## Open PRs (pre-existing, need triage)

1. **PR #3 — `claude/modest-sagan-nGiQY`** (open since 2026-06-16): "Launch
   hardening: auth/PII fixes, ABA payout, JWT revocation, SEO & CI". Predates
   the #4/#5/#6 merges — likely overlaps/conflicts with them now. Rebase and
   salvage what's still relevant, or close with a note.
2. **PR #2 (draft, Copilot)**: glass containers always CDS-eligible
   (overrides Tailor Vision's stale wine/spirit ruleset). Review whether the
   eligibility bug still exists post-#6, then land or close.

## Sovrgn rollout — blocked on a key

`api.sovrgn.ai` is live (`/health` 200, `/v1/*` returns OpenAI-style 401
`invalid_api_key`). No Sovrgn API key exists in any local env. To flip prod:

```bash
azd env set SOVRGN_API_KEY <key>
azd env set SOVRGN_MODEL <model>     # required alongside the key
# then either azd deploy (postdeploy hook restores) or directly:
az containerapp update -n api -g rg-GoodSort --set-env-vars \
  SOVRGN_API_KEY=<key> SOVRGN_API_URL=https://api.sovrgn.ai/v1 SOVRGN_MODEL=<model>
```

No Sovrgn model catalogue is published; get the model name from the Sovrgn
side (Knox owns it — see the AloomU/Sovrgn SAFE thread).

## ⚠️ thegoodsort.org email is a SEPARATE M365 tenant

Discovered 2026-07-14 while auditing founder outreach:

- `thegoodsort.org` is verified in its own tenant: **NETORG20627853.onmicrosoft.com**,
  tenant id `1945399a-0691-45fb-8534-73a0c8919c69` ("thegoodsort org").
  MX → `thegoodsort-org.mail.protection.outlook.com`; SPF includes
  outlook + azurecomm (ACS OTP sending).
- `admin@thegoodsort.org` is NOT reachable from the tailor.au / tailorco.au
  tenants (no delegate access), and the tenant is not in `az account list`.
- **Known outbound founder email:** EOI to `expansion@coex.com.au`
  (COEX Expansion Team) sent 2026-04-18 from `admin@thegoodsort.org`,
  cc `Knox@tailor.au` — asks about CRP registration, handling fees, digital
  evidence chain, RVM hire. **No reply ever arrived at Knox@tailor.au and the
  mailbox that would hold a reply is in the inaccessible tenant.** COEX may
  have replied there — or the EOI may be sitting unanswered for ~3 months.
- **Action for Knox:** log into the NETORG20627853 tenant (the M365 Basic
  admin account created when the domain was bought), check
  `admin@thegoodsort.org` for a COEX reply, and either grant
  `Knox@tailor.au` delegate access or set a forwarding rule so this can be
  monitored from the main account. Follow up with COEX either way.

## Prod state (unchanged this pass)

- 0 scans/24h, MRR $0. Prod live at thegoodsort.org / api on Container Apps.
- Tailor Vision (BAINK) still HTTP 402 `environment_not_ready` since
  2026-04-19 — needs Tailor-side tenant re-provisioning. Fallback
  `gpt-5-mini` works; azd env updated in both checkouts
  (`C:\TailorOS\thegoodsort-app` and `C:\Users\knoxh\GoodSort`).
- Vision health check: `GET /api/admin/vision/health` with admin JWT
  (admin@tailorco.au, profile `1f37ac92-9121-486e-842d-cd716155da1c`,
  OTP-to-email auth). Healthy = `verdict: green`.
- **ABA source account is still the placeholder** (`062-000` / `12345678`)
  in `CashoutService.GenerateAbaFile` — awaiting Knox's real settlement
  account. Do not fill without Knox.
- Container App secrets are still plaintext env vars — Key Vault migration
  still outstanding (see 2026-05-24 handoff follow-ups, all still open:
  BSB encryption at rest, JWT rotation, CSP unsafe-inline, OTel NU1902).

## Local tree notes

- `stash@{0}` (autostash) predates this pass — left untouched, do not drop.
- azd env for this repo lives in `.azure/GoodSort/` (copied 2026-07-14 from
  the old `C:\Users\knoxh\GoodSort` checkout; gitignored, holds secrets).
