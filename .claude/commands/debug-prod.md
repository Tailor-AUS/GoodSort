Debug a production issue. Argument: description of the problem (e.g. "scans returning 401", "Google Maps not loading on onboard page").

## Steps

1. **Check infrastructure health**
   - Frontend: `curl -sS -m 10 -o /dev/null -w "status=%{http_code}\n" "https://thegoodsort.org/"`
   - API health: `curl -sS -m 10 "https://api.livelyfield-64227152.eastasia.azurecontainerapps.io/api/health"`
   - Test specific endpoints with appropriate HTTP methods

2. **Check deployed version vs repo**
   - Fetch frontend: `curl -sS "https://thegoodsort.org/" | grep -o 'app-version[^"]*"'`
   - Compare with `git log --oneline -5 origin/main`
   - If versions don't match, deploy may still be in progress

3. **Identify the bug category**
   - **API errors (401/403/500)**: Check auth headers, CORS origins in `Program.cs`, endpoint logic
   - **CSP blocking**: Check `staticwebapp.config.json` — Google Maps needs both `maps.googleapis.com` AND `maps.gstatic.com` in `script-src`
   - **Missing auth token**: Direct `fetch()` calls must include Bearer token — check if `getAuthHeaders()` or `apiFetch()` is used
   - **Frontend JS errors**: Fetch and inspect the deployed JS bundle chunks
   - **Vision/scan failures**: Test scan endpoint directly with curl + auth token

4. **Fix and deploy**
   - Make the fix on the designated feature branch
   - Typecheck: `npx tsc --noEmit`
   - Commit with clear description of root cause
   - Use `/deploy-prod` to ship

## Common production issues
- **Scans failing**: Scanner uses raw `fetch()` — auth header may be missing. Check `app/components/shared/scanner.tsx`
- **Google Maps errors**: CSP in `staticwebapp.config.json` missing a Google domain
- **Onboard blocking**: Address geocoding fallback — check `app/(auth)/onboard/page.tsx`
- **Balance not updating**: Check `pendingCents` vs `clearedCents` flow in `lib/store.ts` and `store-api.ts`
