Deploy changes to production.

## Steps

1. **Verify the current branch and changes**
   - Run `git status` and `git log --oneline -5`
   - Run `npx tsc --noEmit` to typecheck frontend
   - If backend (.NET) files changed under `src/`, run `dotnet build src/GoodSort.sln -c Release` if dotnet is available

2. **Merge to main**
   - `git checkout main`
   - `git pull origin main`
   - `git merge --no-ff <branch> -m "Merge: <description>"`
   - Resolve any conflicts, preferring main for shared files

3. **Push to main**
   - `git push origin main`
   - This triggers two GitHub Actions workflows:
     - **Frontend**: Azure Static Web Apps build + deploy (~3-5 min)
     - **Backend**: Docker build + Azure Container Apps deploy (only if `src/**` changed)

4. **Verify deployment — a 200 is NOT proof the new build landed**

   A green run and a 200 are both consistent with the OLD bundle still being
   served: the frontend can take a cache-only fast path, and the API only
   redeploys when `src/**` changed. Check the served version, not the status.

   - Frontend — the stamp must match `app/layout.tsx`:
     `curl -sS -m 20 https://thegoodsort.org/ | grep -o 'app-version" content="[^"]*"'`
   - Backend — must return the fields the release added:
     `curl -sS -m 20 https://api.livelyfield-64227152.eastasia.azurecontainerapps.io/api/growth/brisbane`
     A response missing `launchBonusContainers` means the old image is running.
   - Migrations run on API startup (`Database.MigrateAsync`) — watch the first
     Container App revision come up before trusting the API.

## Important
- Frontend deploy is triggered by ANY push to main
- Backend deploy is triggered ONLY when `src/**` files change
- CSP changes in `staticwebapp.config.json` take effect on frontend deploy
- Backend env vars may need re-applying via `infra/restore-secrets.sh` if new ones are added
- `LAUNCH_BONUS_CONTAINERS` controls the double-credit launch promotion
  (defaults to 20 when unset). Set it to `0` on the Container App to switch the
  promotion off without a deploy; the homepage banner goes with it.
- `ADMIN_SEED_EMAIL` and `OPS_ALERT_EMAIL` are both set to `knox@tailor.au` on
  prod (verified 2026-08-30 — earlier handoffs saying otherwise are stale), so
  a suburb crossing the threshold does reach ops.
- **Email deliverability.** The stack is correctly configured, contrary to
  older handoffs. `ACS_EMAIL_SENDER` is `DoNotReply@thegoodsort.org` on the
  CustomerManaged ACS domain; Domain/SPF/DKIM/DKIM2 all report `Verified`; SPF
  is `v=spf1 include:spf.protection.outlook.com include:azurecomm.net -all`;
  and `_dmarc.thegoodsort.org` exists as
  `v=DMARC1; p=quarantine; adkim=r; aspf=r;`.

  Note ACS reports `DMARC: NotStarted` — that is ACS's own optional
  verification tracking, **not** the DNS reality. Do not chase it.

  The one real weakness is that the DMARC policy is `p=quarantine` (failures go
  straight to spam) with **no `rua=`**, so nobody ever sees a failure report.
  `tailor.au` by contrast uses `p=none; rua=mailto:postmaster@tailor.au`.
  Adding a `rua=` address changes no enforcement and would turn the
  "codes land in spam" theory into something measurable. Re-check with:
  ```
  nslookup -type=TXT _dmarc.thegoodsort.org 8.8.8.8
  az communication email domain show --email-service-name tailor-prod-email     --resource-group rg-tailor-app-prod --name thegoodsort.org     --query verificationStates -o json
  ```
