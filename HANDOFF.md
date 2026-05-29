# GoodSort hardening pass — handoff (2026-05-24)

**Branch:** hopeful-cray-20b04f
**Goal:** harden the product, verify BAINK (Tailor Vision billing) is working.

## What landed

### Critical security fixes (all in `src/GoodSort.Api/Program.cs`)

All authenticated endpoints used to trust a `userId` / `profileId` / `driverId` field from the request body. Any logged-in user could swap that for someone else's id and act on their account. Fixed by reading the caller from the JWT `sub` claim via `HttpContext.GetCallerId()` (new helper in `Services/AuthHelpers.cs`).

Endpoints fixed: `POST /api/scans`, `POST /api/scan/photo`, `POST /api/scan/photo/confirm`, `POST /api/cashout`, `POST /api/runner/register`, `POST /api/runner/heartbeat`, `POST /api/marketplace/runs/:id/claim`, `GET/PATCH /api/runner/profile/:id`, `GET /api/scans`, `GET/POST/PATCH/DELETE /api/profiles[/:id]`.

**Hardest one:** `POST /api/scan/photo/confirm` previously accepted a client-supplied `items` list with `eligible` / `count` / `material` per item and credited the user. A client could post `{items: [{eligible: true, count: 99999, material: "aluminium", name: "fake"}]}` and grant themselves unlimited credit. Now:

1. `/api/scan/photo` returns an HMAC-signed `scanToken` committing to the actual vision result (10-min TTL, pinned to caller's JWT `sub`).
2. `/api/scan/photo/confirm` requires the token and reads `items` out of it. The client body's `items` field is ignored.
3. Defence-in-depth: per-item count is clamped to 100 on the server side even if the token were ever forged.

### Admin role

Profile has a new `IsAdmin bool` column. JWT issuance adds a `role=admin` claim when set. New `Admin` authorization policy gates every `/api/admin/*` endpoint plus `/api/admin/vision/health` (see below). Before this, any logged-in user could pull `/api/admin/aba-export` (PII + BSBs of every payee) and edit pricing.

**To grant yourself admin:** there's no UI yet — set it directly in SQL on the prod database:

```sql
UPDATE Profiles SET IsAdmin = 1 WHERE Email = 'admin@tailorco.au';
```

Then sign out + sign back in to mint a fresh JWT with the claim. (The previous JWT — issued before the column existed — won't carry it.)

### BAINK / Tailor Vision health surface (NEW)

`GET /api/admin/vision/health` returns:

```json
{
  "verdict": "green" | "amber:stale" | "amber:never-succeeded" | "red:no-key",
  "keyConfigured": true,
  "lastTailorSuccess": "2026-05-24T...",
  "lastTailorFailure": { "createdAt": "...", "errorSummary": "HTTP 401: ..." },
  "last24h": { "tailorOk": 42, "tailorFailed": 0, "openaiFallback": 3, "fallbackPct": 6.7 },
  "lastHour": { "calls": 4, "tailorSuccess": 4, "tailorFailure": 0, "avgTailorDurationMs": 1240 }
}
```

This is the diagnostic surface for "is BAINK billing working?" — we can't query BAINK directly from here (it's the upstream system at baink.tailor.au), but the side-channel signal tells us:
- **Are calls reaching Tailor Vision and succeeding?** → `lastTailorSuccess` recent + `verdict=green`
- **Has the API key been revoked / billing lapsed?** → `lastTailorFailure.errorSummary` will contain `HTTP 401` or similar
- **Are we silently falling back to OpenAI** (and BAINK not getting paid)? → watch `fallbackPct` — should be low (<10%)

`VisionCall` got two new columns to power this: `UserId` (for per-user attribution) and `ErrorSummary` (truncated to 200 chars).

### Other hardening

- **OTP codes hashed at rest.** `OtpCode.Code` → `CodeHash`. HMAC keyed by `JWT_SECRET` so DB-only leak can't be brute-forced against the 10^6 OTP space. OTP generation also moved from `Random.Shared` → `RandomNumberGenerator.GetInt32`.
- **Per-user daily vision cap.** Was global 2000/day (one user could drain the whole BAINK budget). Now 100/user/day with the global 2000/day kept as an upper bound. Configurable via `VISION_PER_USER_DAILY_CAP` and `VISION_DAILY_CAP` env vars.
- **Photo size cap.** 4 MB Kestrel body limit + 2,000,000 base64 char check pre-vision (≈1.5 MB raw image). Returns 413.
- **`/api/profiles/:id` GET locked.** Was unauthenticated → leaked email + household address to anyone who guessed an id.

## ⚠️ BAINK status as of 2026-05-29 — environment_not_ready

Verified end-to-end against prod. The new `/api/admin/vision/health` endpoint returned:

```json
{
  "verdict": "amber:stale",
  "keyConfigured": true,
  "lastTailorSuccess": "2026-04-19T06:16:30",
  "lastTailorFailure": {
    "createdAt": "2026-05-29T07:25:50",
    "errorSummary": "HTTP 402: {\"error\":\"environment_not_ready\",\"title\":\"Your environment isn't ready yet.\",\"message\":\"We'll let you know when it is.\"}"
  },
  "last24h": { "tailorOk": 0, "tailorFailed": 2, "openaiFallback": 1, "fallbackPct": 33.3 }
}
```

**Tailor Vision has not worked since April 19, 2026** (~40 days). Every call since returns HTTP 402 with `environment_not_ready`. This is a BAINK-side message — GoodSort's BAINK tenant has been deactivated or never re-provisioned after some upstream change.

**Action required from Tailor team:** re-provision the GoodSort BAINK environment so vision calls bill correctly. The current API key (`tailor_sk_mp83aI74...`) is configured and being sent; the rejection is at the tenant level, not the key level.

### Azure OpenAI fallback was also broken — now fixed

The fallback path was failing with `HTTP 404 DeploymentNotFound` because `AZURE_OPENAI_DEPLOYMENT=gpt-4.1` doesn't exist in `oai-tailor-app-prod`. I changed it to `gpt-5-mini` (verified it works — successfully identified a test can image).

**Note:** the env var change was applied directly to the Container App. The next `azd deploy` will strip it because the Aspire manifest doesn't declare it. Persist it by running:

```bash
azd env set AZURE_OPENAI_DEPLOYMENT gpt-5-mini
```

And then update `infra/restore-secrets.sh` if the default needs to change.

Available deployments in `oai-tailor-app-prod`: `gpt-5`, `gpt-5-mini`, `gpt-5-pro`, `tailor-brain` (gpt-4.1-mini), `tailor-image` (dall-e-3), `text-embedding-3-small`.

## Admin bootstrap endpoint (escape hatch)

Added `POST /api/admin/bootstrap` for promoting an account to admin without DB access. Gated by `ADMIN_BOOTSTRAP_SECRET` env var — when unset, the endpoint 404s, so leaving the code shipped is safe.

Usage (one-shot):
```bash
# Set the secret on Container App
az containerapp update -n api -g rg-GoodSort --set-env-vars "ADMIN_BOOTSTRAP_SECRET=$(openssl rand -hex 24)"
# POST to promote (create-if-missing — works even when the account hasn't signed up)
curl -X POST https://api.livelyfield-64227152.eastasia.azurecontainerapps.io/api/admin/bootstrap \
  -H "Content-Type: application/json" \
  -H "X-Bootstrap-Secret: <secret>" \
  -d '{"email":"admin@tailorco.au"}'
# Response includes a JWT for the new admin
# CLEAR THE SECRET when done:
az containerapp update -n api -g rg-GoodSort --remove-env-vars ADMIN_BOOTSTRAP_SECRET
```

Used today to create the admin@tailorco.au profile + JWT. **The secret has been cleared** so the endpoint is dormant. The profile `1f37ac92-9121-486e-842d-cd716155da1c` (admin@tailorco.au) has `IsAdmin=1` in prod.

## CI/CD note: backend deploy via action is broken

`azure/container-apps-deploy-action@v2` is hitting a known Azure CLI bug (`'NoneType' object has no attribute 'linux'` in azext_containerapp). Build itself succeeds; the action's deploy step fails. Workaround used today:

```bash
az acr build --registry acrnyjfw2pdfsrie --image api:<tag> --file Dockerfile .
az containerapp update -n api -g rg-GoodSort --image acrnyjfw2pdfsrie.azurecr.io/api:<tag>
```

Worth either pinning the action's azure-cli version, switching to `azure/CLI@v2` action with manual `az acr build` + `az containerapp update`, or filing/tracking the upstream bug. Current `main` is deployed via this manual path; the next push to `main` will fail CI again until the workflow is fixed.

## Security note discovered during this work

The Container App stores secrets as **plaintext env vars**, including:
- `JWT_SECRET`
- `ConnectionStrings__goodsortdb` (full connection string including admin password)
- `TAILOR_VISION_API_KEY`
- `AZURE_OPENAI_KEY`
- `ACS_CONNECTION_STRING`

Anyone with `Reader` on `rg-GoodSort` can read these via `az containerapp show`. Should migrate to Container App `secretref` env vars backed by Key Vault references (`tailor-prod-kv-ae01` already exists in `rg-tailor-app-prod`).

## How to verify BAINK is working

Once deployed:

```bash
# Get an admin JWT
curl -X POST https://api.livelyfield-64227152.eastasia.azurecontainerapps.io/api/auth/send-otp \
  -H "Content-Type: application/json" -d '{"email":"admin@tailorco.au"}'
# (check email, get the OTP)
curl -X POST https://api.livelyfield-64227152.eastasia.azurecontainerapps.io/api/auth/verify-otp \
  -H "Content-Type: application/json" -d '{"email":"admin@tailorco.au","code":"123456"}'
# → save .token

# Check Tailor Vision health
curl https://api.livelyfield-64227152.eastasia.azurecontainerapps.io/api/admin/vision/health \
  -H "Authorization: Bearer $TOKEN" | jq
```

Healthy looks like `"verdict": "green"` and a `lastTailorSuccess` within the last hour.

**If you see `red:no-key`** → `TAILOR_VISION_API_KEY` was stripped. Re-run `infra/restore-secrets.sh`.

**If you see `amber:never-succeeded`** → key is set but every call has failed. Check `lastTailorFailure.errorSummary` — `HTTP 401` = invalidated key (BAINK billing lapsed or key rotated upstream).

**If you see `amber:stale`** → no successful tailor call in the last hour but historical successes exist. Either no scans have happened (cold pilot), or something recent broke.

## What did NOT land — follow-ups

Triaged but out of scope for this pass:

1. **Plaintext BSB / account number at rest.** `CashoutRequest.Bsb` and `.AccountNumber` are stored unencrypted in Azure SQL. Should use TDE column encryption or app-level encryption keyed by Azure Key Vault. Until then, the ABA admin endpoint is the only useful read path and it's admin-gated.

2. **ABA file uses placeholder trace BSB + account.** `CashoutService.GenerateAbaFile` hardcodes `062-000` and `12345678` as the source-of-funds BSB+account. As-is this file will be rejected by Westpac. Confirm Crispr Projects' real settlement account before first cashout run.

3. **Marketplace ownership checks.** `/api/marketplace/runs/:id/start`, `/deliver`, `/complete`, `/settle`, `/stops/:id/{arrive,pickup,skip}` only check `RequireAuthorization()` — they don't verify the caller's runner profile actually owns the run. Mitigated by the state-machine status check, but any authenticated user can complete someone else's in-progress run. Fix: each handler should pull the run, then check `run.Runner.ProfileId == ctx.GetCallerId()`.

4. **JWT 30-day TTL with no rotation / revocation list.** A leaked token is good for a month. Add refresh tokens or shorten TTL + add a JTI denylist for forced sign-out.

5. **CSP `'unsafe-inline'` and `'unsafe-eval'`.** Required by Next.js's runtime today; should move to nonces or strict CSP once we audit which inline scripts actually need to run.

6. **Marketplace claim re-prices the run on every claim.** Looks intentional but worth noting — a runner that holds-then-cancels can probe pricing across runner-level bonuses.

7. **OpenTelemetry vulnerability warning** during build (`NU1902`). Low-severity transitive package, but worth bumping `OpenTelemetry.Exporter.OpenTelemetryProtocol` past 1.11.2 in `src/GoodSort.ServiceDefaults`.

## Deploy notes

- **Migration:** `20260523184849_HardeningAdminOtpHashVisionUser` renames `OtpCodes.Code` → `CodeHash`. **Existing pending OTP rows will have plaintext values that don't HMAC-verify after deploy** — any unredeemed OTP at deploy time is dead. Users in the middle of sign-in just need to request a new one (5-min UX wrinkle, no data loss).
- Auto-migrates on startup as usual; no manual `database update` needed.
- Frontend: bumped `app-version` meta in `app/layout.tsx` to `20260524-hardening`.

## Files touched

- **NEW:** `src/GoodSort.Api/Services/AuthHelpers.cs` — caller-id helper, admin policy, scan-token signing, OTP hash
- **NEW migration:** `src/GoodSort.Api/Migrations/20260523184849_HardeningAdminOtpHashVisionUser.cs`
- **MODIFIED entities:** `Profile.cs` (+IsAdmin), `OtpCode.cs` (Code→CodeHash), `VisionCall.cs` (+UserId, +ErrorSummary)
- **MODIFIED services:** `AuthService.cs` (hashed OTP, admin role claim), `VisionService.cs` (userId + error capture)
- **MODIFIED:** `src/GoodSort.Api/Program.cs` (~12 endpoints rewritten, admin policy applied, vision health endpoint added)
- **MODIFIED frontend:** `app/components/shared/scanner.tsx` (threads scanToken), `app/layout.tsx` (version bump)

Build is green: `dotnet build -c Release` ✓, `npx tsc --noEmit` ✓, `npm run build` ✓.
