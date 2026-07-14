# GoodSort — handoff (2026-07-14)

Previous handoff (2026-05-24 hardening pass) is in git history; everything in
it landed on main. This handoff covers the marketing launch + ops pass.

## Open PRs (deliverables of this pass)

1. **PR #4 — `feat/marketing-launch`**: public landing page at `/`, SEO
   (sitemap/robots/OG images, schema.org), `(sorter)` → `/sort`, auth-guard
   redirects to `/`, next 16.2.9. Copy is written around the B2B model
   (~$149/mo per building subscription = the MRR line; households = supply
   flywheel).
2. **PR #5 — `fix/marketplace-ownership-ci-vision`**: CI backend deploy
   replaced `container-apps-deploy-action@v2` (broken azext_containerapp CLI
   bug) with `azure/cli@v2` running `az acr build` + `az containerapp update`;
   restore-secrets defaults `AZURE_OPENAI_DEPLOYMENT=gpt-5-mini`.
3. **PR (this branch) — `feat/sovrgn-inference`**: LLM inference routes
   through Sovrgn (`api.sovrgn.ai`, OpenAI-compatible) when `SOVRGN_API_KEY`
   is set; falls back to Azure OpenAI. Vision health endpoint now reports
   `sovrgnFallback`.

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
