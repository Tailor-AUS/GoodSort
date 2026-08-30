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
- `ADMIN_SEED_EMAIL` / `OPS_ALERT_EMAIL` are **not set on prod**. Until one is,
  `SendOpsStreetReady` logs a warning and returns — so when a suburb crosses the
  threshold, residents get emailed but nobody is told to buy bins.
