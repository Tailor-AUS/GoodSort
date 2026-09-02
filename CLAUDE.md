# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important: Next.js Version

This project uses **Next.js 16** with breaking changes from what you know. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Build & Dev Commands

### Frontend (Next.js — static export)
```bash
npm ci                    # install deps
npm run build             # production build (no map API keys required — OSS stack)
npm run dev               # dev server
npx tsc --noEmit          # typecheck
npm test                  # Node test runner over lib/**/*.test.ts (needs Node 22.6+)
dotnet test src/GoodSort.Api.Tests --nologo   # density / address-parse invariants + HTTP-level tests
```

### Backend (.NET 9 — minimal API)
```bash
dotnet restore src/GoodSort.sln
dotnet build src/GoodSort.sln -c Release
dotnet run --project src/GoodSort.Api/GoodSort.Api.csproj    # local dev
dotnet publish src/GoodSort.Api/GoodSort.Api.csproj -c Release -o publish
```

### Local dev with Aspire (recommended)
```bash
dotnet run --project src/GoodSort.AppHost
```
This spins up SQL Server in Docker, runs the .NET API, and starts the Next.js frontend with `NEXT_PUBLIC_API_URL` auto-injected. Requires Docker running.

### Database migrations (EF Core + Azure SQL)
```bash
dotnet ef migrations add <Name> --project src/GoodSort.Api
dotnet ef database update --project src/GoodSort.Api
```
Never hand-author migration files — always use `dotnet ef migrations add`.

## Architecture

### Two-tier: static SPA + REST API

**Frontend** — Next.js 16 with `output: "export"` (fully static, no SSR). Deployed to **Azure Static Web Apps** — resource `swa-goodsort-prod` in **`rg-goodsort-prod`** (note: *not* `rg-GoodSort`, which holds the API); `kind-mushroom-0fe89a200` is only its hostname prefix. Triggered on push to `main`.

**Backend** — .NET 9 minimal API (`src/GoodSort.Api/Program.cs` — single file with all endpoints). Deployed to **Azure Container Apps** via Docker. Triggered on push to `main` when `src/**` changes. API base: `https://api.livelyfield-64227152.eastasia.azurecontainerapps.io`.

**Database** — Azure SQL Server via EF Core. Connection string: `GOODSORTDB_CONNECTION_STRING`.

### Frontend structure

```
app/
├── layout.tsx       # Wraps everything in <AuthGuard>; bump app-version meta on each ship
├── (auth)/          # login, verify (OTP), onboard
├── (sorter)/        # main app — map view, scanner, sorting (sorter-sheet.tsx is the bottom sheet)
├── (runner)/        # runner pickup flow
├── admin/           # admin dashboard, bins, users, pickups
├── components/shared/  # scanner.tsx, map-view.tsx, account-panel.tsx, logo.tsx,
│                       # auth-guard.tsx, install-prompt.tsx, address-autocomplete.tsx,
│                       # sort-animation.tsx, powered-by-tailor.tsx, account-button.tsx,
│                       # waitlist-card.tsx
├── scan/            # unauthenticated demo scan page
├── start/           # landing/marketing page
├── household/       # household management
├── privacy/ terms/  # static legal pages
lib/
├── brisbane.ts        # BCC suburbs, LIVE_VOLUME_THRESHOLD (1000 containers), invite copy
├── config.ts          # API_URL from NEXT_PUBLIC_API_URL env var
├── store.ts           # Types, constants (SORTER_PAYOUT_CENTS=5), localStorage state, 4-bag system
├── store-api.ts       # API wrapper — apiFetch() adds Bearer token; offline-first (writes local first, then syncs)
├── containers.ts      # Barcode → container name lookup
├── routes.ts          # Route optimization helpers
├── clustering.ts      # Household clustering for run generation
├── streams.ts         # Material stream metadata (aluminium/PET/glass/other)
├── marketplace.ts     # Runner marketplace types/helpers
└── marketplace-api.ts # Runner marketplace API calls
```

### Backend structure

```
src/GoodSort.Api/
├── Program.cs           # ALL ~67 endpoints defined here (minimal API style, ~1300 lines)
├── Services/
│   ├── VisionService.cs            # Tailor Vision API → Azure OpenAI fallback
│   ├── AuthService.cs              # OTP via Azure Communication Services, JWT issuance
│   ├── CashoutService.cs           # ABA bank file generation
│   ├── BinDayService.cs            # Council bin day lookup
│   ├── RunnerService.cs            # Runner matching and assignment
│   ├── RunGenerationService.cs     # IHostedService: generates collection runs
│   ├── PickupReminderService.cs    # Scoped service + PickupReminderHost background loop
│   ├── NotificationService.cs      # Push/email notifications via ACS
│   └── PricingService.cs           # Per-container payout rates
├── Data/
│   ├── GoodSortDbContext.cs # EF Core context (Azure SQL)
│   └── Entities/            # Profile, Household, Scan, Run, RunStop, Bin,
│                            # Depot, Recycler, Route, RunnerProfile,
│                            # RunnerRating, Collection, OtpCode,
│                            # PricingConfig, VisionCall
└── Migrations/              # EF Core migrations (auto-generated only)
```

**Aspire AppHost** (`src/GoodSort.AppHost/Program.cs`) is local-dev only. In `IsRunMode` it spins up SQL Server in Docker and the Next.js dev server (`npm run dev`) wired to the API's endpoint; in publish mode it just declares the API project so `azd deploy` knows what to push.

**Service defaults** (`src/GoodSort.ServiceDefaults/`) supplies the shared `AddServiceDefaults()` / `MapDefaultEndpoints()` (health, OpenTelemetry, resilience) used by `Program.cs`.

### Auth flow

1. User enters email/phone → `POST /api/auth/send-otp` (sends 6-digit OTP via Azure Communication Services)
2. User enters OTP → `POST /api/auth/verify-otp` (returns JWT token)
3. Three localStorage keys: `goodsort_token` (JWT), `goodsort_profile` (server profile — `getStoredUserId()` reads `.id` from this), `goodsort_user` (full local User mirror written by `saveUser()` in `lib/store.ts`)
4. All API calls attach `Authorization: Bearer <token>` via `apiFetch()` in `lib/store-api.ts`
5. Direct `fetch()` calls (e.g. in scanner) must manually include the auth header

### Offline-first writes

`store-api.ts` mutations (e.g. `addScanApi`) write to localStorage **first**, then fire-and-forget sync to the API. `apiFetch` returns `null` on any failure (network or non-2xx) and reads fall back to local data. Don't add throw-on-error to `apiFetch` without rethinking the offline story.

### Vision / scanning flow

1. User takes photo → `POST /api/scan/photo` with base64 image
2. Backend calls **Tailor Vision API** (`POST api.tailor.au/api/vision/classify`) with `X-Api-Key` header
3. If Tailor Vision fails or is unconfigured → falls back to **Azure OpenAI** with a container identification prompt
4. Returns `{containers: [{name, material, count, eligible}], message}`
5. User confirms → `POST /api/scan/photo/confirm` creates Scan records and credits `pendingCents`

### Key domain concepts

- **Scan first, collect on volume**: Join, then scan eligible containers (5¢ sorting credit pending). Sort into own bags (4 streams). A suburb **volume run** unlocks when there are enough scanned containers for one driver trip (~`LIVE_VOLUME_THRESHOLD` = 1000). Households bag out; we take containers to a refund point/depot. Waitlisted houses can scan but are not on a run until `delivered`/`collecting`. `GET /next-pickup` is confirmed only when delivered/collecting. Ops allocate from `/admin/waitlist`.
- **Bag-out collection**: Households sort in their own bags. Collection is bag-out → refund point/depot.
- **4-bag sorting system**: Blue (aluminium), Teal (PET), Amber (glass), Green (other). **Scanner is the growth loop** — scan → 5¢ → suburb volume.
- **Two balance types**: `pendingCents` (scan credited, not yet cleared) and `clearedCents` (cashout-eligible). $20 minimum to cash out.
- **Runs**: Volume-gated collection routes for runners. Runner picks up bagged containers (or TGS bins) from collecting households, delivers to refund point/depot, settles.
- **CDS**: QLD Container Refund Scheme (Containers for Change). 10¢ refund per eligible container when presented at a refund point. GoodSort pays 5¢ sorting credit to sorter. Sorting credits are a private reward, not the scheme refund.

## Environment Variables

### Frontend (build-time, `NEXT_PUBLIC_` prefix)
- `NEXT_PUBLIC_API_URL` — backend API base URL

### Backend (runtime)
- `JWT_SECRET` — symmetric key for JWT signing
- `GOODSORTDB_CONNECTION_STRING` — Azure SQL connection
- `TAILOR_VISION_API_KEY` / `TAILOR_VISION_API_URL` — Tailor Vision API
- `SOVRGN_API_KEY` — leftover. PR #8 revoked the consumer. Do not set. A leftover key is logged and ignored.
- `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_KEY` / `AZURE_OPENAI_DEPLOYMENT` — vision fallback after Tailor Vision
- `ACS_CONNECTION_STRING` / `ACS_EMAIL_SENDER` — Azure Communication Services (OTP emails)
- `OSRM_URL` (optional) — defaults to `https://router.project-osrm.org` (public demo). Override with a self-hosted OSRM instance for production scale.
- `SCAN_DAILY_CAP` (default 2000) / `SCAN_RATE_PER_MINUTE` (default 60) — bounds on `/api/scans`, per member. That endpoint takes the barcode, name and material from the request body and **cannot prove a container was physically scanned** — the photo path has a server-signed token, this one has nothing, and it can't: the client is the only witness. Pending credit isn't the exposure (it only becomes cashable via a runner's physical count at settlement); **suburb volume is**, because volume sends a real van to a real kerb. These are mitigation, not prevention. Set either to `0` to disable that limit — a zero cap means *no limit*, not *no scanning*.
- `RECOVERY_EMAIL_ENABLED` (optional, **default off**) — set to `true` to let the hourly pass email members whose household has no usable suburb. Those members are invisible to every other recipient query in `NotificationService`, so without this nothing ever reaches them again. Left off deliberately: the code being ready is not the same as deciding to email real members. Selection rules and the 7-day cooldown are in `IncompleteHouseholdRecovery`.

### Mapping stack (open-source, no API keys)
- **Map renderer**: `maplibre-gl` (MIT)
- **Tiles**: OpenFreeMap (`https://tiles.openfreemap.org/styles/liberty`) — OSM-based, free forever, no key
- **Geocoding + autocomplete**: Photon by komoot (`https://photon.komoot.io/api/`) — OSM-based, free, no key. Reasonable AU coverage but lower fidelity than Google Places.
- **Routing/waypoint optimization**: OSRM (`https://router.project-osrm.org/trip/v1/driving/...`) — public demo endpoint for pilot, self-host on Azure for production scale.

## Deployment

- **Frontend**: Push to `main` → GitHub Actions builds static export → Azure Static Web Apps
- **Backend**: Push to `main` with changes in `src/` → GitHub Actions builds Docker image → Azure Container Apps
- **CSP**: `staticwebapp.config.json` controls Content-Security-Policy. When adding new external script/API origins, update CSP there.
- **CORS**: Backend restricts to `thegoodsort.org` and the SWA preview domain (in `Program.cs`)

## Gotchas

- **No SSR**: `next.config.ts` has `output: "export"` — everything is static. No server components, no API routes in Next.js, no `getServerSideProps`.
- **Auth in direct fetch()**: If you add a new `fetch()` call to the backend outside of `lib/store-api.ts`, you must manually attach the Bearer token from `localStorage.getItem("goodsort_token")`. The `apiFetch()` wrapper does this automatically.
- **CSP updates**: When adding new external script or API origins, update
  `public/staticwebapp.config.json` — not just the code. Map stack needs
  `tiles.openfreemap.org`, `photon.komoot.io`, and `router.project-osrm.org` in
  `connect-src`. `lib/csp.test.ts` fails if client code names a host that is
  neither in `connect-src` nor declared as never-fetched.
- **The SWA config must live in `public/`, and did not until 2026-08-31.** It sat
  at the repo root for the whole life of the site. The workflow uploads `out/`
  with `skip_app_build: true`, and a Next static export only copies `public/`
  into `out/` — so the file never reached the artifact and **every header it
  declares was absent in production**: no CSP, no `X-Frame-Options`, no
  `Referrer-Policy`, no `Permissions-Policy`. Only SWA's own two defaults were
  served. Nothing about this is visible from the repo: the file exists, the JSON
  is valid, the build is green and the deploy succeeds. Check a real response,
  not the file:
  ```
  curl -s -D - -o /dev/null https://thegoodsort.org/ | grep -i content-security
  ```
  `lib/swa-config.test.ts` now fails if it moves back or a second copy appears
  at the root.
- **Auto-migrations**: The backend runs EF Core migrations on startup (with retry logic for SQL container readiness). No manual `database update` needed in prod.
- **Postdeploy secrets**: `azd deploy` strips env vars not in the Aspire manifest. The `infra/restore-secrets.sh` postdeploy hook re-applies them from the azd environment.
- **CORS origins**: Backend restricts to `thegoodsort.org` + the SWA staging domain. Add new origins in `Program.cs` if needed.
- **Single-file API**: All ~67 endpoints live in `Program.cs`. When adding endpoints, follow the existing minimal API pattern there — don't create controllers.
- **Tests, and what they actually cover**: `GoodSort.Api.Tests` mixes unit tests with tests that boot the real app over HTTP (`ActivationPathTests`, `VolumeMechanicTests`, `EndpointAuthPostureTests`) via `WebApplicationFactory<Program>` — Development + no connection string selects the in-memory provider, and Development + no `ACS_CONNECTION_STRING` makes `SendOtp` return the code instead of mailing it, so the real auth flow runs without a database or sending email. Frontend tests are Node's own runner over `lib/**/*.test.ts` (`npm test`), which is why `tsconfig.json` sets `allowImportingTsExtensions` and `lib/brisbane.ts` imports `./brisbane-suburbs.ts` with the extension — Node ESM will not resolve it otherwise. CI runs Node 22 for `--experimental-strip-types`.
- **Every `AddHostedService` runs in every replica, and this app scales to 10** (`maxReplicas` on the `api` Container App). Without coordination, `RunGenerationService` would generate runs over the same bins from ten instances at once — several drivers paid to collect the same containers, and vans sent to kerbs another driver already emptied. `SingletonLease` gates each pass on a named database lease so only one replica runs it; the lease expires so a replica dying mid-pass can't stop it forever. **Any new background pass needs one**, and the lease name must be its own or it will block the others.
- **`UseRateLimiter()` must come after `UseAuthentication()`.** Any policy that partitions by member calls `GetCallerId()`, which reads claims — unpopulated until authentication runs. With the limiter first, every caller partitions to `"anonymous"` and a per-member limit silently becomes one global bucket, so a single scripted account throttles every real member. That is worse than having no limit, and it looks fine in every test that uses one account.
- **There are two collection flows in the code and only one is alive.** `Run` / `RunStop` (the runner *marketplace*, `/api/marketplace/runs/*`, client `lib/marketplace-api.ts`) is the live one — `RunGenerationService` creates `Run` rows and the runner UI drives them. `CollectionRoute` / `RouteStop` (`/api/routes/*`, client functions in `lib/store-api.ts`) is **vestigial**: nothing constructs a `CollectionRoute` anywhere — not the generator, not an endpoint, not a migration (`InsertData` only ever seeds `Depots` and `PricingConfigs`) — and the eight `*RouteApi` client functions have no callers. So `GET /api/routes` returns `[]` and always will, and every other `/api/routes/*` endpoint operates on rows that cannot exist.
  Two consequences worth knowing before spending effort there. **Anything you find wrong in `/api/routes/*` is unreachable**, so weigh it accordingly — I hardened that half three times before noticing (#31, #50, #56), and the parallel marketplace fixes in the same PRs are the ones that matter. And **duplicate logic lives in both halves** — settle, pickup, self-credit clamp, status transitions — so a fix to one is not a fix to the other. Removing the dead half means dropping tables, which is a product decision, not a cleanup.
- **Money paths were all check-then-act. Assume the next one is too.** Three separate places read a value, compared it, then wrote back — crediting a scan (`/confirm` against a signed token that proved genuine but not *unspent*), settling a route or run (a status check that two concurrent requests both pass), and cashing out (`ClearedCents` read, compared, decremented). Each is a double-spend, and settling twice is the worst because it *mints* cash-out-eligible money rather than over-paying an existing balance. There is **no concurrency token on any entity**. The fix pattern is a single conditional `UPDATE` — the test in the `WHERE` clause of the statement that does the write (`StatusClaim`, `CashoutService.TryDeductCleared`) — or a primary key that only one caller can win (`UsedScanToken`).
- **The InMemory provider cannot prove any of that.** It can't translate `ExecuteUpdate`/`ExecuteDelete`, so every such call has a non-atomic fallback and *that* is the branch tests execute — the production branch has zero coverage, and mutating it leaves suites green. It also can't run two contexts concurrently, so a read-compare-write implementation passes the same tests as the atomic one. Tests here pin the *rules*; atomicity is a property of the SQL statement. `SqlConcurrencyTests` closes that gap — it runs against a real SQL Server service container in CI and fires genuinely concurrent requests, and CI fails if those tests are *skipped*, because a skipped test and a passing one look identical in a summary line. Verified by restoring the pre-fix cash-out code: eight of eight concurrent cash-outs succeeded against a balance covering one. If you add another money path, add a case there — an InMemory test alone will not notice the bug.
- **An endpoint's auth posture is only half of it — check what the body returns.** `/api/bins/code/{code}` has to be anonymous (the scanner resolves a bin from the printed code before sign-in) and it returned the whole `Bin` entity: household name, full address, exact coordinates, household id. Household bin codes are `GS-H{hash % 100000}`, a hundred-thousand-value space anyone can walk, and a bin exists for every residential household. Returning an EF entity straight from a handler publishes every column it will ever have, including ones added later. Project public responses to the fields the caller actually needs — `AnonymousBinLookupTests` asserts on the body, not the status code.
- **Adding an endpoint? It is anonymous by default.** A minimal-API route has no auth unless you add `.RequireAuthorization()`, and forgetting it produces a working endpoint that leaks with nothing unusual in the build or the diff. It has happened twice — runner pickup coordinates, then `GET /api/routes` returning every `RouteStop`'s household name, address and coordinates. `EndpointAuthPostureTests` now fails unless every route is either authorized or listed in `IntentionallyPublic` **with a reason**, and separately requires every `/api/admin` route to use `AuthHelpers.AdminPolicy` — `.RequireAuthorization()` with no policy means any signed-in member, not staff.
- **SWA preview environments are capped at 3.** Once the cap is hit, every PR's preview deploy fails with `already has the maximum number of staging environments` — and it fails *quietly*: `gh pr checks` shows the newest run per workflow, which for a merged PR is the close job, so the failed preview never appears. PRs #24 and #25 both merged with a failed preview that looked green. `prune-swa-previews.yml` reconciles this every 4h (an environment should exist only while its PR is open), but if PR previews start failing, check the environment list first.
- **App version meta**: `app/layout.tsx` has `<meta name="app-version" content="YYYYMMDD-HHMM">`. `debug-prod` reads this to confirm a deploy actually landed; bump it when shipping user-visible changes.
- **Ask the API which commit it is, rather than inferring it from a green run.**
  `GET /api/version` returns `{ sha, buildTime, service }` — anonymous, so a
  probe or a person can use it without a token. The sha comes from a
  `GIT_SHA` build arg that `deploy-api.yml` passes to `az acr build`.
  A green workflow run is *not* proof the change is live: a run can go green
  having taken a path that never shipped the component you changed, which is
  how three sender-domain incidents in one day each looked fine in Actions.
  Verify a backend deploy by comparing this sha to the merge commit:
  ```
  curl -s https://api.livelyfield-64227152.eastasia.azurecontainerapps.io/api/version
  ```
  `"unknown"` means the image was built without the build arg — an unstamped
  build, not a broken endpoint. Anything added to that response is public;
  `VersionEndpointTests` fails on any field beyond the three.
- **JSON cycle handling**: `Program.cs` sets `ReferenceHandler.IgnoreCycles` because `Run ↔ RunnerProfile` (and similar EF nav properties) would otherwise blow up serialization. Keep this in mind when adding entities with circular relationships.
- **We own our own Communication Service.** OTP email goes through `goodsort-comm` in `rg-GoodSort`, with `thegoodsort.org` linked to it. It used to go through tailor-app's shared `tailor-prod-comm`; their Bicep declares that service's `linkedDomains` array, so every tailor-app infra deploy silently dropped our domain and took signups down — three times on 2026-08-31 alone. The domain *resource* still lives under `tailor-prod-email` and is only ever referenced, never rewritten. A domain can be linked to two Communication Services at once, which is why this needed no DNS change. Don't point anything back at `tailor-prod-comm`.
- **One ACS link implementation**: `scripts/ensure-acs-domain-linked.sh`, called by `deploy-api.yml`, `acs-domain-guard.yml` and `infra/restore-secrets.sh`. It was previously copy-pasted into all three, and all three carried the same crash — `az ... --query linkedDomains -o json` prints *empty*, not `null`, when the array is absent, so the self-heal only ever died when it was actually needed. Exit codes are the contract: `0` linked, `1` repair failed, `2` could not check.
- **A green CI run does not gate the deploy — they race.** `ci.yml` and
  `deploy-api.yml` both trigger on the same push to `main`, with no `needs:` and
  no `workflow_run:` between them, so a red CI cannot stop or roll back a deploy
  already in flight. That mattered because the elaborate "concurrency tests must
  have actually run" guard lived only in `ci.yml`, while `deploy-api.yml` ran
  `dotnet test` with **no SQL service and no `GOODSORT_TEST_SQL`** — so all
  twelve `SqlConcurrencyTests` skipped on the path that ships the image. The
  deploy that built the then-current production image logged
  `Passed: 295, Skipped: 12` and shipped anyway. Run `33360405276` proves the
  stakes: it restored the pre-fix cash-out race and the *only* failures were
  those tests. `deploy-api.yml` now carries its own SQL service and its own
  skip guard. **Until a deploy depends on CI, a gate that is not on the shipping
  path is not a gate.** Deploy logs should read `Skipped: 0`.
- **`dotnet ef migrations add --no-build` can silently emit an empty migration.**
  It uses the already-compiled assembly, so an entity change that has not been
  rebuilt produces `Up()` and `Down()` bodies that are *blank* — exit code 0, no
  warning. It then applies cleanly in production, creates nothing, and the first
  query touching the column throws `Invalid column name`. **Open the generated
  file and confirm the operation is there.** Verify the column really landed
  with a read against the altered table in production (a 200 rather than a 500),
  not with a green deploy.
- **Config keys the code reads are not all restored after a deploy.**
  `azd deploy` strips anything the Aspire manifest does not declare;
  `infra/restore-secrets.sh` restores nine, and the code reads about thirty. The
  rest fall back to their code defaults, which today is safe by design —
  `ADMIN_BOOTSTRAP_SECRET` unset makes the bootstrap endpoint 404, ABA payouts
  stay closed without real remitter details, a missing ops inbox logs a warning
  naming both variables. `ConfigRestoreCoverageTests` keeps it that way: every
  key must be either restored or declared safe to lose **with a reason**. Add a
  key with a fail-open default and it fails.
- **A test that reads source must strip comments first.** Several checks here
  scan `.tsx`/`.cs` text for a structural property — z-index ordering, accessible
  names, control flow. Three of them failed on correct code because they matched
  their own explanatory comment: a comment reading "at z-[60] this sat above the
  scanner's z-50" scored as a z-60, and one quoting `"+5c added to your account"`
  was found before the real code. Strip `//` and block comments before matching,
  and prefer `lastIndexOf` for a closing brace when the block can contain a
  nested `try`/`catch`. Two empty sets also compare equal, so assert the
  extraction found something before trusting what it found.
- **`ACS_CONNECTION_STRING` is a container-app secret**, referenced via `secretRef` — not a plaintext env var. It held tailor-app's shared access key in plaintext until 2026-08-31.

## Mandatory QA — live browser preview

Every piece of autonomous work that touches the frontend or an API surface the frontend consumes MUST be QA'd in a live preview before you report it done:

1. Start the dev server: `npm run dev` (or full stack via `dotnet run --project src/GoodSort.AppHost` if the change spans the API).
2. Load the Claude in Chrome browser tools (one ToolSearch call: `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__read_console_messages`).
3. Open `http://localhost:3000` in a new tab and drive the actual flows you changed — click through them, don't just load the page.
4. Check the browser console for errors (`read_console_messages`) and screenshot the result.

Do not claim a change works from a build or typecheck alone. API density tests are required; the live browser pass is still the QA gate for UI.

## Production URLs

- **Frontend**: `https://thegoodsort.org` (custom domain on Azure SWA)
- **Backend API**: `https://api.livelyfield-64227152.eastasia.azurecontainerapps.io`
- **Legal entity**: Crispr Projects Pty Ltd (ABN 85 680 798 770)
