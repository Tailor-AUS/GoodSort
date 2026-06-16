# The Good Sort

Container recycling marketplace for QLD apartments and households. Residents scan
their drink containers at home, GoodSort collects from the kerb, and everyone earns
their share of the **Containers for Change** (CDS) 10¢ refund.

- **Production:** https://thegoodsort.org
- **API:** `https://api.livelyfield-64227152.eastasia.azurecontainerapps.io`

## How it works

1. **Scan** — a resident photographs a container. The backend classifies it
   (material + CDS eligibility) via the Tailor Vision API, with an Azure OpenAI
   fallback.
2. **Sort** — the app tells them which of the four bags it goes in: Blue
   (aluminium), Teal (PET), Amber (glass), Green (other).
3. **Collect** — a runner picks up full bags from clustered households, delivers
   to a depot, and settles the run.
4. **Earn** — each eligible container is worth 10¢: 5¢ to the sorter, 5¢ to the
   runner. Balances move from `pending` → `cleared`, and users cash out (min $20)
   to their bank via a generated ABA file.

## Architecture

Two tiers — a fully static SPA and a REST API.

| Tier | Stack | Hosted on |
|------|-------|-----------|
| **Frontend** | Next.js 16 (`output: "export"`, no SSR), React 19, Tailwind 4, MapLibre | Azure Static Web Apps |
| **Backend** | .NET 9 minimal API (single-file `Program.cs`), EF Core | Azure Container Apps (Docker) |
| **Database** | Azure SQL Server (EF Core, auto-migrate on startup) | Azure SQL |

The mapping stack is fully open-source / keyless: MapLibre GL + OpenFreeMap tiles,
Photon (komoot) geocoding, and OSRM for route optimization.

```
app/            Next.js routes — (auth), (sorter), (runner), admin, scan, start, legal
lib/            Client state, API wrappers (offline-first), domain helpers
src/GoodSort.Api/        .NET minimal API — Program.cs + Services/ + Data/
src/GoodSort.AppHost/    .NET Aspire host (local dev only)
src/GoodSort.ServiceDefaults/   Shared OpenTelemetry / health / resilience
infra/          Deploy + secret-restore scripts, settlement config notes
```

See [`CLAUDE.md`](./CLAUDE.md) for the full architecture deep-dive and gotchas.

## Local development

### Frontend

```bash
npm ci
npm run dev            # dev server at http://localhost:3000
npm run build          # static export (no map API keys required)
npx tsc --noEmit       # typecheck (there is no test suite)
```

### Backend

```bash
dotnet build src/GoodSort.sln -c Release
dotnet run --project src/GoodSort.Api/GoodSort.Api.csproj
```

### Full stack with Aspire (recommended — requires Docker)

```bash
dotnet run --project src/GoodSort.AppHost
```

Spins up SQL Server in Docker, runs the API, and starts the Next.js dev server with
`NEXT_PUBLIC_API_URL` auto-injected.

### Database migrations

```bash
dotnet ef migrations add <Name> --project src/GoodSort.Api
```

Migrations are applied automatically on API startup — never hand-author migration files.

## Configuration

**Frontend (build-time):** `NEXT_PUBLIC_API_URL`

**Backend (runtime):** `JWT_SECRET`, `GOODSORTDB_CONNECTION_STRING`,
`TAILOR_VISION_API_KEY`/`_URL`, `AZURE_OPENAI_*`, `ACS_CONNECTION_STRING`/`_SENDER`,
and the ABA settlement vars (`ABA_USER_ID`, `ABA_TRACE_BSB`, `ABA_TRACE_ACCOUNT` —
see [`infra/aba-settlement.md`](./infra/aba-settlement.md)).

## Deployment

Both tiers deploy from `main` via GitHub Actions:

- **Frontend** — static export → Azure Static Web Apps, on every push to `main`.
- **Backend** — Docker image → Azure Container Apps, when `src/**` changes.

CI (`.github/workflows/ci.yml`) runs `npm run build` and `dotnet build -c Release`.

## Legal entity

Crispr Projects Pty Ltd (ABN 85 680 798 770).
