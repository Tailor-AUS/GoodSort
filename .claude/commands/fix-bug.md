Fix a bug from a screenshot or description. Argument: description of the bug or path to a screenshot.

## Steps

1. **Understand the bug**
   - If screenshot provided, read it and identify the page/component and error
   - Map the visual to the code: which route, which component, which API call
   - Check the browser URL / page context to identify the route group: `(auth)`, `(sorter)`, `(runner)`, `admin`

2. **Find the root cause**
   - Trace the data flow: component → API call → backend endpoint → database
   - Common root causes:
     - Missing auth header on `fetch()` (use `apiFetch` or `getAuthHeaders()`)
     - CSP blocking external scripts (`staticwebapp.config.json`)
     - State not updating (localStorage vs API sync in `store.ts` / `store-api.ts`)
     - Tailor Vision returning incorrect data (check `VisionService.cs`)
     - Google Maps/Places not loading (CSP + API key restrictions)

3. **Fix it**
   - Make the minimal change to fix the root cause
   - Typecheck: `npx tsc --noEmit`
   - Commit with clear root-cause description

4. **Deploy if urgent**
   - Use `/deploy-prod` to ship immediately
   - Otherwise push to feature branch for review
