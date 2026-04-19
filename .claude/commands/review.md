Review code changes before merging. Argument: branch name or PR number.

## Steps

1. **Understand the scope**
   - `git log origin/main..HEAD --oneline` — commits to review
   - `git diff origin/main --stat` — files changed
   - `git diff origin/main` — full diff

2. **Check for issues**
   - **Auth**: Any new `fetch()` calls missing Bearer token? Must use `apiFetch()` from `lib/store-api.ts` or include `getAuthHeaders()`
   - **CSP**: New external domains need adding to `staticwebapp.config.json`
   - **CORS**: New frontend origins need adding in `Program.cs`
   - **No SSR**: No server components, no `getServerSideProps`, no Next.js API routes — `output: "export"` means fully static
   - **Migrations**: EF migrations must be auto-generated (`dotnet ef migrations add`), never hand-authored
   - **Types**: Run `npx tsc --noEmit` — must pass clean
   - **Backend build**: If `src/` changed, run `dotnet build src/GoodSort.sln -c Release` if dotnet is available
   - **Security**: No secrets in code, no XSS vectors, input validation at API boundaries

3. **Report findings**
   - List issues by severity (blocking, should-fix, nit)
   - For each issue: file path, line number, what's wrong, suggested fix
   - If clean: say so and approve
