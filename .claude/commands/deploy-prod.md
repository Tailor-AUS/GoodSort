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

4. **Verify deployment**
   - Frontend: `curl -sS -m 10 -o /dev/null -w "status=%{http_code}\n" "https://thegoodsort.org/"`
   - Backend: `curl -sS -m 10 -o /dev/null -w "status=%{http_code}\n" "https://api.livelyfield-64227152.eastasia.azurecontainerapps.io/api/health"`

## Important
- Frontend deploy is triggered by ANY push to main
- Backend deploy is triggered ONLY when `src/**` files change
- CSP changes in `staticwebapp.config.json` take effect on frontend deploy
- Backend env vars may need re-applying via `infra/restore-secrets.sh` if new ones are added
