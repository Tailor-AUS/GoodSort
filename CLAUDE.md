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
dotnet test src/GoodSort.Api.Tests --nologo   # density / address-parse invariants
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
- **CSP updates**: When adding new external script or API origins, update `staticwebapp.config.json` — not just the code. Map stack needs `tiles.openfreemap.org`, `photon.komoot.io`, and `router.project-osrm.org` in `connect-src`.
- **Auto-migrations**: The backend runs EF Core migrations on startup (with retry logic for SQL container readiness). No manual `database update` needed in prod.
- **Postdeploy secrets**: `azd deploy` strips env vars not in the Aspire manifest. The `infra/restore-secrets.sh` postdeploy hook re-applies them from the azd environment.
- **CORS origins**: Backend restricts to `thegoodsort.org` + the SWA staging domain. Add new origins in `Program.cs` if needed.
- **Single-file API**: All ~67 endpoints live in `Program.cs`. When adding endpoints, follow the existing minimal API pattern there — don't create controllers.
- **Thin test suite**: `GoodSort.Api.Tests` covers address parse / city-wide Brisbane must never cluster. CI and API deploy run those tests. Frontend still has no unit tests — browser-QA marketing and onboard flows.
- **SWA preview environments are capped at 3.** Once the cap is hit, every PR's preview deploy fails with `already has the maximum number of staging environments` — and it fails *quietly*: `gh pr checks` shows the newest run per workflow, which for a merged PR is the close job, so the failed preview never appears. PRs #24 and #25 both merged with a failed preview that looked green. `prune-swa-previews.yml` reconciles this every 4h (an environment should exist only while its PR is open), but if PR previews start failing, check the environment list first.
- **App version meta**: `app/layout.tsx` has `<meta name="app-version" content="YYYYMMDD-HHMM">`. `debug-prod` reads this to confirm a deploy actually landed; bump it when shipping user-visible changes.
- **JSON cycle handling**: `Program.cs` sets `ReferenceHandler.IgnoreCycles` because `Run ↔ RunnerProfile` (and similar EF nav properties) would otherwise blow up serialization. Keep this in mind when adding entities with circular relationships.
- **We own our own Communication Service.** OTP email goes through `goodsort-comm` in `rg-GoodSort`, with `thegoodsort.org` linked to it. It used to go through tailor-app's shared `tailor-prod-comm`; their Bicep declares that service's `linkedDomains` array, so every tailor-app infra deploy silently dropped our domain and took signups down — three times on 2026-08-31 alone. The domain *resource* still lives under `tailor-prod-email` and is only ever referenced, never rewritten. A domain can be linked to two Communication Services at once, which is why this needed no DNS change. Don't point anything back at `tailor-prod-comm`.
- **One ACS link implementation**: `scripts/ensure-acs-domain-linked.sh`, called by `deploy-api.yml`, `acs-domain-guard.yml` and `infra/restore-secrets.sh`. It was previously copy-pasted into all three, and all three carried the same crash — `az ... --query linkedDomains -o json` prints *empty*, not `null`, when the array is absent, so the self-heal only ever died when it was actually needed. Exit codes are the contract: `0` linked, `1` repair failed, `2` could not check.
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
