# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important: Next.js Version

This project uses **Next.js 16** with breaking changes from what you know. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Build & Dev Commands

### Frontend (Next.js — static export)
```bash
npm ci                    # install deps
npm run build             # production build (requires NEXT_PUBLIC_GOOGLE_MAPS_API_KEY env var)
npm run dev               # dev server
npx tsc --noEmit          # typecheck (no test suite exists)
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

**Frontend** — Next.js 16 with `output: "export"` (fully static, no SSR). Deployed to **Azure Static Web Apps** (`kind-mushroom-0fe89a200`). Triggered on push to `main`.

**Backend** — .NET 9 minimal API (`src/GoodSort.Api/Program.cs` — single file with all endpoints). Deployed to **Azure Container Apps** via Docker. Triggered on push to `main` when `src/**` changes. API base: `https://api.livelyfield-64227152.eastasia.azurecontainerapps.io`.

**Database** — Azure SQL Server via EF Core. Connection string: `GOODSORTDB_CONNECTION_STRING`.

### Frontend structure

```
app/
├── (auth)/          # login, verify (OTP), onboard
├── (sorter)/        # main app — map view, scanner, sorting
├── (runner)/        # runner pickup flow
├── admin/           # admin dashboard, bins, users, pickups
├── components/shared/  # scanner.tsx, map-view.tsx, account-panel.tsx, logo.tsx
├── scan/            # unauthenticated demo scan page
├── start/           # landing/marketing page
├── household/       # household management
lib/
├── config.ts        # API_URL from NEXT_PUBLIC_API_URL env var
├── store.ts         # Types, constants (SORTER_PAYOUT_CENTS=5), localStorage state, 4-bag system
├── store-api.ts     # API wrapper with auth (apiFetch adds Bearer token from goodsort_token)
├── containers.ts    # Barcode → container name lookup
├── routes.ts        # Route optimization helpers
├── marketplace-api.ts  # Runner marketplace API calls
```

### Backend structure

```
src/GoodSort.Api/
├── Program.cs           # ALL endpoints defined here (minimal API style, ~750 lines)
├── Services/
│   ├── VisionService.cs     # Tailor Vision API → Azure OpenAI fallback
│   ├── AuthService.cs       # OTP via Azure Communication Services, JWT issuance
│   ├── CashoutService.cs    # ABA bank file generation
│   ├── BinDayService.cs     # Council bin day lookup
│   ├── RunnerService.cs     # Runner matching and assignment
│   ├── RunGenerationService.cs  # Background service: generates collection runs
│   └── PricingService.cs    # Per-container payout rates
├── Data/
│   ├── GoodSortDbContext.cs # EF Core context (Azure SQL)
│   └── Entities/            # Profile, Household, Scan, Run, Bin, etc.
└── Migrations/              # EF Core migrations (auto-generated only)
```

### Auth flow

1. User enters email/phone → `POST /api/auth/send-otp` (sends 6-digit OTP via Azure Communication Services)
2. User enters OTP → `POST /api/auth/verify-otp` (returns JWT token)
3. Token stored in `localStorage` as `goodsort_token`, profile as `goodsort_profile`
4. All API calls attach `Authorization: Bearer <token>` via `apiFetch()` in `lib/store-api.ts`
5. Direct `fetch()` calls (e.g. in scanner) must manually include the auth header

### Vision / scanning flow

1. User takes photo → `POST /api/scan/photo` with base64 image
2. Backend calls **Tailor Vision API** (`POST api.tailor.au/api/vision/classify`) with `X-Api-Key` header
3. If Tailor Vision fails or is unconfigured → falls back to **Azure OpenAI** with a container identification prompt
4. Returns `{containers: [{name, material, count, eligible}], message}`
5. User confirms → `POST /api/scan/photo/confirm` creates Scan records and credits `pendingCents`

### Key domain concepts

- **4-bag sorting system**: Blue (aluminium), Teal (PET), Amber (glass), Green (other). Scanner tells user which bag.
- **Two balance types**: `pendingCents` (scan credited, not yet cleared) and `clearedCents` (cashout-eligible). $20 minimum to cash out.
- **Runs**: Collection routes generated for runners. Runner picks up bags from households, delivers to depot, settles.
- **CDS**: QLD Container Refund Scheme (Containers for Change). 10¢ refund per eligible container. GoodSort pays 5¢ to sorter, 5¢ to runner.

## Environment Variables

### Frontend (build-time, `NEXT_PUBLIC_` prefix)
- `NEXT_PUBLIC_API_URL` — backend API base URL
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — Google Maps (Places, Geocoding, Routes)

### Backend (runtime)
- `JWT_SECRET` — symmetric key for JWT signing
- `GOODSORTDB_CONNECTION_STRING` — Azure SQL connection
- `TAILOR_VISION_API_KEY` / `TAILOR_VISION_API_URL` — Tailor Vision API
- `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_KEY` / `AZURE_OPENAI_DEPLOYMENT` — fallback vision
- `ACS_CONNECTION_STRING` / `ACS_EMAIL_SENDER` — Azure Communication Services (OTP emails)

## Deployment

- **Frontend**: Push to `main` → GitHub Actions builds static export → Azure Static Web Apps
- **Backend**: Push to `main` with changes in `src/` → GitHub Actions builds Docker image → Azure Container Apps
- **CSP**: `staticwebapp.config.json` controls Content-Security-Policy. When adding new external script/API origins, update CSP there.
- **CORS**: Backend restricts to `thegoodsort.org` and the SWA preview domain (in `Program.cs`)

## Gotchas

- **No SSR**: `next.config.ts` has `output: "export"` — everything is static. No server components, no API routes in Next.js, no `getServerSideProps`.
- **Auth in direct fetch()**: If you add a new `fetch()` call to the backend outside of `lib/store-api.ts`, you must manually attach the Bearer token from `localStorage.getItem("goodsort_token")`. The `apiFetch()` wrapper does this automatically.
- **CSP updates**: When adding new external script or API origins, update `staticwebapp.config.json` — not just the code. Google Maps requires both `maps.googleapis.com` and `maps.gstatic.com`.
- **Auto-migrations**: The backend runs EF Core migrations on startup (with retry logic for SQL container readiness). No manual `database update` needed in prod.
- **Postdeploy secrets**: `azd deploy` strips env vars not in the Aspire manifest. The `infra/restore-secrets.sh` postdeploy hook re-applies them from the azd environment.
- **CORS origins**: Backend restricts to `thegoodsort.org` + the SWA staging domain. Add new origins in `Program.cs` if needed.
- **Single-file API**: All ~60 endpoints live in `Program.cs`. When adding endpoints, follow the existing minimal API pattern there — don't create controllers.

## Production URLs

- **Frontend**: `https://thegoodsort.org` (custom domain on Azure SWA)
- **Backend API**: `https://api.livelyfield-64227152.eastasia.azurecontainerapps.io`
- **Legal entity**: Crispr Projects Pty Ltd (ABN 85 680 798 770)
