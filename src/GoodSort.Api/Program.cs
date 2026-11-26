using System.Text;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Endpoints;
using GoodSort.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();
var sqlCs = builder.Configuration.GetConnectionString("goodsortdb");
var useMemory = builder.Environment.IsDevelopment() && string.IsNullOrWhiteSpace(sqlCs);
if (useMemory)
    builder.Services.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase("goodsort-dev"));
else
    builder.AddSqlServerDbContext<GoodSortDbContext>("goodsortdb");

// Gated deploy-step EF migration mode (AGENTS.md §2 D4): executes BEFORE JWT_SECRET,
// Kestrel, or background IHostedServices are registered so the Container Apps migration
// job only requires ConnectionStrings__goodsortdb and exits 0 cleanly on completion.
var migrateOnly = args.Any(a => string.Equals(a, "--migrate-only", StringComparison.OrdinalIgnoreCase))
    || string.Equals(builder.Configuration["GOODSORT_MIGRATE_ONLY"], "true", StringComparison.OrdinalIgnoreCase);
if (migrateOnly)
{
    await using var migrateApp = builder.Build();
    for (var attempt = 1; ; attempt++)
    {
        try
        {
            using var migrateScope = migrateApp.Services.CreateScope();
            var migrateDb = migrateScope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            if (migrateDb.Database.ProviderName?.Contains("InMemory", StringComparison.OrdinalIgnoreCase) == true)
            {
                await migrateDb.Database.EnsureCreatedAsync();
            }
            else
            {
                await migrateDb.Database.MigrateAsync();
            }
            migrateApp.Logger.LogInformation("Gated EF database migration completed successfully.");
            return;
        }
        catch (Exception ex) when (attempt < 10)
        {
            migrateApp.Logger.LogWarning(ex, "Gated EF migration attempt {Attempt}/10 failed; retrying in 3s...", attempt);
            await Task.Delay(TimeSpan.FromSeconds(3));
        }
    }
}
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<VisionService>();
builder.Services.AddScoped<CashoutService>();
builder.Services.AddScoped<PricingService>();
builder.Services.AddScoped<RunnerService>();
builder.Services.AddScoped<BinDayService>();
builder.Services.AddScoped<NotificationService>();
builder.Services.AddSingleton<RunGenerationService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<RunGenerationService>());
builder.Services.AddScoped<PickupReminderService>();
builder.Services.AddHostedService<PickupReminderHost>();
builder.Services.AddHostedService<GrowthEventRetentionHost>();
builder.Services.AddSingleton<ScanTokenService>();
builder.Services.AddHttpClient();

// Tailor Vision (TV) — api.tailor.au/api/vision/classify
// GoodSort dogfoods Tailor Vision, billed via AINK
// Open Food Facts asks callers to identify themselves. A browser cannot:
// User-Agent is a forbidden header name in fetch, so the one lib/containers.ts
// set was silently dropped. Server-side it actually gets sent.
//
// The timeout matters more than it looks. OFF is volunteer-run and its
// availability is genuinely variable — its search API was returning 503 while
// this was written. The default HttpClient timeout is 100 seconds, and this
// call sits in the scan path behind a "Looking up..." spinner.
// Bounded, so a cache keyed on caller-supplied barcodes cannot grow until the
// container is killed. See BarcodeCache for why misses are cached as well.
builder.Services.AddMemoryCache(o => o.SizeLimit = BarcodeCache.MaxEntries);

builder.Services.AddHttpClient("OpenFoodFacts", client =>
{
    client.BaseAddress = new Uri("https://world.openfoodfacts.org/");
    client.DefaultRequestHeaders.UserAgent.ParseAdd("TheGoodSort/1.0 (noreply@thegoodsort.org)");
    client.Timeout = TimeSpan.FromSeconds(5);
});

builder.Services.AddHttpClient("TailorVision", client =>
{
    var url = builder.Configuration["TAILOR_VISION_API_URL"] ?? "https://api.tailor.au";
    var key = builder.Configuration["TAILOR_VISION_API_KEY"] ?? "";
    client.BaseAddress = new Uri(url);
    if (!string.IsNullOrEmpty(key))
        client.DefaultRequestHeaders.Add("X-Api-Key", key);
    client.Timeout = TimeSpan.FromSeconds(8); // Fast fail — fallback to PACT/Azure OpenAI if Tailor Vision is slow
});

builder.Services.AddHttpClient(VisionService.PactHttpClientName, client =>
{
    // Per-call timeout is enforced in VisionService via VISION_TIMEOUT_SECONDS
    // and a linked CancellationTokenSource; keep a 65s ceiling on the client.
    client.Timeout = TimeSpan.FromSeconds(65);
});

// JSON serialization — handle circular references (Run ↔ RunnerProfile)
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles;
});

// Rate limiting. /api/growth/events is anonymous by design (it must work
// before a member has an account), and it now WRITES A ROW, so leaving it
// unthrottled would make it a free database-write amplifier. Counts from an
// unthrottled anonymous endpoint are also not defensible the moment one goes
// in a deck.
// Every limiter below keeps its counters IN PROCESS, and this app scales to
// ten replicas (maxReplicas on the `api` Container App). So a per-IP permit of
// N is a real ceiling of up to N x 10 for a caller whose requests spread across
// instances — the stated numbers are per replica, not per caller.
//
// Written down because a rate limit reads like a guarantee. These are sized to
// blunt a scripted loop and to keep us inside what a free upstream will
// tolerate, not to stop a determined attacker; a limit that actually holds
// across replicas needs shared state, the same way background passes needed
// SingletonLease.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    // The barcode lookup makes an outbound request per call and is anonymous,
    // so without a ceiling anyone can use this API to generate unlimited
    // traffic to Open Food Facts under our name — which gets us blocked by a
    // volunteer-run service, not them.
    options.AddPolicy("barcode-lookup", ctx =>
        System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions
            {
                // A member scans one container at a time, so 60/min is far
                // more than a person produces. Per replica — see the note on
                // AddRateLimiter above before treating it as a hard ceiling.
                PermitLimit = 60,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));

    options.AddPolicy("growth-events", ctx =>
        System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions
            {
                // Generous for a real member — a scan session emits a handful.
                // Not a hard ceiling: per replica, so up to ten times this for
                // a caller spread across instances. See AddRateLimiter above.
                PermitLimit = 120,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));

    // /api/scans takes the barcode, name and material straight from the client
    // and has no way to prove a container was physically scanned — the photo
    // path has a signed token, this one has nothing. Pending credit is not the
    // exposure: it only becomes cashable through a runner's physical count at
    // settlement. Suburb volume is. Fabricated scans unlock a run, and a run is
    // a real van driven to a real kerb.
    //
    // Partitioned by member, not by IP: the endpoint is authenticated, and an
    // IP partition would let one account spread a script across connections
    // while punishing a household behind a shared address.
    options.AddPolicy("scans", ctx =>
        System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: ctx.GetCallerId()?.ToString() ?? "anonymous",
            factory: _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions
            {
                // A person emptying a bag manages roughly one container a
                // second at best. Sixty a minute is out of reach for a human
                // and a hard ceiling on a loop. Tunable so ops can loosen it
                // without a deploy if a real member ever hits it.
                PermitLimit = int.TryParse(builder.Configuration["SCAN_RATE_PER_MINUTE"], out var spm) && spm > 0 ? spm : 60,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));

    // Per-IP ceiling on /api/auth/send-otp so a scripted loop rotating random
    // email addresses cannot exhaust ACS sending quota or flood OtpCodes.
    // AuthService still enforces 5/hour per email address independently.
    options.AddPolicy("auth-otp", ctx =>
    {
        var configured = builder.Configuration["OTP_IP_RATE_PER_MINUTE"];
        if (configured == "0")
            return System.Threading.RateLimiting.RateLimitPartition.GetNoLimiter("disabled");
        // WebApplicationFactory's in-memory TestServer sets RemoteIpAddress = null
        // across every test in a shared fixture; real Kestrel TCP / Envoy always
        // populates RemoteIpAddress. Still honour explicit OTP_IP_RATE_PER_MINUTE
        // in tests that verify the 429 path.
        if (ctx.Connection.RemoteIpAddress is null && string.IsNullOrEmpty(configured))
            return System.Threading.RateLimiting.RateLimitPartition.GetNoLimiter("testserver");
        var limit = int.TryParse(configured, out var opm) && opm > 0 ? opm : 30;
        return System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions
            {
                PermitLimit = limit,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            });
    });

    options.AddPolicy("bin-day-lookup", ctx =>
    {
        var configured = builder.Configuration["BIN_DAY_IP_RATE_PER_MINUTE"];
        if (configured == "0")
            return System.Threading.RateLimiting.RateLimitPartition.GetNoLimiter("disabled");
        if (ctx.Connection.RemoteIpAddress is null && string.IsNullOrEmpty(configured))
            return System.Threading.RateLimiting.RateLimitPartition.GetNoLimiter("testserver");
        var limit = int.TryParse(configured, out var bpm) && bpm > 0 ? bpm : 30;
        return System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions
            {
                PermitLimit = limit,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            });
    });
});

// Forwarded headers for Azure Container Apps Envoy ingress. Without this,
// ctx.Connection.RemoteIpAddress on every production request is the internal
// Envoy proxy address, collapsing per-IP rate limiters ("barcode-lookup",
// "growth-events", "auth-otp") into a single shared bucket per replica.
// ForwardLimit = 1 reads only the rightmost hop appended by Envoy so a
// client-supplied X-Forwarded-For prefix cannot spoof RemoteIpAddress.
builder.Services.Configure<Microsoft.AspNetCore.Builder.ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor
                             | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1;
    options.KnownNetworks.Add(new Microsoft.AspNetCore.HttpOverrides.IPNetwork(System.Net.IPAddress.Parse("10.0.0.0"), 8));
    options.KnownNetworks.Add(new Microsoft.AspNetCore.HttpOverrides.IPNetwork(System.Net.IPAddress.Parse("172.16.0.0"), 12));
    options.KnownNetworks.Add(new Microsoft.AspNetCore.HttpOverrides.IPNetwork(System.Net.IPAddress.Parse("192.168.0.0"), 16));
    options.KnownNetworks.Add(new Microsoft.AspNetCore.HttpOverrides.IPNetwork(System.Net.IPAddress.Parse("100.64.0.0"), 10));
});

// CORS — restrict to actual domains
// The origins the browser may call this API from. Kept as a named array so the
// Development rule below can re-admit them: SetIsOriginAllowed REPLACES the
// origin check rather than adding to it, so a predicate that only matched
// loopback would silently stop honouring this list.
string[] allowedOrigins =
[
    "https://www.thegoodsort.org",
    "https://thegoodsort.org",
    "https://kind-mushroom-0fe89a200.2.azurestaticapps.net",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
];

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(allowedOrigins)
        .AllowAnyHeader()
        .AllowAnyMethod();

        // In Development only, additionally accept any loopback port. The list
        // above pins 3000 and 3001, but `next dev` silently moves to an
        // arbitrary high port when 3000 is taken, and every request then fails
        // CORS. That reads as "the API is down" rather than "wrong port", and
        // it blocks the live browser pass this project requires before
        // shipping UI.
        //
        // SetIsOriginAllowed REPLACES the origin check rather than adding to
        // it, so the predicate has to re-admit allowedOrigins itself. A
        // loopback-only predicate here would quietly stop honouring the list
        // above — which is easy to write and produces no error.
        //
        // Loopback only, Development only. Production keeps the exact list.
        if (builder.Environment.IsDevelopment())
        {
            policy.SetIsOriginAllowed(origin =>
                allowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase)
                || (Uri.TryCreate(origin, UriKind.Absolute, out var u) && u.IsLoopback));
        }
    });
});

// JWT Authentication
if (builder.Environment.IsDevelopment() && string.IsNullOrWhiteSpace(builder.Configuration["JWT_SECRET"]))
{
    builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["JWT_SECRET"] = "goodsort-dev-secret-key-min-32-chars!!",
    });
}
var jwtSecret = builder.Configuration["JWT_SECRET"] ?? throw new InvalidOperationException("JWT_SECRET must be set");
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = "goodsort-api",
            ValidAudience = "goodsort-app",
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
        };
    });
builder.Services.AddAuthorization(options =>
{
    // Admin endpoints check for the "admin" role claim. JWTs only get this
    // claim when Profile.IsAdmin is true (see AuthService.GenerateJwt).
    options.AddPolicy(AuthHelpers.AdminPolicy, policy =>
        policy.RequireAssertion(ctx =>
            ctx.User.HasClaim("role", "admin") || ctx.User.IsInRole("admin")));
});

// Cap request bodies. /api/scan/photo carries base64 photos — a clear
// upper bound prevents both memory pressure and runaway AINK spend if a
// caller tries to fuzz the vision endpoint with huge payloads.
builder.Services.Configure<Microsoft.AspNetCore.Http.Json.JsonOptions>(o =>
    o.SerializerOptions.MaxDepth = 32);
builder.WebHost.ConfigureKestrel(k =>
{
    // 4 MB ceiling — base64 inflates by ~33%, so this caps raw image at ~3 MB.
    k.Limits.MaxRequestBodySize = 4 * 1024 * 1024;
});

var app = builder.Build();

// Upper bound on self-reported containers per pickup stop. Runner pickup counts
// are self-reported and flow straight into cash-out-eligible ClearedCents at
// settle time, so an unbounded value is a direct self-credit fraud vector
// (mirrors the 100/item clamp on the photo-scan path). A single household bin
// holds ~150 containers, so this is generously above any legitimate stop.
// Tune via RUNNER_STOP_MAX_CONTAINERS; the default is intentionally lenient.
var maxContainersPerStop = int.TryParse(builder.Configuration["RUNNER_STOP_MAX_CONTAINERS"], out var mc) ? mc : 2000;

app.UseForwardedHeaders();
app.UseCors();
app.UseAuthentication();
// After authentication, deliberately. The "scans" policy partitions by member
// id, and GetCallerId reads claims — which are not populated until
// UseAuthentication has run. With the rate limiter first, every caller
// partitions to "anonymous", so the per-member limit silently becomes one
// global bucket and a single scripted account throttles every real member.
// Caught by ScanFaucetLimitTests.One_members_burst_does_not_throttle_another.
app.UseRateLimiter();
app.UseAuthorization();
app.MapDefaultEndpoints();

// Auto-migrate on startup with retry (SQL may not be ready yet)
for (var i = 0; i < 10; i++)
{
    try
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
        if (db.Database.ProviderName?.Contains("InMemory", StringComparison.OrdinalIgnoreCase) == true)
        {
            await db.Database.EnsureCreatedAsync();
            app.Logger.LogInformation("In-memory waitlist database ready (no SQL Server)");
        }
        else if (app.Environment.IsDevelopment()
                 || string.Equals(builder.Configuration["RUN_MIGRATIONS_ON_BOOT"], "true", StringComparison.OrdinalIgnoreCase))
        {
            await db.Database.MigrateAsync();
            app.Logger.LogInformation("Database migration completed successfully");
        }
        else
        {
            app.Logger.LogInformation("Skipping boot-time EF migration in non-Development environment (RUN_MIGRATIONS_ON_BOOT unset)");
        }

        var seedAdminEmail = AuthService.NormalizeValidEmail(builder.Configuration["ADMIN_SEED_EMAIL"]);
        if (!string.IsNullOrWhiteSpace(seedAdminEmail))
        {
            var alternateSeedAlias = AuthService.GetTgsAlternateAlias(seedAdminEmail);
            var seedProfile = await db.Profiles.FirstOrDefaultAsync(
                p => p.Email == seedAdminEmail || p.Phone == seedAdminEmail);
            if (seedProfile is null && alternateSeedAlias is not null)
            {
                seedProfile = await db.Profiles.FirstOrDefaultAsync(
                    p => p.Email == alternateSeedAlias || p.Phone == alternateSeedAlias);
            }

            var desiredName = string.Equals(seedAdminEmail, "hello@thegoodsort.org", StringComparison.OrdinalIgnoreCase)
                ? "The Good Sort"
                : seedAdminEmail.Split('@')[0];

            if (seedProfile is null)
            {
                db.Profiles.Add(new Profile
                {
                    Name = desiredName,
                    Email = seedAdminEmail,
                    Phone = seedAdminEmail,
                    IsAdmin = true,
                });
                await db.SaveChangesAsync();
                app.Logger.LogInformation("Seeded standalone admin profile for {Email}", seedAdminEmail);
            }
            else
            {
                var updated = false;
                if (!string.Equals(seedProfile.Email, seedAdminEmail, StringComparison.OrdinalIgnoreCase))
                {
                    seedProfile.Email = seedAdminEmail;
                    seedProfile.Phone = seedAdminEmail;
                    if (string.Equals(seedProfile.Name, "admin", StringComparison.OrdinalIgnoreCase))
                    {
                        seedProfile.Name = desiredName;
                    }
                    updated = true;
                }
                if (!seedProfile.IsAdmin)
                {
                    seedProfile.IsAdmin = true;
                    updated = true;
                }
                if (updated)
                {
                    await db.SaveChangesAsync();
                    app.Logger.LogInformation("Promoted/updated standalone admin profile for {Email}", seedAdminEmail);
                }
            }
        }

        // One-shot cleanup of demo seed bins (GS-0001..GS-0005) if they have no
        // referencing scans. Real bins created via /api/bins are untouched.
        var demoCodes = new[] { "GS-0001", "GS-0002", "GS-0003", "GS-0004", "GS-0005" };
        var demoBins = await db.Bins.Where(b => demoCodes.Contains(b.Code)).ToListAsync();
        foreach (var bin in demoBins)
        {
            var hasScans = await db.Scans.AnyAsync(s => s.BinId == bin.Id);
            if (!hasScans) db.Bins.Remove(bin);
        }
        if (db.ChangeTracker.HasChanges())
        {
            await db.SaveChangesAsync();
            app.Logger.LogInformation("Removed {Count} demo seed bins", demoBins.Count);
        }

        break;
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning("Migration attempt {Attempt} failed: {Message}", i + 1, ex.Message);
        if (i == 9) throw;
        await Task.Delay(3000);
    }
}

// ── Health ──
app.MapGet("/api/health", () => Results.Ok(new { status = "healthy", service = "goodsort-api" }));

// Which commit is actually serving.
//
// The deploy workflow tags the image with the sha and points the container app
// at that tag, so the sha exists — but only in the registry, where verifying it
// means having Azure access. From outside, a deploy could only be confirmed by
// trusting that a green workflow run reached production, and that inference has
// already been wrong here: a run can go green having taken a path that never
// shipped the component you changed. Asking the running app is the check that
// cannot be satisfied by a workflow that did not deploy.
//
// Anonymous on purpose — a deploy check that needs a token is not usable by the
// thing most likely to need it (an uptime probe, or someone verifying a rollout
// at 2am). Nothing here is a secret: a commit sha is public in the repo, and
// the build time is not sensitive. Deliberately NOT the environment name, the
// config, or anything read from a secret.
app.MapGet("/api/version", () => Results.Ok(new
{
    sha = Environment.GetEnvironmentVariable("GIT_SHA") ?? "unknown",
    buildTime = Environment.GetEnvironmentVariable("BUILD_TIME") ?? "unknown",
    service = "goodsort-api",
}));

// ── Admin bootstrap ──
// One-shot escape hatch for setting Profile.IsAdmin without DB access. Gated by
// a shared secret in the ADMIN_BOOTSTRAP_SECRET env var — when the env var is
// unset or empty the endpoint returns 404, so leaving the code shipped is safe.
// Use case: initial admin onboarding, or rescue if all admins are locked out.
// Rotate the env var (clear it) immediately after use.
app.MapPost("/api/admin/bootstrap", async (HttpContext ctx, AdminBootstrapRequest req,
    GoodSortDbContext db, IConfiguration cfg, AuthService auth, ILogger<Program> log) =>
{
    var expected = cfg["ADMIN_BOOTSTRAP_SECRET"];
    if (string.IsNullOrEmpty(expected)) return Results.NotFound();
    var provided = ctx.Request.Headers["X-Bootstrap-Secret"].ToString();
    if (!System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(provided),
            System.Text.Encoding.UTF8.GetBytes(expected)))
    {
        log.LogWarning("Bootstrap attempt with wrong secret for {Email}", req.Email);
        return Results.Unauthorized();
    }

    var email = req.Email.Trim().ToLowerInvariant();
    var profile = await db.Profiles.FirstOrDefaultAsync(p => p.Email == email);
    var created = false;
    if (profile is null)
    {
        // Create-if-missing — allows bootstrapping an admin without first
        // going through the OTP flow. Acceptable because the secret-gate IS
        // the trust boundary here.
        var prefix = email.Split('@')[0].Replace('.', ' ').Replace('_', ' ').Replace('-', ' ');
        var displayName = System.Globalization.CultureInfo.CurrentCulture.TextInfo.ToTitleCase(prefix);
        profile = new Profile
        {
            Name = displayName,
            Email = email,
            Phone = email,
            Role = "sorter",
        };
        db.Profiles.Add(profile);
        created = true;
    }

    profile.IsAdmin = true;
    await db.SaveChangesAsync();
    log.LogWarning("Bootstrap: {Action} {Email} ({Id}) as admin", created ? "created" : "promoted", email, profile.Id);
    // Also mint a JWT so the caller can immediately exercise admin endpoints
    // without a separate OTP round-trip.
    var token = auth.GenerateJwt(profile);
    return Results.Ok(new { promoted = true, created, profileId = profile.Id, email, token });
});

// ── Auth (Azure Communication Services Email OTP) ──
app.MapPost("/api/auth/send-otp", async (SendOtpRequest req, AuthService auth, ScanTokenService tokens) =>
{
    var email = AuthService.NormalizeValidEmail(req?.Email);
    if (email is null) return Results.BadRequest(new { error = "Invalid email" });
    var (success, error, devCode) = await auth.SendOtp(email);
    if (!success) return Results.BadRequest(new { error = error ?? "Failed to send code" });
    var preScanToken = tokens.IssuePreScanTicket(email, TimeSpan.FromMinutes(AuthService.OtpValidMinutes));
    return Results.Ok(new { sent = true, preScanToken, devCode = app.Environment.IsDevelopment() ? devCode : null });
}).RequireRateLimiting("auth-otp");

app.MapPost("/api/auth/verify-otp", async (VerifyOtpRequest req, AuthService auth) =>
{
    var email = AuthService.NormalizeValidEmail(req?.Email);
    if (email is null) return Results.BadRequest(new { error = "Invalid email" });
    var code = req?.Code?.Trim();
    if (string.IsNullOrEmpty(code) || code.Length > 16)
        return Results.Json(new { error = "Enter the 6-digit code from your email." }, statusCode: StatusCodes.Status401Unauthorized);
    var (token, profile, error) = await auth.VerifyOtp(email, code, req?.ReferrerId);
    if (token == null) return Results.Json(new { error = error ?? "Invalid or expired code." }, statusCode: StatusCodes.Status401Unauthorized);
    return Results.Ok(new { token, profile });
});

// ── Bins (QR-coded drop points) ──
// Public and hosted bins, plus the caller's own. It used to return every bin
// in the database to any signed-in member, and a Bin carries the household's
// Name, full Address and exact Lat/Lng — so the whole member roster was one
// authenticated GET away, no enumeration needed. Signing in costs nothing
// here, so a token was not a barrier.
//
// This is what #64, #66 and #67 were narrowing door by door while this stood
// open. The map needs drop-off points and the member's own bin; it has never
// needed to show where other members live.
app.MapGet("/api/bins", async (HttpContext ctx, GoodSortDbContext db) =>
{
    var callerId = ctx.GetCallerId();
    var myHouseholdId = callerId is Guid cid
        ? await db.Profiles.Where(p => p.Id == cid).Select(p => p.HouseholdId).FirstOrDefaultAsync()
        : null;

    var q = db.Bins.Where(b => b.Status != "disabled" && b.Status != "deleted");
    if (!ctx.IsAdmin())
        q = q.Where(b => b.HouseholdId == null || b.HouseholdId == myHouseholdId);

    return Results.Ok(await q.OrderByDescending(b => b.PendingContainers).ToListAsync());
}).RequireAuthorization();

// Requires a token AND that the bin be yours. Signing in costs nothing here —
// an OTP to any address — so "authenticated" is not a meaningful barrier on
// its own, and this returns the whole Bin: household Name, full Address, exact
// Lat/Lng, HouseholdId.
//
// That made it the third door to the same data. #64 projected the anonymous
// code lookup and #66 stripped the printed label, but the code lookup still
// hands out the bin id, so: walk GS-H{hash % 100000}, take an id, create an
// account, and read the household off this endpoint. Closing two doors while
// the third stood open closed nothing.
//
// A public or hosted bin carries no household, and members legitimately look
// those up, so they stay readable to any signed-in caller.
app.MapGet("/api/bins/{id:guid}", async (HttpContext ctx, Guid id, GoodSortDbContext db) =>
{
    var b = await db.Bins.FindAsync(id);
    if (b is null || b.Status == "deleted") return Results.NotFound();
    if (b.HouseholdId is Guid hid && !await CallerCanAccessHousehold(ctx, hid, db))
        return Results.Forbid();
    return Results.Ok(b);
}).RequireAuthorization();

// Anonymous by necessity: the scanner resolves a bin from the code printed on
// it before the member has signed in. It returned the whole Bin entity, which
// carries the household's Name, full Address, exact Lat/Lng and HouseholdId.
//
// Household bin codes are derived as GS-H{hash % 100000}, so the space is a
// hundred thousand values and can simply be walked. Anyone could enumerate it
// and harvest every member's name, address and coordinates without an account.
// Unlike the /api/routes leak, this one is reachable: a bin is created for
// every residential household that joins.
//
// The scanner needs a label and an identity, nothing else. The geofence reads
// the bin's position from the signed scan token server-side, not from here, so
// no caller needs coordinates. A household bin's name is the household's own
// name, so it is withheld too — a member scanning their own bin does not need
// to be told their own house name, and nobody else should be.
app.MapGet("/api/bins/code/{code}", async (string code, GoodSortDbContext db) =>
{
    var b = await db.Bins.AsNoTracking().FirstOrDefaultAsync(x => x.Code == code);
    if (b is null || b.Status == "deleted") return Results.NotFound();

    return Results.Ok(new
    {
        b.Id,
        b.Code,
        b.Status,
        // Only for public and hosted bins, where the name is a venue
        // ("The Burrow Cafe"), never a household's.
        Name = b.HouseholdId is null ? b.Name : null,
        b.HostedBy,
    });
});

app.MapPost("/api/bins", async (AdminCreateBinRequest req, GoodSortDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(req.Name) || string.IsNullOrWhiteSpace(req.Address))
        return Results.BadRequest(new { error = "Bin name and address are required." });
    if (!double.IsFinite(req.Lat) || !double.IsFinite(req.Lng) || (req.Lat == 0 && req.Lng == 0))
        return Results.BadRequest(new { error = "Valid coordinates are required." });

    var code = string.IsNullOrWhiteSpace(req.Code)
        ? $"GS-{await db.Bins.CountAsync() + 1:D4}"
        : req.Code.Trim().ToUpperInvariant();

    // Admin-only AND server-owned ledger fields. Previously this bound the raw
    // Bin entity under .RequireAuthorization(), allowing any signed-in caller
    // to create a public bin with arbitrary PendingContainers and claim/settle
    // the resulting marketplace run into cash-out-eligible ClearedCents.
    var bin = new Bin
    {
        Code = code,
        Name = req.Name.Trim(),
        Address = req.Address.Trim(),
        Lat = req.Lat,
        Lng = req.Lng,
        HostedBy = string.IsNullOrWhiteSpace(req.HostedBy) ? null : req.HostedBy.Trim(),
        HouseholdId = null,
        PendingContainers = 0,
        PendingValueCents = 0,
        Status = "active",
    };
    db.Bins.Add(bin);
    await db.SaveChangesAsync();
    return Results.Created($"/api/bins/{bin.Id}", bin);
}).RequireAuthorization(AuthHelpers.AdminPolicy);

app.MapGet("/api/bins/{id:guid}/qr", (Guid id, GoodSortDbContext db) =>
{
    var bin = db.Bins.Find(id);
    if (bin is null || bin.Status == "deleted") return Results.NotFound();

    // The label is printed and stuck on a physical bin, so it needs the code
    // and nothing else identifying. bin.Name for a household bin IS the
    // household's name, and this endpoint is anonymous — so rendering it here
    // reopens the leak closed in #64 through a second door: walk the
    // GS-H{hash % 100000} code space, take the id from the code lookup, ask
    // for the QR, and read the household's name off the SVG.
    //
    // A hosted bin's name is a venue ("The Burrow Cafe") and belongs on the
    // label; a household's does not, and its own occupants do not need to be
    // told their own house name by a sticker.
    var label = bin.HouseholdId is null ? bin.Name : "";
    var codeXml = System.Net.WebUtility.HtmlEncode(bin.Code ?? "");
    var labelXml = System.Net.WebUtility.HtmlEncode(label ?? "");
    var url = $"https://thegoodsort.org/scan?bin={Uri.EscapeDataString(bin.Code ?? "")}";
    var urlXml = System.Net.WebUtility.HtmlEncode(url);
    var svg = $@"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 380'>
        <rect width='300' height='380' fill='white' rx='16'/>
        <rect x='20' y='20' width='260' height='260' fill='#f1f5f9' rx='12'/>
        <text x='150' y='160' text-anchor='middle' font-family='system-ui' font-size='48' font-weight='800' fill='#16a34a'>{codeXml}</text>
        <text x='150' y='200' text-anchor='middle' font-family='system-ui' font-size='14' fill='#64748b'>Optional count</text>
        <text x='150' y='310' text-anchor='middle' font-family='system-ui' font-size='13' font-weight='700' fill='#0f172a'>{labelXml}</text>
        <text x='150' y='335' text-anchor='middle' font-family='system-ui' font-size='11' fill='#94a3b8'>{urlXml}</text>
        <text x='150' y='365' text-anchor='middle' font-family='system-ui' font-size='10' fill='#16a34a'>thegoodsort.org</text>
    </svg>";

    return Results.Text(svg, "image/svg+xml");
});

// ── Photo Scan (Tailor Vision → Azure OpenAI fallback) ──
// /api/scan/photo identifies containers in a photo and returns a signed
// `scanToken` committing to the result. /api/scan/photo/confirm requires
// that token — the client cannot fabricate eligible items between the
// two calls, because the items list is read out of the verified token.
app.MapPost("/api/scan/photo", async (HttpContext ctx, PhotoScanRequest req, VisionService vision,
    GoodSortDbContext db, IConfiguration cfg, ScanTokenService tokens) =>
{
    var userId = ctx.GetCallerId();
    if (userId is null) return Results.Unauthorized();

    if (string.IsNullOrEmpty(req.Image))
        return Results.BadRequest(new { error = "No image provided" });

    // Strip data URL prefix if present (also normalises before size check)
    var base64 = req.Image;
    if (base64.Contains(",")) base64 = base64.Split(',')[1];

    // Hard size cap before we round-trip to Tailor Vision and burn AINK credit.
    // base64 inflates by ~33%, so 2_000_000 base64 chars ≈ 1.5 MB raw image.
    if (base64.Length > 2_000_000)
        return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);

    // Cost guardrails — per-user AND global. Per-user is the critical one:
    // without it, one client can drain the whole day's AINK budget.
    var since = DateTime.UtcNow.AddHours(-24);
    var perUserCap = int.TryParse(cfg["VISION_PER_USER_DAILY_CAP"], out var pu) ? pu : 100;
    var globalCap = int.TryParse(cfg["VISION_DAILY_CAP"], out var g) ? g : 2000;
    var userCallsToday = await db.VisionCalls.CountAsync(v => v.CreatedAt >= since && v.UserId == userId);
    if (userCallsToday >= perUserCap) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
    var globalCallsToday = await db.VisionCalls.CountAsync(v => v.CreatedAt >= since);
    if (globalCallsToday >= globalCap) return Results.StatusCode(StatusCodes.Status429TooManyRequests);

    // Take the slot BEFORE spending it, or the cap counts the wrong thing.
    //
    // The row that closes the window is written by VisionService.LogCall, which
    // runs only after the upstream response comes back — up to the 8s Tailor
    // Vision timeout plus the Azure OpenAI fallback. So the two counts above
    // were a check-then-act with a multi-second gap: every request in flight
    // reads the same total, every one passes, and every one makes a billed
    // call. The comment on the cap says "without it, one client can drain the
    // whole day's AINK budget" — which is exactly what the gap allows, one
    // burst at a time. Same shape as the money-path double-spends, against
    // spend rather than credit.
    //
    // A reservation row makes in-flight calls visible to concurrent callers.
    // It is removed in the finally below, so a completed call is counted once,
    // by LogCall's real record. If the process dies mid-call the reservation
    // survives its 24h window and slightly over-counts — erring toward the cap,
    // which is the safe direction for a spend control.
    var reservation = new VisionCall
    {
        Provider = VisionReservation.Provider,
        Success = false,
        UserId = userId,
    };
    db.VisionCalls.Add(reservation);
    await db.SaveChangesAsync();

    VisionResult result;
    try
    {
        result = await vision.IdentifyContainers(base64, userId);
    }
    finally
    {
        try
        {
            db.VisionCalls.Remove(reservation);
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            // Losing the row is not worth failing the member's scan over — it
            // expires from the 24h window on its own. Say so rather than
            // swallowing it, because a build-up here would quietly tighten the
            // cap on everyone.
            app.Logger.LogWarning(ex, "Could not release vision reservation {Id}", reservation.Id);
        }
    }
    var normalizedContainers = (result.Containers ?? [])
        .Select(VisionService.NormalizeContainer)
        .ToList();
    // Preview must quote what /confirm will actually credit, launch bonus included.
    var previewProfile = await db.Profiles.FindAsync(userId.Value);
    var eligibleCount = normalizedContainers.Where(c => c.Eligible).Sum(c => c.Count);
    var totalItems = eligibleCount;
    var totalCents = LaunchBonus.TotalCents(
        previewProfile?.TotalContainers ?? 0, eligibleCount, LaunchBonus.CapFrom(cfg));

    // If this scan is at a known GoodSort bin, resolve it now so the token can
    // commit to the bin + its location. /confirm then enforces a geofence (the
    // member must physically be at the bin), which defeats remote credit-farming
    // for the unattended-deposit flow. Unknown/missing bin code → not bin-bound.
    Bin? depositBin = string.IsNullOrEmpty(req.BinCode)
        ? null
        : await db.Bins.FirstOrDefaultAsync(b => b.Code == req.BinCode);

    // Perceptual hash of the photo, committed in the token so /confirm can reject
    // a replay of a recently-accepted deposit photo (the simplest farm: snap one
    // can, resubmit forever). Computed here where the raw image already is — the
    // image isn't carried to /confirm. Fail-open to null if it can't be decoded.
    var photoHash = PerceptualHash.TryCompute(base64);

    // Issue a 10-minute signed commitment to the vision result. /confirm reads
    // items from this — the client's POST body items list is ignored.
    var scanToken = tokens.Issue(new ScanTokenPayload
    {
        Uid = userId.Value,
        Items = normalizedContainers.Select(c => new ScanTokenItem
        {
            Name = c.Name, Material = c.Material, Count = c.Count, Eligible = c.Eligible,
        }).ToList(),
        BinCode = depositBin?.Code,
        BinLat = depositBin?.Lat,
        BinLng = depositBin?.Lng,
        PhotoHash = photoHash.HasValue ? PerceptualHash.ToHex(photoHash.Value) : null,
    }, TimeSpan.FromMinutes(10));

    return Results.Ok(new
    {
        containers = normalizedContainers,
        totalItems,
        totalCents,
        message = result.Message,
        scanToken,
        summary = totalItems > 0
            ? $"{totalItems} container{(totalItems != 1 ? "s" : "")} found — ${totalCents / 100.0:F2} pending"
            : result.Message,
    });
}).RequireAuthorization();

// Pre-auth parallel photo classification: runs Vision while the user checks email
// for their 6-digit OTP so results appear in 0ms right after verify-otp. Guarded by
// a single-use HMAC preScanToken issued by /api/auth/send-otp (already IP + 5/hr/email
// rate-limited), global VISION_DAILY_CAP, and atomic Jti spend in UsedScanTokens.
// Credits nothing until authenticated /api/scan/photo/confirm verifies the OTP email.
app.MapPost("/api/scan/photo/preview", async (PhotoScanPreviewRequest req, VisionService vision,
    GoodSortDbContext db, IConfiguration cfg, ScanTokenService tokens) =>
{
    var ticket = tokens.VerifyPreScanTicket(req?.PreScanToken);
    if (ticket is null) return Results.Unauthorized();

    if (string.IsNullOrEmpty(req?.Image))
        return Results.BadRequest(new { error = "No image provided" });

    var base64 = req.Image;
    if (base64.Contains(",")) base64 = base64.Split(',')[1];
    if (base64.Length > 2_000_000)
        return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);

    var since = DateTime.UtcNow.AddHours(-24);
    var globalCap = int.TryParse(cfg["VISION_DAILY_CAP"], out var g) ? g : 2000;
    var globalCallsToday = await db.VisionCalls.CountAsync(v => v.CreatedAt >= since);
    if (globalCallsToday >= globalCap) return Results.StatusCode(StatusCodes.Status429TooManyRequests);

    // Spend ticket.Jti atomically before invoking Vision so each OTP yields at most 1 AI call.
    if (await db.UsedScanTokens.AnyAsync(t => t.Jti == ticket.Jti))
        return Results.Conflict(new { error = "Pre-scan ticket already used." });
    try
    {
        db.UsedScanTokens.Add(new UsedScanToken { Jti = ticket.Jti, UserId = Guid.Empty });
        await db.SaveChangesAsync();
    }
    catch (DbUpdateException)
    {
        return Results.Conflict(new { error = "Pre-scan ticket already used." });
    }

    var reservation = new VisionCall
    {
        Provider = VisionReservation.Provider,
        Success = false,
        UserId = null,
    };
    db.VisionCalls.Add(reservation);
    await db.SaveChangesAsync();

    VisionResult result;
    try
    {
        result = await vision.IdentifyContainers(base64, userId: null);
    }
    finally
    {
        try
        {
            db.VisionCalls.Remove(reservation);
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            app.Logger.LogWarning(ex, "Could not release pre-scan vision reservation {Id}", reservation.Id);
        }
    }

    var normalizedContainers = (result.Containers ?? [])
        .Select(VisionService.NormalizeContainer)
        .ToList();
    var altPreviewEmail = AuthService.GetTgsAlternateAlias(ticket.Email);
    var existingProfile = await db.Profiles.AsNoTracking()
        .FirstOrDefaultAsync(p => p.Email == ticket.Email || p.Phone == ticket.Email
            || (altPreviewEmail != null && (p.Email == altPreviewEmail || p.Phone == altPreviewEmail)));
    var eligibleCount = normalizedContainers.Where(c => c.Eligible).Sum(c => c.Count);
    var totalItems = eligibleCount;
    var totalCents = LaunchBonus.TotalCents(
        existingProfile?.TotalContainers ?? 0, eligibleCount, LaunchBonus.CapFrom(cfg));

    Bin? depositBin = string.IsNullOrEmpty(req.BinCode)
        ? null
        : await db.Bins.FirstOrDefaultAsync(b => b.Code == req.BinCode);
    var photoHash = PerceptualHash.TryCompute(base64);

    var scanToken = tokens.Issue(new ScanTokenPayload
    {
        Uid = Guid.Empty,
        Email = ticket.Email,
        Items = normalizedContainers.Select(c => new ScanTokenItem
        {
            Name = c.Name, Material = c.Material, Count = c.Count, Eligible = c.Eligible,
        }).ToList(),
        BinCode = depositBin?.Code,
        BinLat = depositBin?.Lat,
        BinLng = depositBin?.Lng,
        PhotoHash = photoHash.HasValue ? PerceptualHash.ToHex(photoHash.Value) : null,
    }, TimeSpan.FromMinutes(AuthService.OtpValidMinutes));

    return Results.Ok(new
    {
        containers = normalizedContainers,
        totalItems,
        totalCents,
        message = result.Message,
        scanToken,
        summary = totalItems > 0
            ? $"{totalItems} container{(totalItems != 1 ? "s" : "")} found — ${totalCents / 100.0:F2} pending"
            : result.Message,
    });
}).RequireRateLimiting("auth-otp");

// Confirm photo scan — creates scan records + credits the user.
// MUST use server-side items from the signed scanToken; otherwise a client
// can post {items: [{eligible: true, count: 99999, ...}]} and grant itself
// unlimited credit. The token also pins userId (or OTP email for parallel pre-scan),
// so cross-user spoofing is blocked even if /confirm is hit with the wrong token.
app.MapPost("/api/scan/photo/confirm", async (HttpContext ctx, PhotoConfirmRequest req,
    GoodSortDbContext db, ScanTokenService tokens, IConfiguration cfg, NotificationService notif,
    ILogger<Program> log) =>
{
    var userId = ctx.GetCallerId();
    if (userId is null) return Results.Unauthorized();

    var payload = tokens.Verify(req.ScanToken);
    if (payload is null) return Results.BadRequest(new { error = "Invalid or expired scan token. Re-take the photo." });
    if (payload.Uid != Guid.Empty)
    {
        if (payload.Uid != userId.Value) return Results.Forbid();
    }
    else
    {
        var callerForToken = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(p => p.Id == userId.Value);
        if (callerForToken is null
            || string.IsNullOrWhiteSpace(payload.Email)
            || !AuthService.AreEquivalentEmails(callerForToken.Email, payload.Email))
        {
            return Results.Forbid();
        }
    }

    if (req.Lat is double reqLat && (!double.IsFinite(reqLat) || reqLat is < -90 or > 90))
        return Results.BadRequest(new { error = "Valid latitude between -90 and 90 is required." });
    if (req.Lng is double reqLng && (!double.IsFinite(reqLng) || reqLng is < -180 or > 180))
        return Results.BadRequest(new { error = "Valid longitude between -180 and 180 is required." });

    // ── Unattended-deposit geofence (anti-fraud) ──
    // When the token is bound to a physical bin, the member must actually be at
    // that bin to claim credit — otherwise anyone could farm 5¢ deposits from
    // their couch. Distance is computed from the bin location committed in the
    // signed token (not client-supplied) to the device location at confirm.
    // Tunable radius; absent device location is treated as out-of-fence when a
    // bin is bound. Non-bin scans (household/runner) skip this entirely.
    var geofenceRadiusM = double.TryParse(cfg["DEPOSIT_GEOFENCE_RADIUS_M"], out var gr)
        && double.IsFinite(gr) && gr is >= 10.0 and <= 5000.0
            ? gr
            : 150.0;
    var binBound = payload.BinLat.HasValue && payload.BinLng.HasValue;
    double? depositDistanceM = null;
    var geofenceVerified = false;
    if (binBound)
    {
        if (req.Lat is null || req.Lng is null)
            return Results.BadRequest(new { error = "Location required to deposit at this bin. Enable location and try again." });
        depositDistanceM = HaversineKm(payload.BinLat!.Value, payload.BinLng!.Value, req.Lat.Value, req.Lng.Value) * 1000.0;
        geofenceVerified = depositDistanceM <= geofenceRadiusM;
        if (!geofenceVerified)
            return Results.BadRequest(new { error = $"You appear to be {depositDistanceM:F0}m from the bin. Move closer to deposit." });
    }

    // ── Spend the token (anti-fraud) ──
    // The signature proves this token is genuine. It says nothing about whether
    // it has already been redeemed, and the perceptual-hash check below cannot
    // cover that gap on its own: it is fail-open by design, and ImageSharp does
    // not decode HEIC, so a photo picked from an iPhone library arrives with
    // PhotoHash null and no replay defence at all. Without this, that member
    // could confirm the same token in a loop for the ten minutes it lives.
    //
    // Insert-then-catch rather than check-then-insert: two concurrent confirms
    // can both pass a check, but only one can win a primary key.
    // Spending the token and crediting the scan must land together. The spend
    // commits on its own save, so a failure after it leaves the token used and
    // no containers credited — the member photographed a real haul and got
    // nothing, with the token now refusing a retry. See Atomic.
    return await StatusClaim.WithUserGateAsync(userId.Value, () => Atomic.RunAsync<IResult>(db, async () =>
    {
    var profile = await db.Profiles.FindAsync(userId.Value);
    if (profile is null) return Results.NotFound("User not found");

    // Enforce the same 24h per-member container ceiling as POST /api/scans BEFORE
    // spending the signed scan token so a rate-capped member does not burn their token.
    var scanCap = int.TryParse(cfg["SCAN_DAILY_CAP"], out var sc) ? sc : 2000;
    if (scanCap > 0)
    {
        var plannedContainers = payload.Items.Where(i => i.Eligible).Sum(i => Math.Clamp(i.Count, 0, 100));
        if (plannedContainers > 0)
        {
            var since = DateTime.UtcNow.AddHours(-24);
            var scansToday = await db.Scans.CountAsync(x => x.UserId == profile.Id && x.CreatedAt >= since);
            if (scansToday >= scanCap || scansToday + plannedContainers > scanCap)
                return Results.StatusCode(StatusCodes.Status429TooManyRequests);
        }
    }

    var household = profile.HouseholdId.HasValue
        ? await db.Households.FindAsync(profile.HouseholdId.Value)
        : null;

    db.UsedScanTokens.Add(new UsedScanToken { Jti = payload.Jti, UserId = userId.Value });
    try
    {
        await db.SaveChangesAsync();
    }
    catch (Exception ex) when (ex is DbUpdateException or InvalidOperationException or ArgumentException)
    {
        db.ChangeTracker.Clear();
        return Results.BadRequest(new { error = "Those containers have already been added. Take a fresh photo to scan more." });
    }

    // ── Photo-replay defence (anti-fraud) ──
    // The simplest farm is "snap one can, resubmit the same photo forever". A
    // perceptual hash (committed in the token) lets us catch it: if this photo is
    // within a small Hamming distance of a deposit photo we recently accepted —
    // from the same bin OR the same user — it's a replay, so refuse credit. The
    // threshold is small (visually-identical only); honest re-photographs of a
    // new haul differ by far more. Skipped when the photo couldn't be hashed.
    if (PerceptualHash.TryFromHex(payload.PhotoHash, out var thisHash))
    {
        var replayThreshold = int.TryParse(cfg["DEPOSIT_REPLAY_HAMMING_MAX"], out var rt) ? rt : 6;
        var replayWindow = DateTime.UtcNow.AddHours(
            double.TryParse(cfg["DEPOSIT_REPLAY_WINDOW_HOURS"], out var rw) ? -rw : -24);

        // Only compare against deposits that could plausibly be the same farm:
        // same physical bin, or same depositor. Bounded scan keeps it cheap.
        var recentHashes = await db.Scans
            .Where(s => s.PhotoHash != null && s.CreatedAt >= replayWindow
                        && (s.UserId == userId.Value
                            || (payload.BinCode != null && s.BinCode == payload.BinCode)))
            .OrderByDescending(s => s.CreatedAt)
            .Select(s => s.PhotoHash!)
            .Take(500)
            .ToListAsync();

        foreach (var hex in recentHashes)
        {
            if (PerceptualHash.TryFromHex(hex, out var prior)
                && PerceptualHash.HammingDistance(thisHash, prior) <= replayThreshold)
            {
                return Results.BadRequest(new { error = "That looks like a photo you've already deposited. Take a fresh photo of the containers in the bin." });
            }
        }
    }

    var photoHashHex = PerceptualHash.TryFromHex(payload.PhotoHash, out _) ? payload.PhotoHash : null;
    var totalCents = 0;
    var totalContainers = 0;
    var bonusCap = LaunchBonus.CapFrom(cfg);
    var perItemCredits = new List<(string Material, int Count, int Cents)>();

    foreach (var item in payload.Items)
    {
        if (!item.Eligible) continue;
        // Cap per-scan count to a sane upper bound — defends against a
        // poisoned vision response too (defence in depth, not just client trust).
        var safeCount = Math.Clamp(item.Count, 0, 100);
        var normalizedName = VisionService.NormalizeContainerName(item.Name);
        var normalizedMaterial = VisionService.MapMaterial(item.Material);
        var itemCents = 0;
        for (var i = 0; i < safeCount; i++)
        {
            // Launch bonus applies to a member's first N containers ever, so the
            // rate is read per container against their running lifetime total.
            var cents = LaunchBonus.CentsForContainerAt(profile.TotalContainers + totalContainers, bonusCap);
            db.Scans.Add(new Scan
            {
                UserId = profile.Id,
                HouseholdId = household?.Id,
                BinCode = payload.BinCode,
                Barcode = "PHOTO",
                ContainerName = normalizedName,
                Material = normalizedMaterial,
                RefundCents = cents,
                Status = "pending",
                DepositLat = req.Lat,
                DepositLng = req.Lng,
                DepositDistanceM = depositDistanceM,
                GeofenceVerified = geofenceVerified,
                PhotoHash = photoHashHex,
            });
            totalContainers++;
            totalCents += cents;
            itemCents += cents;
        }
        if (safeCount > 0)
            perItemCredits.Add((normalizedMaterial, safeCount, itemCents));
    }

    profile.PendingCents += totalCents;
    profile.TotalContainers += totalContainers;
    profile.TotalCo2SavedKg += totalContainers * 0.035;

    if (household is not null)
    {
        household.PendingContainers += totalContainers;
        household.PendingValueCents += totalCents;
        household.EstimatedWeightKg = household.PendingContainers * 0.020;
        household.EstimatedBags = (int)Math.Ceiling(household.PendingContainers / 150.0);
        household.LastScanAt = DateTime.UtcNow;

        household.Materials ??= new MaterialBreakdown();
        foreach (var (material, safeCount, _) in perItemCredits)
        {
            for (var i = 0; i < safeCount; i++)
            {
                _ = material switch
                {
                    "aluminium" => household.Materials.Aluminium++,
                    "pet" or "pet_clear" or "pet_coloured" => household.Materials.Pet++,
                    "glass" => household.Materials.Glass++,
                    _ => household.Materials.Other++,
                };
            }
        }

        // Mirror onto the bin, per material, using the exact launch-bonus-aware
        // cents credited above so Bin.PendingValueCents matches Household.PendingValueCents.
        var bin = await db.Bins.FirstOrDefaultAsync(b => b.HouseholdId == household.Id);
        foreach (var (material, safeCount, itemCents) in perItemCredits)
        {
            BinCounter.AddScan(bin, safeCount, itemCents, material);
        }
    }

    await db.SaveChangesAsync();

    if (household is not null && !string.IsNullOrWhiteSpace(household.Suburb))
    {
        try
        {
            var board = WaitlistDensity.Aggregate(await WaitlistDensity.LoadRowsAsync(db));
            var cluster = WaitlistDensity.SuburbCluster(board, household.Suburb);
            if (cluster is not null
                && WaitlistDensity.ShouldAnnounceUnlock(cluster.Committed, cluster.Containers, totalContainers))
            {
                var unlockDay = household.CouncilCollectionDay ?? cluster.BestDay ?? 0;
                await notif.SendAreaUnlocked(household.Suburb!, unlockDay, userId);
                await notif.SendOpsStreetReady(household.Suburb!, unlockDay);
            }
        }
        // The suburb-unlocked announcement. Must not fail the scan that
        // triggered it — the member's credit is already written — but a
        // suburb unlocking is the single moment this product exists to
        // deliver, and losing it silently means nobody is told the thing
        // they have been scanning towards.
        catch (Exception ex)
        {
            log.LogError(ex, "Area-unlocked announcement failed for {Suburb} - the scan itself succeeded", household.Suburb);
        }
    }

    return Results.Ok(new
    {
        totalContainers,
        totalCents,
        pendingCents = profile.PendingCents,
        bonusApplied = totalCents > totalContainers * HouseholdCredit.CentsPerContainer,
        bonusRemaining = Math.Max(0, bonusCap - profile.TotalContainers),
    });
    }), ctx.RequestAborted);
}).RequireAuthorization();

// ── Barcode Lookup (Open Food Facts proxy) ──
// Container lookup, proxied to Open Food Facts.
//
// This exists rather than the browser calling OFF directly for three reasons,
// and the first one is why the fallback tier never worked at all:
//
//  1. openfoodfacts.org is not in the CSP's connect-src. I originally wrote
//     here that CSP was therefore refusing the call and the tier was dead in
//     production. That was wrong, and the truth is worse: the CSP was not being
//     served at all, because staticwebapp.config.json sat at the repo root and
//     never reached the deployed artifact. So the direct call did work, and the
//     tier was simply finding nothing — OFF has no record for Australian
//     beverage barcodes. The config deploys now, so a direct call would be
//     refused, and lib/csp.test.ts keeps client hosts and the policy in step.
//  2. OFF asks callers to identify themselves, and a browser cannot —
//     User-Agent is a forbidden header name in fetch, so the one the client set
//     was silently dropped. The named HttpClient sends it for real.
//  3. Anonymous and unthrottled, this endpoint is a way to make our API
//     generate unlimited traffic to a volunteer-run service under our name.
//     It now has a per-IP ceiling and a 5s timeout.
//
// Projected, not proxied raw. It used to return the whole OFF record
// deserialized as `object`; a public endpoint should return the fields the
// caller actually needs, and nothing it happens to receive.
app.MapGet("/api/barcode/{barcode}", async (string barcode, IHttpClientFactory httpFactory, IMemoryCache cache, ILoggerFactory logFactory) =>
{
    if (barcode.Length is < 8 or > 14 || !barcode.All(char.IsDigit))
        return Results.BadRequest(new { error = "Invalid barcode format" });

    // Answered from memory when we have asked before. The same barcode repeats
    // constantly — a household bagging a 24-pack scans one barcode 24 times.
    if (cache.TryGetValue(BarcodeCache.Key(barcode), out object? hit) && hit is not null)
        return Results.Ok(hit);

    void Remember(object payload, bool found) =>
        cache.Set(BarcodeCache.Key(barcode), payload, new MemoryCacheEntryOptions
        {
            Size = 1,
            AbsoluteExpirationRelativeToNow = BarcodeCache.LifetimeFor(found),
        });

    try
    {
        const int MaxBarcodeUpstreamBytes = 256 * 1024;
        var client = httpFactory.CreateClient("OpenFoodFacts");
        using var res = await client.GetAsync($"api/v2/product/{barcode}.json", HttpCompletionOption.ResponseHeadersRead);
        if (!res.IsSuccessStatusCode)
        {
            var miss = new { found = false, barcode };
            Remember(miss, found: false);
            return Results.Ok(miss);
        }

        if (res.Content.Headers.ContentLength is long declaredLen && declaredLen > MaxBarcodeUpstreamBytes)
        {
            return Results.Ok(new { found = false, barcode });
        }

        await using var stream = await res.Content.ReadAsStreamAsync();
        using var ms = new MemoryStream();
        var buf = new byte[8192];
        var totalRead = 0;
        int read;
        while ((read = await stream.ReadAsync(buf)) > 0)
        {
            totalRead += read;
            if (totalRead > MaxBarcodeUpstreamBytes)
                return Results.Ok(new { found = false, barcode });
            ms.Write(buf, 0, read);
        }
        ms.Position = 0;

        using var doc = await JsonDocument.ParseAsync(ms);
        if (!doc.RootElement.TryGetProperty("product", out var product))
        {
            var miss = new { found = false, barcode };
            Remember(miss, found: false);
            return Results.Ok(miss);
        }

        string? Str(string name, int maxLen)
        {
            if (!product.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
                return null;
            var raw = v.GetString()?.Trim();
            if (string.IsNullOrEmpty(raw)) return null;
            return raw.Length <= maxLen ? raw : raw[..maxLen];
        }

        var packagingTags = product.TryGetProperty("packaging_materials_tags", out var tags)
                            && tags.ValueKind == JsonValueKind.Array
            ? tags.EnumerateArray()
                .Where(t => t.ValueKind == JsonValueKind.String)
                .Select(t => t.GetString()?.Trim())
                .Where(t => !string.IsNullOrEmpty(t))
                .Select(t => t!.Length <= 80 ? t : t[..80])
                .Take(12)
                .ToArray()
            : [];

        var payload = new
        {
            found = true,
            barcode,
            productName = Str("product_name", 200) ?? Str("product_name_en", 200),
            brands = Str("brands", 120),
            quantity = Str("quantity", 60),
            packaging = Str("packaging", 300),
            categories = Str("categories", 300),
            packagingMaterialsTags = packagingTags,
        };
        Remember(payload, found: true);
        return Results.Ok(payload);
    }
    catch (Exception ex)
    {
        // Including the 5s timeout. A miss is a normal answer here — the local
        // table is the primary source and OFF has no record for most Australian
        // beverage barcodes — but a silent catch is how the CSP failure hid, so
        // this one says something.
        // Deliberately NOT cached. A timeout or a 503 is OFF having a bad
        // minute, not a statement about this product — caching it would turn a
        // brief outage into six hours of wrong answers for every barcode
        // scanned during it.
        logFactory.CreateLogger("BarcodeLookup").LogWarning(ex, "Open Food Facts lookup failed for {Barcode}", barcode);
        return Results.Ok(new { found = false, barcode });
    }
}).RequireRateLimiting("barcode-lookup");

// ── Households ──
app.MapGet("/api/households", async (GoodSortDbContext db) =>
    Results.Ok(await db.Households.OrderByDescending(h => h.PendingContainers).ToListAsync()))
    // Admin-only already, and correctly so: every household with names,
    // addresses and coordinates. Noted here because getHouseholdsApi in
    // lib/store-api.ts calls it and has no callers of its own — dead client
    // code that would 403 if anything ever used it.
    .RequireAuthorization(AuthHelpers.AdminPolicy);

app.MapGet("/api/households/{id:guid}", async (HttpContext ctx, Guid id, GoodSortDbContext db) =>
{
    var h = await db.Households.FindAsync(id);
    if (h is null) return Results.NotFound();
    if (!await CallerCanAccessHousehold(ctx, id, db)) return Results.Forbid();
    return Results.Ok(h);
}).RequireAuthorization();

app.MapPost("/api/households", async (HttpContext ctx, HouseholdCreateRequest req, GoodSortDbContext db, NotificationService notif) =>
{
    // Bind an explicit request shape, never the entity. Ledger fields
    // (PendingContainers, PendingValueCents, Materials) and lifecycle fields
    // (BinStatus, consent timestamps) are server-owned. A client able to set
    // PendingContainers could forge a suburb's demand signal, flip it live on
    // the public board, and fire an unlock email to every resident there.
    if (!double.IsFinite(req.Lat) || !double.IsFinite(req.Lng)
        || req.Lat is < -90 or > 90 || req.Lng is < -180 or > 180)
        return Results.BadRequest(new { error = "Latitude and longitude must be valid coordinates." });

    static string ClampText(string? value, int maxLen) =>
        string.IsNullOrWhiteSpace(value) ? "" : (value.Trim().Length > maxLen ? value.Trim()[..maxLen] : value.Trim());

    var household = new Household
    {
        Name = ClampText(req.Name, 120),
        Address = ClampText(req.Address, 300),
        Suburb = req.Suburb,
        Street = string.IsNullOrWhiteSpace(req.Street) ? null : ClampText(req.Street, 120),
        Lat = req.Lat,
        Lng = req.Lng,
        Type = req.Type ?? "residential",
        CouncilCollectionDay = req.CouncilCollectionDay,
        CouncilArea = string.IsNullOrWhiteSpace(req.CouncilArea) ? null : ClampText(req.CouncilArea, 80),
        AccessConsent = req.AccessConsent,
        BuildingName = string.IsNullOrWhiteSpace(req.BuildingName) ? null : ClampText(req.BuildingName, 120),
        BinCapacityLitres = req.BinCapacityLitres,
    };

    var parsed = BinDayService.ParseAddress(household.Address);
    household.Suburb = BinDayService.CanonicalSuburb(household.Suburb)
        ?? (parsed is not null ? BinDayService.CanonicalSuburb(parsed.Suburb) : null);
    if (string.IsNullOrWhiteSpace(household.Street) && parsed is not null)
        household.Street = parsed.Street;

    var reject = WaitlistJoin.RejectCreate(household);
    if (reject is not null)
        return Results.BadRequest(new { error = reject });

    // Signup starts scan-first waitlist. Ops schedules a volume run when suburb
    // container volume is enough — clients cannot jump to collecting on create.
    household.BinStatus = BinStatuses.Waitlisted;
    household.WaitlistedAt = DateTime.UtcNow;
    household.AccessConsentAt = household.AccessConsent ? DateTime.UtcNow : null;
    household.UsesDivider = true;

    var callerId = ctx.GetCallerId();

    // Prevent single-account Sybil inflation of WaitlistDensity.MinHouseholdsForRun (3)
    // and concurrent check-then-act double-attachment of orphan scans / referral credits:
    // non-admin callers run through WithUserGateAsync + StatusClaim.TryClaimFirstHousehold
    // so concurrent POST /api/households requests return the single winning household
    // idempotently. (Address edits go via PATCH .../street.)
    if (!ctx.IsAdmin() && callerId is Guid nonAdminUid)
    {
        var (resolvedHousehold, createdNew, duplicateBlocked) = await StatusClaim.WithUserGateAsync(
            nonAdminUid,
            () => Atomic.RunAsync<(Household, bool, bool)>(db, async () =>
            {
                var profileSnapshot = await db.Profiles.AsNoTracking()
                    .Where(p => p.Id == nonAdminUid)
                    .Select(p => new { p.Id, p.HouseholdId, p.ReferrerId })
                    .FirstOrDefaultAsync();

                if (profileSnapshot?.HouseholdId is Guid existingId
                    && await db.Households.AsNoTracking().FirstOrDefaultAsync(h => h.Id == existingId) is { } existing)
                {
                    return (existing, false, false);
                }

                // Guard physical street-address deduplication: prevent 3 Sybil accounts at one
                // house from creating 3 Households, spoofing MinHouseholdsForRun = 3, or spawning
                // 3 duplicate RunStops at one gate — while allowing an invited partner/housemate
                // (whose ReferrerId is an existing member of that household) to join the same household!
                var houseKey = household.Type != "unit_complex"
                    ? WaitlistJoin.PhysicalHouseKey(household.Suburb, household.Address, household.Street)
                    : null;
                if (houseKey is not null)
                {
                    var canonSuburb = BinDayService.CanonicalSuburb(household.Suburb)!;
                    var suburbPeers = await db.Households
                        .Include(h => h.Members)
                        .Where(h => h.Type != "unit_complex" && h.Suburb != null && h.Suburb.ToUpper() == canonSuburb)
                        .ToListAsync();
                    var matchingHouse = suburbPeers.FirstOrDefault(h =>
                        string.Equals(WaitlistJoin.PhysicalHouseKey(h.Suburb, h.Address, h.Street), houseKey, StringComparison.OrdinalIgnoreCase));
                    if (matchingHouse is not null)
                    {
                        var invitedByHousemate = profileSnapshot?.ReferrerId is Guid inviterId
                            && matchingHouse.Members.Any(m => m.Id == inviterId);
                        if (!invitedByHousemate)
                        {
                            return (matchingHouse, false, true);
                        }

                        var joiningMember = await db.Profiles.FindAsync(nonAdminUid);
                        if (joiningMember is not null)
                        {
                            joiningMember.HouseholdId = matchingHouse.Id;
                            // Housemates sharing one physical address cannot earn Container Mafia self-referral credits.
                            joiningMember.ReferrerId = null;
                            var joinOrphans = await db.Scans
                                .Where(sc => sc.UserId == joiningMember.Id && sc.HouseholdId == null && sc.Status == "pending")
                                .ToListAsync();
                            var sharedBin = await db.Bins.FirstOrDefaultAsync(b => b.HouseholdId == matchingHouse.Id);
                            ScanBackfill.AttachTo(matchingHouse, joinOrphans, sharedBin);
                            await db.SaveChangesAsync();
                        }
                        return (matchingHouse, false, false);
                    }
                }

                db.Households.Add(household);

                if (profileSnapshot is not null)
                {
                    // Persist Household first so FK_Profiles_Households_HouseholdId is satisfied
                    // when TryClaimFirstHousehold atomically transitions HouseholdId null -> household.Id.
                    await db.SaveChangesAsync();
                    var won = await StatusClaim.TryClaimFirstHousehold(db, nonAdminUid, household.Id);
                    if (!won)
                    {
                        db.Households.Remove(household);
                        await db.SaveChangesAsync();
                        var winnerId = await db.Profiles.AsNoTracking()
                            .Where(p => p.Id == nonAdminUid)
                            .Select(p => p.HouseholdId)
                            .FirstOrDefaultAsync();
                        var winner = winnerId is Guid wid
                            ? await db.Households.AsNoTracking().FirstOrDefaultAsync(h => h.Id == wid)
                            : null;
                        return (winner ?? household, false, false);
                    }
                }

                Bin? createdBin = null;
                if (household.Type != "unit_complex")
                {
                    var code = $"GS-H{Math.Abs(household.Id.GetHashCode()) % 100000:D5}";
                    createdBin = new Bin
                    {
                        Code = code,
                        Name = household.Name,
                        Address = household.Address,
                        Lat = household.Lat,
                        Lng = household.Lng,
                        HouseholdId = household.Id,
                        HostedBy = null,
                    };
                    db.Bins.Add(createdBin);
                }

                if (profileSnapshot is not null)
                {
                    var me = await db.Profiles.FindAsync(nonAdminUid);
                    if (me is not null)
                    {
                        if (me.ReferrerId is Guid rid && rid != nonAdminUid)
                        {
                            var referrer = await db.Profiles.FindAsync(rid);
                            if (referrer is not null && referrer.ReferrerId != nonAdminUid)
                            {
                                var refHouse = referrer.HouseholdId is Guid rhid
                                    ? await db.Households.AsNoTracking().FirstOrDefaultAsync(h => h.Id == rhid)
                                    : null;
                                var refKey = refHouse is not null
                                    ? WaitlistJoin.PhysicalHouseKey(refHouse.Suburb, refHouse.Address, refHouse.Street)
                                    : null;
                                if (houseKey is not null && refKey is not null
                                    && string.Equals(houseKey, refKey, StringComparison.OrdinalIgnoreCase))
                                {
                                    me.ReferrerId = null;
                                }
                                // Referrals earn Good Sort Points only (+100 PTS join + 1 PT/can), 0¢ cash bonus.
                            }
                            else
                            {
                                me.ReferrerId = null;
                            }
                        }

                        var orphans = await db.Scans
                            .Where(sc => sc.UserId == me.Id && sc.HouseholdId == null && sc.Status == "pending")
                            .ToListAsync();
                        var backfillBin = createdBin
                            ?? db.Bins.Local.FirstOrDefault(b => b.HouseholdId == household.Id)
                            ?? await db.Bins.FirstOrDefaultAsync(b => b.HouseholdId == household.Id);
                        ScanBackfill.AttachTo(household, orphans, backfillBin);
                    }
                }

                await db.SaveChangesAsync();
                return (household, true, false);
            }),
            ctx.RequestAborted);

        if (duplicateBlocked)
        {
            return Results.Conflict(new
            {
                error = "A household is already registered at this street address. Ask your housemate for their invite link to join the same household.",
            });
        }

        if (!createdNew)
        {
            return Results.Created($"/api/households/{resolvedHousehold.Id}", resolvedHousehold);
        }
    }
    else
    {
        await Atomic.RunAsync(db, async () =>
        {
            db.Households.Add(household);

            Bin? createdBin = null;
            if (household.Type != "unit_complex")
            {
                var code = $"GS-H{Math.Abs(household.Id.GetHashCode()) % 100000:D5}";
                createdBin = new Bin
                {
                    Code = code,
                    Name = household.Name,
                    Address = household.Address,
                    Lat = household.Lat,
                    Lng = household.Lng,
                    HouseholdId = household.Id,
                    HostedBy = null,
                };
                db.Bins.Add(createdBin);
            }

            if (callerId is Guid uid)
            {
                var me = await db.Profiles.FindAsync(uid);
                if (me is not null)
                {
                    if (me.ReferrerId is Guid rid && rid != uid && me.HouseholdId is null)
                    {
                        var referrer = await db.Profiles.FindAsync(rid);
                        var houseKey = WaitlistJoin.PhysicalHouseKey(household.Suburb, household.Address, household.Street);
                        var refHouse = referrer?.HouseholdId is Guid rhid
                            ? await db.Households.AsNoTracking().FirstOrDefaultAsync(h => h.Id == rhid)
                            : null;
                        var refKey = refHouse is not null
                            ? WaitlistJoin.PhysicalHouseKey(refHouse.Suburb, refHouse.Address, refHouse.Street)
                            : null;
                        var sameHouse = houseKey is not null && refKey is not null
                            && string.Equals(houseKey, refKey, StringComparison.OrdinalIgnoreCase);
                        if (referrer is null || referrer.ReferrerId == uid || sameHouse)
                        {
                            me.ReferrerId = null;
                        }
                        // Referrals earn Good Sort Points only (0¢ cash signup bonus).
                    }
                    var isFirstHousehold = me.HouseholdId is null;
                    me.HouseholdId ??= household.Id;

                    if (isFirstHousehold)
                    {
                        var orphans = await db.Scans
                            .Where(sc => sc.UserId == me.Id && sc.HouseholdId == null && sc.Status == "pending")
                            .ToListAsync();
                        var backfillBin = createdBin
                            ?? db.Bins.Local.FirstOrDefault(b => b.HouseholdId == household.Id)
                            ?? await db.Bins.FirstOrDefaultAsync(b => b.HouseholdId == household.Id);
                        ScanBackfill.AttachTo(household, orphans, backfillBin);
                    }
                }
            }

            await db.SaveChangesAsync();
            return true;
        });
    }

    var board = WaitlistDensity.Aggregate(await WaitlistDensity.LoadRowsAsync(db));
    var cluster = WaitlistDensity.DayCluster(board, household.Suburb, household.CouncilCollectionDay);
    var suburbCluster = WaitlistDensity.SuburbCluster(board, household.Suburb);
    var clusterCount = cluster?.Containers ?? 0;

    Profile? caller = null;
    if (callerId is Guid cid)
        caller = await db.Profiles.FindAsync(cid);

    try
    {
        if (!string.IsNullOrWhiteSpace(caller?.Email))
            await notif.SendWaitlistJoined(caller.Email, caller.Name, household, clusterCount, cluster?.Needed ?? WaitlistDensity.LiveThreshold, caller.Id);
        if (household.CouncilCollectionDay is int progressDay
            && !string.IsNullOrWhiteSpace(household.Suburb)
            && WaitlistNudge.ShouldNudgeOthers(clusterCount, cluster?.Live ?? false))
            await notif.SendWaitlistProgress(household.Suburb, progressDay, clusterCount, cluster?.Needed ?? WaitlistDensity.LiveThreshold, caller?.Id);
        if (suburbCluster is not null
            && WaitlistDensity.ShouldAnnounceUnlock(suburbCluster.Committed, suburbCluster.Containers, household.PendingContainers))
        {
            var unlockDay = household.CouncilCollectionDay ?? suburbCluster.BestDay ?? 0;
            await notif.SendAreaUnlocked(household.Suburb!, unlockDay, caller?.Id);
            await notif.SendOpsStreetReady(household.Suburb!, unlockDay);
        }
    }
    catch (Exception)
    {
        // Waitlist signup must succeed even if ACS is down.
    }

    return Results.Created($"/api/households/{household.Id}", household);
}).RequireAuthorization();

// Finish suburb + recycling day on a waitlisted household. Leftover prod
// rows and failed Photon parses cannot create a second household.
app.MapPatch("/api/households/{id:guid}/street", async (HttpContext ctx, Guid id, StreetPatchRequest req, GoodSortDbContext db, NotificationService notif) =>
{
    var h = await db.Households.FindAsync(id);
    if (h is null) return Results.NotFound();
    if (!await CallerCanAccessHousehold(ctx, id, db)) return Results.Forbid();
    if (!InviteLink.CanEditCluster(h.BinStatus))
        return Results.BadRequest(new { error = "Street details are locked after we order bins." });

    var beforeSuburb = h.Suburb;
    var beforeDay = h.CouncilCollectionDay;
    var wasIncomplete = string.IsNullOrWhiteSpace(beforeSuburb) || beforeDay is null;

    if (req.Lat is double checkLat && (!double.IsFinite(checkLat) || checkLat is < -90 or > 90))
        return Results.BadRequest(new { error = "Latitude must be between -90 and 90." });
    if (req.Lng is double checkLng && (!double.IsFinite(checkLng) || checkLng is < -180 or > 180))
        return Results.BadRequest(new { error = "Longitude must be between -180 and 180." });

    if (!string.IsNullOrWhiteSpace(req.Address))
    {
        var trimmedAddr = req.Address.Trim();
        if (h.Type != "unit_complex" && !WaitlistJoin.HasStreetNumber(trimmedAddr))
            return Results.BadRequest(new { error = "Include your street number (for example, 12 Beaudesert Rd) so a Runner can find your kerb." });
        h.Address = trimmedAddr.Length > 300 ? trimmedAddr[..300] : trimmedAddr;
        var parsed = BinDayService.ParseAddress(h.Address);
        if (parsed is not null)
        {
            h.Street = parsed.Street;
            var parsedSuburb = BinDayService.CanonicalSuburb(parsed.Suburb);
            if (parsedSuburb is not null) h.Suburb = parsedSuburb;
        }
    }
    if (req.Lat is double lat) h.Lat = lat;
    if (req.Lng is double lng) h.Lng = lng;

    // A city-wide answer is not a suburb. Photon regularly returns "Brisbane"
    // for an address, and CanonicalSuburb maps that to null — so silently
    // skipping the assignment used to return 200 with nothing saved. The
    // client then sent the member to /sort, which bounced them back here,
    // forever, behind a green success path. Say so instead.
    var suburb = BinDayService.CanonicalSuburb(req.Suburb);
    if (suburb is null && !string.IsNullOrWhiteSpace(req.Suburb))
        return Results.BadRequest(new
        {
            error = $"“{req.Suburb.Trim()}” covers the whole city, so we cannot tell which street to collect. Pick your actual suburb — for example Moorooka.",
        });
    if (suburb is not null) h.Suburb = suburb;
    if (req.CouncilCollectionDay is int day && day is >= 0 and <= 6)
        h.CouncilCollectionDay = day;
    if (!string.IsNullOrWhiteSpace(req.CouncilArea))
    {
        var trimmedArea = req.CouncilArea.Trim();
        h.CouncilArea = trimmedArea.Length > 80 ? trimmedArea[..80] : trimmedArea;
    }
    if (req.AccessConsent == true)
    {
        h.AccessConsent = true;
        h.AccessConsentAt ??= DateTime.UtcNow;
    }
    h.UsesDivider = true;

    var householdBin = await db.Bins.FirstOrDefaultAsync(b => b.HouseholdId == h.Id);
    if (householdBin is not null)
    {
        householdBin.Name = h.Name;
        householdBin.Address = h.Address;
        if (h.Lat != 0) householdBin.Lat = h.Lat;
        if (h.Lng != 0) householdBin.Lng = h.Lng;
    }

    // If a member repaired an incomplete household after scanning containers,
    // attach any pending orphan scans now so suburb volume reflects them.
    if (ctx.GetCallerId() is Guid repairCallerId && h.Type != "unit_complex")
    {
        var orphans = await db.Scans
            .Where(sc => sc.UserId == repairCallerId && sc.HouseholdId == null && sc.Status == "pending")
            .ToListAsync();
        if (orphans.Count > 0)
        {
            if (householdBin is null)
            {
                householdBin = new Bin
                {
                    Code = $"GS-H{Math.Abs(h.Id.GetHashCode()) % 100000:D5}",
                    Name = h.Name,
                    Address = h.Address,
                    Lat = h.Lat,
                    Lng = h.Lng,
                    HouseholdId = h.Id,
                    HostedBy = null,
                };
                db.Bins.Add(householdBin);
            }
            ScanBackfill.AttachTo(h, orphans, householdBin);
        }
    }

    await db.SaveChangesAsync();

    var clusterChanged = !string.Equals(beforeSuburb, h.Suburb, StringComparison.OrdinalIgnoreCase)
        || beforeDay != h.CouncilCollectionDay;
    if (clusterChanged)
    {
        var board = WaitlistDensity.Aggregate(await WaitlistDensity.LoadRowsAsync(db));
        var cluster = WaitlistDensity.DayCluster(board, h.Suburb, h.CouncilCollectionDay);
        var suburbCluster = WaitlistDensity.SuburbCluster(board, h.Suburb);
        var clusterCount = cluster?.Containers ?? 0;
        var callerId = ctx.GetCallerId();
        Profile? caller = callerId is Guid cid ? await db.Profiles.FindAsync(cid) : null;
        try
        {
            if (wasIncomplete && !string.IsNullOrWhiteSpace(caller?.Email))
                await notif.SendWaitlistJoined(caller.Email, caller.Name, h, clusterCount, cluster?.Needed ?? WaitlistDensity.LiveThreshold, caller.Id);
            if (h.CouncilCollectionDay is int progressDay
                && !string.IsNullOrWhiteSpace(h.Suburb)
                && WaitlistNudge.ShouldNudgeOthers(clusterCount, cluster?.Live ?? false))
                await notif.SendWaitlistProgress(h.Suburb, progressDay, clusterCount, cluster?.Needed ?? WaitlistDensity.LiveThreshold, caller?.Id);
            if (suburbCluster is not null
                && WaitlistDensity.ShouldAnnounceUnlock(suburbCluster.Committed, suburbCluster.Containers, h.PendingContainers))
            {
                var unlockDay = h.CouncilCollectionDay ?? suburbCluster.BestDay ?? 0;
                await notif.SendAreaUnlocked(h.Suburb!, unlockDay, caller?.Id);
                await notif.SendOpsStreetReady(h.Suburb!, unlockDay);
            }
        }
        catch (Exception)
        {
            // Street repair must succeed even if ACS is down.
        }
    }

    return Results.Ok(h);
}).RequireAuthorization();

// Public density — no addresses, no emails. A run unlocks at suburb container
// volume (about 1,000 scanned containers). City-wide totals never unlock.
app.MapGet("/api/growth/brisbane", async (GoodSortDbContext db, IConfiguration cfg) =>
{
    // Carries the live launch-bonus cap so public copy can never advertise a
    // promotion that ops has already turned off.
    return Results.Ok(WaitlistDensity.Aggregate(
        await WaitlistDensity.LoadRowsAsync(db), LaunchBonus.CapFrom(cfg)));
});

// First-party funnel (no PII). City-wide totals here would be a product bug —
// this endpoint only records that a named waitlist action happened.
// Must stay in step with TRACKED_EVENTS in lib/analytics.ts. A name present on
// one side only is dropped silently — the client discards our 400 and nothing
// surfaces. Scanning is the core action and what the launch bonus pays for, so
// it is instrumented camera-to-credit; first_scan_credited is activation.
var waitlistEvents = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
{
    "landing_viewed", "suburb_page_viewed", "map_viewed",
    "waitlist_cta",
    "scan_camera_opened", "scan_captured", "scan_credited", "first_scan_credited",
    "otp_sent", "otp_verified", "household_joined", "payout_details_saved",
    "bag_tagged", "flyer_printed",
    "invite_whatsapp", "invite_sms", "invite_share", "invite_landed", "suburb_picked",
    "bin_day_looked_up",
    "points_swap_voted", "cash_payout_selected",
    "camera_denied", "scan_vision_ok", "scan_vision_empty", "scan_vision_error",
    "scan_barcode_ok", "onboard_viewed", "sort_dashboard_viewed",
};
app.MapPost("/api/growth/events", async (WaitlistEventRequest req, GoodSortDbContext db, ILoggerFactory logFactory) =>
{
    var name = req.Name?.Trim();
    if (string.IsNullOrWhiteSpace(name) || !waitlistEvents.Contains(name))
        return Results.BadRequest();
    var key = name.ToLowerInvariant();

    // Canonicalise and scrub on WRITE and before logging so street addresses,
    // emails, GUIDs, barcodes, query/fragment tokens, and CR/LF never enter GrowthEvents.
    var suburb = GrowthEventSanitizer.SanitizeSuburb(req.Suburb);
    var path = GrowthEventSanitizer.SanitizePath(req.Path);

    // Fire-and-forget: telemetry must never break the request it measures.
    try
    {
        db.GrowthEvents.Add(new GrowthEvent { Name = key, Suburb = suburb, Path = path });
        await db.SaveChangesAsync();
    }
    catch (Exception ex)
    {
        logFactory.CreateLogger("WaitlistGrowth").LogWarning(ex, "Could not persist growth event {Name}", key);
    }

    logFactory.CreateLogger("WaitlistGrowth").LogInformation(
        "waitlist_event name={Name} suburb={Suburb} path={Path}", key, suburb, path);
    return Results.Accepted();
}).RequireRateLimiting("growth-events");

// Durable now. Supports `days` (1..RetentionDays, default 30) and optional `suburb`
// filter, returning ordered conversion stages, top suburbs, and daily scan/signup momentum.
app.MapGet("/api/admin/funnel", async (int? days, string? suburb, GoodSortDbContext db) =>
{
    var window = Math.Clamp(days ?? 30, 1, GrowthEventRetention.RetentionDays);
    var since = DateTime.UtcNow.AddDays(-window);
    var canonicalSuburb = string.IsNullOrWhiteSpace(suburb) ? null : BinDayService.CanonicalSuburb(suburb);

    var baseQuery = db.GrowthEvents.AsNoTracking().Where(e => e.CreatedAt >= since);

    var suburbBreakdown = await baseQuery
        .Where(e => e.Suburb != null && e.Suburb != "")
        .GroupBy(e => e.Suburb!)
        .Select(g => new { suburb = g.Key, totalEvents = g.LongCount() })
        .OrderByDescending(x => x.totalEvents)
        .Take(30)
        .ToListAsync();

    var filteredQuery = canonicalSuburb is not null
        ? baseQuery.Where(e => e.Suburb == canonicalSuburb)
        : baseQuery;

    var counts = await filteredQuery
        .GroupBy(e => e.Name)
        .Select(g => new { Name = g.Key, Count = g.LongCount() })
        .ToListAsync();
    var byName = counts.ToDictionary(c => c.Name, c => c.Count, StringComparer.OrdinalIgnoreCase);

    long CountOf(string key) => byName.TryGetValue(key, out var c) ? c : 0L;

    // Ordered conversion funnel stages from landing through activation, bags, and sharing.
    var rawStages = new (string Key, string Label, long Count)[]
    {
        ("views", "Landing & suburb views", CountOf("landing_viewed") + CountOf("suburb_page_viewed") + CountOf("map_viewed")),
        ("waitlist_cta", "Start / Scan CTA tapped", CountOf("waitlist_cta")),
        ("scan_camera_opened", "Camera opened", CountOf("scan_camera_opened")),
        ("scan_captured", "Container captured", CountOf("scan_captured")),
        ("otp_sent", "OTP code sent", CountOf("otp_sent")),
        ("otp_verified", "OTP verified", CountOf("otp_verified")),
        ("first_scan_credited", "First scan credited", CountOf("first_scan_credited")),
        ("household_joined", "Address saved", CountOf("household_joined")),
        ("payout_details_saved", "PayID / BSB saved", CountOf("payout_details_saved")),
        ("bag_tagged", "Home bag tagged", CountOf("bag_tagged")),
        ("invites_shared", "Neighbour invites shared", CountOf("invite_whatsapp") + CountOf("invite_sms") + CountOf("invite_share")),
    };

    var orderedStages = new List<object>(rawStages.Length);
    long? prevCount = null;
    foreach (var stage in rawStages)
    {
        int? conversionPct = prevCount is > 0
            ? (int)Math.Round(Math.Min(999, (stage.Count * 100.0) / prevCount.Value))
            : null;
        orderedStages.Add(new
        {
            key = stage.Key,
            label = stage.Label,
            count = stage.Count,
            conversionFromPrevPct = conversionPct,
        });
        prevCount = stage.Count;
    }

    // Daily activity trend (Brisbane local calendar days, capped at 14 days for crisp sparklines).
    var trendDays = Math.Min(window, 14);
    var trendSinceUtc = DateTime.UtcNow.AddDays(-trendDays);
    var recentSignups = await db.Profiles.AsNoTracking()
        .Where(p => !p.IsAdmin && p.CreatedAt >= trendSinceUtc)
        .Select(p => p.CreatedAt)
        .ToListAsync();
    var recentScans = await db.Scans.AsNoTracking()
        .Where(s => s.CreatedAt >= trendSinceUtc)
        .Select(s => s.CreatedAt)
        .ToListAsync();

    var todayBrisbane = BrisbaneTime.Now.Date;
    var signupsByDay = recentSignups
        .GroupBy(dt => (dt + BrisbaneTime.Offset).Date)
        .ToDictionary(g => g.Key, g => g.Count());
    var scansByDay = recentScans
        .GroupBy(dt => (dt + BrisbaneTime.Offset).Date)
        .ToDictionary(g => g.Key, g => g.Count());

    var dailyTrend = Enumerable.Range(0, trendDays)
        .Select(offset => todayBrisbane.AddDays(-(trendDays - 1 - offset)))
        .Select(day => new
        {
            date = day.ToString("yyyy-MM-dd"),
            label = day.ToString("dd MMM"),
            signups = signupsByDay.TryGetValue(day, out var u) ? u : 0,
            scans = scansByDay.TryGetValue(day, out var s) ? s : 0,
        })
        .ToList();

    // Zero-fill so a step that never fired is visibly 0 rather than absent.
    return Results.Ok(new
    {
        since,
        windowDays = window,
        suburb = canonicalSuburb,
        note = canonicalSuburb is not null
            ? $"Counts for {canonicalSuburb} over the last {window} days."
            : $"Counts over the last {window} days. Durable across restarts and deploys.",
        events = waitlistEvents.OrderBy(n => n)
            .ToDictionary(n => n, n => byName.TryGetValue(n, out var c) ? c : 0L),
        orderedStages,
        suburbs = suburbBreakdown,
        dailyTrend,
    });
})
    .RequireAuthorization(AuthHelpers.AdminPolicy);

// Neighbour invite card for ?r= landings. First name + suburb only.
app.MapGet("/api/growth/invite/{id:guid}", async (Guid id, GoodSortDbContext db) =>
{
    var p = await db.Profiles.Include(x => x.Household).FirstOrDefaultAsync(x => x.Id == id);
    if (p is null) return Results.NotFound();
    return Results.Ok(new
    {
        name = InvitePreview.PublicFirstName(p.Name),
        suburb = BinDayService.CanonicalSuburb(p.Household?.Suburb),
        day = p.Household != null && p.Household.Type != "unit_complex" ? p.Household.CouncilCollectionDay : null,
        dayName = p.Household != null && p.Household.Type != "unit_complex" ? InviteLink.PublicDayName(p.Household.CouncilCollectionDay) : null,
    });
});

// ── Bin-day lookup — auto-fills the council recycling day from an address ──
app.MapPost("/api/households/lookup-bin-day", async (BinDayLookupRequest req, BinDayService svc) =>
{
    if (!double.IsFinite(req.Lat) || !double.IsFinite(req.Lng)
        || req.Lat is < -90 or > 90 || req.Lng is < -180 or > 180)
        return Results.BadRequest(new { error = "Valid lat and lng coordinates are required." });
    if (req.Address is { Length: > 300 })
        return Results.BadRequest(new { error = "Address must be 300 characters or fewer." });

    var result = await svc.Lookup(req.Lat, req.Lng, req.Address);
    if (result is null) return Results.Ok(new { found = false });
    return Results.Ok(new { found = true, dayOfWeek = result.DayOfWeek, councilArea = result.CouncilArea, source = result.Source });
}).RequireRateLimiting("bin-day-lookup");

// ── Next collection status — confirmed ONLY when an active GoodSort run includes this household's bin ──
app.MapGet("/api/households/{id:guid}/next-pickup", async (HttpContext ctx, Guid id, GoodSortDbContext db) =>
{
    var h = await db.Households.FindAsync(id);
    if (h is null) return Results.NotFound();
    if (!await CallerCanAccessHousehold(ctx, id, db)) return Results.Forbid();
    if (h.Type == "unit_complex" || h.CouncilCollectionDay is null)
        return Results.Ok(new { nextPickup = (string?)null, confirmed = false, binStatus = h.BinStatus, reason = "Not a residential household with a council collection day set." });

    var utcNow = DateTime.UtcNow;
    var hhBinIds = await db.Bins.AsNoTracking()
        .Where(b => b.HouseholdId == id)
        .Select(b => b.Id)
        .ToListAsync();
    var activeRun = hhBinIds.Count == 0
        ? null
        : await db.RunStops.AsNoTracking()
            .Where(s => hhBinIds.Contains(s.BinId)
                && (s.Run.Status == "claimed"
                    || s.Run.Status == "in_progress"
                    || s.Run.Status == "delivering"
                    || (s.Run.Status == "available" && s.Run.ExpiresAt > utcNow)))
            .Select(s => new { s.Run.Status, s.Run.CreatedAt })
            .FirstOrDefaultAsync();

    var confirmed = activeRun is not null;
    var activeLocalDate = confirmed
        ? (utcNow + BrisbaneTime.Offset).Date.ToString("yyyy-MM-dd")
        : (string?)null;
    return Results.Ok(new
    {
        nextPickup = activeLocalDate,
        confirmed,
        councilDay = h.CouncilCollectionDay,
        runnerDay = (h.CouncilCollectionDay.Value + 6) % 7,
        councilArea = h.CouncilArea,
        usesDivider = h.UsesDivider,
        binStatus = h.BinStatus,
        reason = confirmed
            ? "Active Good Sort run in progress for your suburb — place your QR-tagged sorted bags on the kerb."
            : BinStatuses.IsServiceable(h.BinStatus)
                ? "Keep sorting into your 4 home bags. We'll email you to bag out when a Runner claims your suburb run."
                : "Scan eligible containers for 8¢. A volume run unlocks when your suburb hits about 1,000 scanned containers.",
    });
}).RequireAuthorization();

// ── Household: toggle "bin is out / bin is full" ──
// Purple TGS bin: household marks the bin full so a runner can collect it.
// The RunGenerationService absorbs full-bin households into nearby runs.
app.MapPost("/api/households/{id:guid}/bin-full", async (HttpContext ctx, Guid id, BinOutRequest req, GoodSortDbContext db) =>
{
    var h = await db.Households.FindAsync(id);
    if (h is null) return Results.NotFound();
    if (!await CallerCanAccessHousehold(ctx, id, db)) return Results.Forbid();
    h.BinIsOut = req.Out; // reusing the field — BinIsOut = "bin is full, ready for pickup"
    h.BinIsOutAt = req.Out ? DateTime.UtcNow : null;
    await db.SaveChangesAsync();
    return Results.Ok(new { h.Id, binIsFull = h.BinIsOut, flaggedAt = h.BinIsOutAt });
}).RequireAuthorization();

// Legacy endpoint alias
app.MapPost("/api/households/{id:guid}/bin-out", async (HttpContext ctx, Guid id, BinOutRequest req, GoodSortDbContext db) =>
{
    var h = await db.Households.FindAsync(id);
    if (h is null) return Results.NotFound();
    if (!await CallerCanAccessHousehold(ctx, id, db)) return Results.Forbid();
    h.BinIsOut = req.Out;
    h.BinIsOutAt = req.Out ? DateTime.UtcNow : null;
    await db.SaveChangesAsync();
    return Results.Ok(new { h.Id, h.BinIsOut, h.BinIsOutAt });
}).RequireAuthorization();

// ── Waitlist for unit_complex customers (phase 2) ──
app.MapPost("/api/waitlist/unit-complex", async (HttpContext ctx, UnitComplexWaitlistRequest req, GoodSortDbContext db, NotificationService notif) =>
{
    var buildingName = (req.BuildingName ?? "").Trim();
    var address = (req.Address ?? "").Trim();
    if (string.IsNullOrEmpty(buildingName) || string.IsNullOrEmpty(address))
        return Results.BadRequest(new { error = "Building name and address are required." });
    if (!double.IsFinite(req.Lat) || !double.IsFinite(req.Lng)
        || req.Lat is < -90 or > 90 || req.Lng is < -180 or > 180)
        return Results.BadRequest(new { error = "Latitude and longitude must be valid coordinates." });

    if (buildingName.Length > 120) buildingName = buildingName[..120];
    if (address.Length > 300) address = address[..300];

    var callerId = ctx.GetCallerId();
    var parsed = BinDayService.ParseAddress(address);
    var placeholder = new Household
    {
        Type = "unit_complex",
        Name = buildingName,
        Address = address,
        Lat = req.Lat,
        Lng = req.Lng,
        BuildingName = buildingName,
        Suburb = UnitWaitlist.ResolveSuburb(req.Suburb, parsed?.Suburb),
        Street = parsed?.Street,
        BinStatus = BinStatuses.Waitlisted,
        WaitlistedAt = DateTime.UtcNow,
        AccessConsent = true,
        AccessConsentAt = DateTime.UtcNow,
    };

    Profile? caller = null;
    if (!ctx.IsAdmin() && callerId is Guid nonAdminUnitUid)
    {
        var (resolvedUnit, createdUnitNew) = await StatusClaim.WithUserGateAsync(
            nonAdminUnitUid,
            () => Atomic.RunAsync<(Household, bool)>(db, async () =>
            {
                var snap = await db.Profiles.AsNoTracking()
                    .Where(p => p.Id == nonAdminUnitUid)
                    .Select(p => new { p.Id, p.HouseholdId })
                    .FirstOrDefaultAsync();
                if (snap?.HouseholdId is Guid existingUnitId
                    && await db.Households.AsNoTracking().FirstOrDefaultAsync(h => h.Id == existingUnitId) is { } existingUnit)
                {
                    return (existingUnit, false);
                }

                db.Households.Add(placeholder);
                if (snap is not null)
                {
                    await db.SaveChangesAsync();
                    var won = await StatusClaim.TryClaimFirstHousehold(db, nonAdminUnitUid, placeholder.Id);
                    if (!won)
                    {
                        db.Households.Remove(placeholder);
                        await db.SaveChangesAsync();
                        var winnerId = await db.Profiles.AsNoTracking()
                            .Where(p => p.Id == nonAdminUnitUid)
                            .Select(p => p.HouseholdId)
                            .FirstOrDefaultAsync();
                        var winner = winnerId is Guid wid
                            ? await db.Households.AsNoTracking().FirstOrDefaultAsync(h => h.Id == wid)
                            : null;
                        return (winner ?? placeholder, false);
                    }

                    caller = await db.Profiles.FindAsync(nonAdminUnitUid);
                    if (caller is not null)
                    {
                        if (caller.ReferrerId is Guid rid && rid != nonAdminUnitUid)
                        {
                            var referrer = await db.Profiles.FindAsync(rid);
                            var unitKey = WaitlistJoin.PhysicalHouseKey(placeholder.Suburb, placeholder.Address, placeholder.Street);
                            var refHouse = referrer?.HouseholdId is Guid rhid
                                ? await db.Households.AsNoTracking().FirstOrDefaultAsync(h => h.Id == rhid)
                                : null;
                            var refKey = refHouse is not null
                                ? WaitlistJoin.PhysicalHouseKey(refHouse.Suburb, refHouse.Address, refHouse.Street)
                                : null;
                            var sameBuilding = refHouse is not null && (
                                (unitKey is not null && refKey is not null && string.Equals(unitKey, refKey, StringComparison.OrdinalIgnoreCase))
                                || (string.Equals((refHouse.Address ?? "").Trim(), (placeholder.Address ?? "").Trim(), StringComparison.OrdinalIgnoreCase)
                                    && string.Equals((refHouse.Suburb ?? "").Trim(), (placeholder.Suburb ?? "").Trim(), StringComparison.OrdinalIgnoreCase)));
                            if (referrer is null || referrer.ReferrerId == nonAdminUnitUid || sameBuilding)
                            {
                                caller.ReferrerId = null;
                            }
                            // Referrals earn Good Sort Points only (0¢ cash signup bonus).
                        }
                        var orphans = await db.Scans
                            .Where(sc => sc.UserId == caller.Id && sc.HouseholdId == null && sc.Status == "pending")
                            .ToListAsync();
                        ScanBackfill.AttachTo(placeholder, orphans);
                    }
                }
                await db.SaveChangesAsync();
                return (placeholder, true);
            }),
            ctx.RequestAborted);

        if (!createdUnitNew)
        {
            return Results.Ok(new { waitlisted = true, id = resolvedUnit.Id, suburb = resolvedUnit.Suburb });
        }
    }
    else
    {
        if (callerId is Guid uid) caller = await db.Profiles.FindAsync(uid);
        db.Households.Add(placeholder);
        if (caller is not null && callerId is Guid callerUid)
        {
            if (caller.ReferrerId is Guid rid && rid != callerUid && caller.HouseholdId is null)
            {
                var referrer = await db.Profiles.FindAsync(rid);
                var unitKey = WaitlistJoin.PhysicalHouseKey(placeholder.Suburb, placeholder.Address, placeholder.Street);
                var refHouse = referrer?.HouseholdId is Guid rhid
                    ? await db.Households.AsNoTracking().FirstOrDefaultAsync(h => h.Id == rhid)
                    : null;
                var refKey = refHouse is not null
                    ? WaitlistJoin.PhysicalHouseKey(refHouse.Suburb, refHouse.Address, refHouse.Street)
                    : null;
                var sameBuilding = refHouse is not null && (
                    (unitKey is not null && refKey is not null && string.Equals(unitKey, refKey, StringComparison.OrdinalIgnoreCase))
                    || (string.Equals((refHouse.Address ?? "").Trim(), (placeholder.Address ?? "").Trim(), StringComparison.OrdinalIgnoreCase)
                        && string.Equals((refHouse.Suburb ?? "").Trim(), (placeholder.Suburb ?? "").Trim(), StringComparison.OrdinalIgnoreCase)));
                if (referrer is null || referrer.ReferrerId == callerUid || sameBuilding)
                {
                    caller.ReferrerId = null;
                }
                // Referrals earn Good Sort Points only (0¢ cash signup bonus).
            }
            var isFirstHousehold = caller.HouseholdId is null;
            caller.HouseholdId ??= placeholder.Id;

            if (isFirstHousehold)
            {
                var orphans = await db.Scans
                    .Where(sc => sc.UserId == caller.Id && sc.HouseholdId == null && sc.Status == "pending")
                    .ToListAsync();
                ScanBackfill.AttachTo(placeholder, orphans);
            }
        }
        await db.SaveChangesAsync();
    }
    try
    {
        if (!string.IsNullOrWhiteSpace(caller?.Email))
            await notif.SendBuildingWaitlisted(caller.Email, caller.Name, placeholder, caller.Id);
    }
    catch (Exception)
    {
        // Building signup must succeed even if ACS is down.
    }
    return Results.Ok(new { waitlisted = true, id = placeholder.Id, suburb = placeholder.Suburb });
}).RequireAuthorization();

// ── Profiles ──
// Profile contains email + household address. Gate to owner or admin to avoid
// PII enumeration (anyone with an id could pull email/address before).
app.MapGet("/api/profiles/{id:guid}", async (HttpContext ctx, Guid id, GoodSortDbContext db) =>
{
    if (!ctx.IsOwnerOrAdmin(id)) return Results.Forbid();
    return await db.Profiles.Include(p => p.Household).FirstOrDefaultAsync(p => p.Id == id)
        is { } p ? Results.Ok(p) : Results.NotFound();
}).RequireAuthorization();

app.MapGet("/api/profiles/me/payout", async (HttpContext ctx, GoodSortDbContext db) =>
{
    var callerId = ctx.GetCallerId();
    if (callerId is null) return Results.Unauthorized();
    var p = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(x => x.Id == callerId.Value);
    if (p is null) return Results.NotFound();
    return Results.Ok(new
    {
        hasPayoutDetails = CashoutService.HasSavedPayout(p),
        preferredPayoutMethod = p.PreferredPayoutMethod,
        payIdType = p.PayIdType,
        payIdValue = p.PayIdValue,
        bankBsb = p.BankBsb,
        bankAccountNumber = p.BankAccountNumber,
        bankAccountName = p.BankAccountName,
        payoutUpdatedAt = p.PayoutUpdatedAt,
        householdId = p.HouseholdId,
        profileName = p.Name,
    });
}).RequireAuthorization();

app.MapPut("/api/profiles/me/payout", async (HttpContext ctx, PayoutDetailsUpdateRequest req, GoodSortDbContext db) =>
{
    var callerId = ctx.GetCallerId();
    if (callerId is null) return Results.Unauthorized();
    var p = await db.Profiles.FindAsync(callerId.Value);
    if (p is null) return Results.NotFound();

    var (valid, error, details) = CashoutService.ValidatePayoutDetails(
        req.Method, req.PayIdType, req.PayIdValue, req.Bsb, req.AccountNumber, req.AccountName);
    if (!valid || details is null)
        return Results.BadRequest(new { error });

    p.PreferredPayoutMethod = details.Method;
    p.PayIdType = details.PayIdType;
    p.PayIdValue = details.PayIdValue;
    p.BankBsb = details.BankBsb;
    p.BankAccountNumber = details.BankAccountNumber;
    p.BankAccountName = details.BankAccountName;
    p.PayoutUpdatedAt = DateTime.UtcNow;

    var cleanedMemberName = CashoutService.SanitizeSingleLine(req.MemberName);
    if (cleanedMemberName.Length > 128) cleanedMemberName = cleanedMemberName[..128].TrimEnd();
    if (!string.IsNullOrWhiteSpace(cleanedMemberName))
        p.Name = cleanedMemberName;
    else if (string.IsNullOrWhiteSpace(p.Name) || p.Name == "New User")
        p.Name = details.BankAccountName;

    await db.SaveChangesAsync();
    return Results.Ok(new
    {
        hasPayoutDetails = true,
        preferredPayoutMethod = p.PreferredPayoutMethod,
        payIdType = p.PayIdType,
        payIdValue = p.PayIdValue,
        bankBsb = p.BankBsb,
        bankAccountNumber = p.BankAccountNumber,
        bankAccountName = p.BankAccountName,
        payoutUpdatedAt = p.PayoutUpdatedAt,
        householdId = p.HouseholdId,
        profileName = p.Name,
    });
}).RequireAuthorization();

app.MapGet("/api/profiles/{id:guid}/network", async (HttpContext ctx, Guid id, GoodSortDbContext db) =>
{
    if (!ctx.IsOwnerOrAdmin(id)) return Results.Forbid();
    var referredRows = await db.Profiles.AsNoTracking()
        .Where(p => p.ReferrerId == id && p.Id != id)
        .Select(p => new
        {
            p.Name,
            p.TotalContainers,
            HasHousehold = p.HouseholdId != null,
            p.CreatedAt,
        })
        .OrderByDescending(p => p.TotalContainers)
        .ThenByDescending(p => p.CreatedAt)
        .ToListAsync();

    var referred = referredRows
        .Select(r => new
        {
            name = InvitePreview.PublicFirstName(r.Name, "A neighbour"),
            totalContainers = r.TotalContainers,
            hasHousehold = r.HasHousehold,
            createdAt = r.CreatedAt,
        })
        .ToList();

    var activeHouseholds = referredRows.Count(r => r.HasHousehold);
    var referredContainers = referredRows.Sum(r => r.TotalContainers);
    var signupBonusCents = 0;
    var containerCommissionCents = referredContainers * HouseholdCredit.ReferralCommissionCentsPerContainer;
    var signupBonusPoints = activeHouseholds * HouseholdCredit.ReferralSignupBonusPoints;
    var containerBonusPoints = referredContainers * HouseholdCredit.ReferralPointsPerContainer;

    return Results.Ok(new
    {
        sortersCount = referred.Count,
        activeHouseholds,
        referredContainers,
        commissionRateCents = HouseholdCredit.ReferralCommissionCentsPerContainer,
        signupBonusCents,
        containerCommissionCents,
        totalNetworkCents = signupBonusCents + containerCommissionCents,
        signupBonusPoints,
        containerBonusPoints,
        totalNetworkPoints = signupBonusPoints + containerBonusPoints,
        sorters = referred,
    });
}).RequireAuthorization();

app.MapPost("/api/profiles", async (HttpContext ctx, ProfileCreateRequest req, GoodSortDbContext db) =>
{
    // Self-create only — profile creation normally happens via /verify-otp.
    // Bind ProfileCreateRequest (Name only), NEVER the raw Profile entity:
    // deleting a profile via DELETE /api/profiles/{id} leaves the stateless JWT
    // valid, so binding Profile directly would let a caller re-create their own
    // row with arbitrary ClearedCents, PendingCents, or someone else's HouseholdId.
    var callerId = ctx.GetCallerId();
    if (callerId is null) return Results.Unauthorized();
    var existing = await db.Profiles.FindAsync(callerId.Value);
    if (existing is not null) return Results.Ok(existing);

    var profile = new Profile
    {
        Id = callerId.Value,
        Name = (req.Name ?? "").Trim(),
        IsAdmin = false,
        Role = "sorter",
        PendingCents = 0,
        ClearedCents = 0,
        TotalContainers = 0,
        TotalCo2SavedKg = 0,
    };
    db.Profiles.Add(profile);
    await db.SaveChangesAsync();
    return Results.Created($"/api/profiles/{profile.Id}", profile);
}).RequireAuthorization();

// ── Scans ──
app.MapPost("/api/scans", async (HttpContext ctx, ScanRequest req, GoodSortDbContext db, IConfiguration cfg, NotificationService notif, ILogger<Program> log) =>
{
    var userId = ctx.GetCallerId();
    if (userId is null) return Results.Unauthorized();

    var barcode = (req.Barcode ?? "").Trim();
    if (string.IsNullOrEmpty(barcode) || barcode.Length > 64)
        return Results.BadRequest(new { error = "Barcode must be between 1 and 64 characters." });
    var containerName = VisionService.NormalizeContainerName(req.ContainerName);
    var material = VisionService.MapMaterial(req.Material);

    return await StatusClaim.WithUserGateAsync(userId.Value, async () =>
    {
    var profile = await db.Profiles.FindAsync(userId.Value);
    if (profile is null) return Results.NotFound("User not found");

    // Daily ceiling per member, alongside the per-minute rate limit.
    //
    // This is mitigation, not prevention. Nothing here can prove a container
    // was physically scanned — the client supplies the barcode — so the honest
    // goal is to bound how much suburb volume one account can fabricate, since
    // volume is what sends a driver. The default is deliberately far above any
    // real household: 2000 containers is about $100 of refunds in a day.
    var scanCap = int.TryParse(cfg["SCAN_DAILY_CAP"], out var sc) ? sc : 2000;
    if (scanCap > 0)
    {
        var since = DateTime.UtcNow.AddHours(-24);
        var scansToday = await db.Scans.CountAsync(x => x.UserId == profile.Id && x.CreatedAt >= since);
        if (scansToday >= scanCap) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
    }

    // Launch bonus on a member's first N containers ever. Marketing spend with a
    // hard ceiling — not a change to the sorting-credit rate.
    var cents = LaunchBonus.CentsForContainerAt(profile.TotalContainers, LaunchBonus.CapFrom(cfg));

    var scan = new Scan
    {
        UserId = profile.Id,
        HouseholdId = profile.HouseholdId, // nullable — works without household
        Barcode = barcode, ContainerName = containerName,
        Material = material, RefundCents = cents, Status = "pending",
    };
    db.Scans.Add(scan);

    profile.PendingCents += cents;
    profile.TotalContainers += 1;
    profile.TotalCo2SavedKg += 0.035;

    // Update household stats if assigned
    var household = profile.HouseholdId.HasValue
        ? await db.Households.FindAsync(profile.HouseholdId)
        : null;
    if (household is not null)
    {
        household.PendingContainers += 1;
        household.PendingValueCents += cents;
        household.EstimatedWeightKg = household.PendingContainers * 0.020;
        household.EstimatedBags = (int)Math.Ceiling(household.PendingContainers / 150.0);
        household.LastScanAt = DateTime.UtcNow;

        household.Materials ??= new MaterialBreakdown();
        _ = material switch
        {
            "aluminium" => household.Materials.Aluminium++,
            "pet" or "pet_clear" or "pet_coloured" => household.Materials.Pet++,
            "glass" => household.Materials.Glass++,
            _ => household.Materials.Other++,
        };

        // Mirror onto the bin. Dispatch reads the BIN's counter, not the
        // household's — see BinCounter. Without this the scan never reaches
        // the number that decides whether a driver is sent.
        var bin = await db.Bins.FirstOrDefaultAsync(b => b.HouseholdId == household.Id);
        BinCounter.AddScan(bin, 1, cents, material);
    }

    await db.SaveChangesAsync();

    if (household is not null && !string.IsNullOrWhiteSpace(household.Suburb) && !WaitlistDensity.IsCommitted(household.BinStatus))
    {
        try
        {
            var board = WaitlistDensity.Aggregate(await WaitlistDensity.LoadRowsAsync(db));
            var cluster = WaitlistDensity.SuburbCluster(board, household.Suburb);
            if (cluster is not null
                && WaitlistDensity.ShouldAnnounceUnlock(cluster.Committed, cluster.Containers, 1))
            {
                var unlockDay = household.CouncilCollectionDay ?? cluster.BestDay ?? 0;
                await notif.SendAreaUnlocked(household.Suburb!, unlockDay, userId);
                await notif.SendOpsStreetReady(household.Suburb!, unlockDay);
            }
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Area-unlocked announcement failed for {Suburb} - barcode scan succeeded", household.Suburb);
        }
    }

    return Results.Ok(new
    {
        scan.Id,
        profile.PendingCents,
        profile.TotalContainers,
        creditedCents = cents,
        bonusApplied = cents > HouseholdCredit.CentsPerContainer,
        bonusRemaining = Math.Max(0, LaunchBonus.CapFrom(cfg) - profile.TotalContainers),
    });
    }, ctx.RequestAborted);
}).RequireAuthorization().RequireRateLimiting("scans");

app.MapGet("/api/scans", async (HttpContext ctx, Guid userId, int? limit, GoodSortDbContext db) =>
{
    // Owner or admin only — scans contain barcode + container history.
    if (!ctx.IsOwnerOrAdmin(userId)) return Results.Forbid();
    var safeLimit = Math.Clamp(limit ?? 20, 1, 200);
    return Results.Ok(await db.Scans.Where(s => s.UserId == userId)
        .OrderByDescending(s => s.CreatedAt).Take(safeLimit).ToListAsync());
}).RequireAuthorization();

// ── Routes (legacy pre-marketplace compatibility; disabled in non-Development unless LEGACY_ROUTES_ENABLED=true) ──
var legacyRoutes = app.MapGroup("");
legacyRoutes.AddEndpointFilter(async (efiCtx, next) =>
{
    if (!app.Environment.IsDevelopment()
        && !string.Equals(app.Configuration["LEGACY_ROUTES_ENABLED"], "true", StringComparison.OrdinalIgnoreCase))
    {
        return Results.NotFound();
    }
    return await next(efiCtx);
});

// RouteStop carries HouseholdName, the full street Address and exact Lat/Lng
// for every collection — and, with a pickup time attached, that is a schedule
// of which houses have bags at the kerb and when. This was anonymous. It
// returned nothing only because no run has been generated yet; the first real
// collection would have published every participating address to the internet.
legacyRoutes.MapGet("/api/routes", async (HttpContext ctx, string? status, GoodSortDbContext db) =>
{
    var callerId = ctx.GetCallerId();
    if (callerId is null) return Results.Unauthorized();
    var q = db.Routes.Include(r => r.Stops).AsQueryable();
    if (!ctx.IsAdmin()) q = q.Where(r => r.DriverId == callerId.Value);
    if (!string.IsNullOrEmpty(status)) q = q.Where(r => r.Status == status);
    return Results.Ok(await q.OrderByDescending(r => r.CreatedAt).ToListAsync());
}).RequireAuthorization();

// Same payload as the list above, for one route. Restricted to the route's driver or admin.
legacyRoutes.MapGet("/api/routes/{id:guid}", async (HttpContext ctx, Guid id, GoodSortDbContext db) =>
{
    var callerId = ctx.GetCallerId();
    if (callerId is null) return Results.Unauthorized();
    var r = await db.Routes.Include(x => x.Stops.OrderBy(s => s.Sequence)).Include(x => x.Depot)
        .FirstOrDefaultAsync(x => x.Id == id);
    if (r is null) return Results.NotFound();
    if (!ctx.IsAdmin() && r.DriverId != callerId.Value) return Results.Forbid();
    return Results.Ok(r);
}).RequireAuthorization();

legacyRoutes.MapPost("/api/routes/{id:guid}/claim", async (HttpContext ctx, Guid id, ClaimRequest req, GoodSortDbContext db) =>
{
    // Body DriverId is ignored — the claimer is the authenticated caller.
    // Trusting the body would let anyone assign a route to another user.
    var callerId = ctx.GetCallerId();
    if (callerId is null) return Results.Unauthorized();
    var route = await db.Routes
        .Include(r => r.Stops.OrderBy(s => s.Sequence))
        .Include(r => r.Depot)
        .FirstOrDefaultAsync(r => r.Id == id);
    if (route is null || route.Status != "pending") return Results.BadRequest("Not available");

    return await Atomic.RunAsync<IResult>(db, async () =>
    {
        if (!await StatusClaim.TryAssignDriverToRoute(db, route.Id, callerId.Value))
            return Results.BadRequest("Not available");

        route.Status = "claimed";
        route.DriverId = callerId.Value;
        route.ClaimedAt ??= DateTime.UtcNow;
        var profile = await db.Profiles.FindAsync(callerId.Value);
        if (profile is not null) profile.Role = "both";
        await db.SaveChangesAsync();
        return Results.Ok(route);
    });
}).RequireAuthorization();

legacyRoutes.MapPost("/api/routes/{id:guid}/start", async (HttpContext ctx, Guid id, GoodSortDbContext db) =>
{
    var route = await db.Routes
        .Include(r => r.Stops.OrderBy(s => s.Sequence))
        .Include(r => r.Depot)
        .FirstOrDefaultAsync(r => r.Id == id);
    if (route is null || route.Status != "claimed") return Results.BadRequest();
    if (route.DriverId != ctx.GetCallerId() && !ctx.IsAdmin()) return Results.Forbid();
    route.Status = "in_progress"; route.StartedAt = DateTime.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(route);
}).RequireAuthorization();

legacyRoutes.MapPost("/api/routes/{routeId:guid}/stops/{stopId:guid}/pickup",
    async (HttpContext ctx, Guid routeId, Guid stopId, PickupRequest req, GoodSortDbContext db) =>
{
    var route = await db.Routes
        .Include(r => r.Stops.OrderBy(s => s.Sequence))
        .Include(r => r.Depot)
        .FirstOrDefaultAsync(r => r.Id == routeId);
    if (route is null || route.Status != "in_progress") return Results.BadRequest();
    if (route.DriverId != ctx.GetCallerId() && !ctx.IsAdmin()) return Results.Forbid();
    var stop = route.Stops.FirstOrDefault(s => s.Id == stopId);
    if (stop is null || stop.Status != "pending") return Results.BadRequest();
    stop.Status = "picked_up"; stop.PickedUpAt = DateTime.UtcNow;
    stop.ActualContainerCount = Math.Clamp(req.ActualCount, 0, maxContainersPerStop);
    if (route.Stops.All(s => s.Status != "pending")) route.Status = "at_depot";
    await db.SaveChangesAsync();
    return Results.Ok(route);
}).RequireAuthorization();

legacyRoutes.MapPost("/api/routes/{routeId:guid}/stops/{stopId:guid}/skip",
    async (HttpContext ctx, Guid routeId, Guid stopId, GoodSortDbContext db) =>
{
    var route = await db.Routes
        .Include(r => r.Stops.OrderBy(s => s.Sequence))
        .Include(r => r.Depot)
        .FirstOrDefaultAsync(r => r.Id == routeId);
    if (route is null || route.Status != "in_progress") return Results.BadRequest();
    if (route.DriverId != ctx.GetCallerId() && !ctx.IsAdmin()) return Results.Forbid();
    var stop = route.Stops.FirstOrDefault(s => s.Id == stopId);
    if (stop is null || stop.Status != "pending") return Results.BadRequest();
    stop.Status = "skipped";
    if (route.Stops.All(s => s.Status != "pending")) route.Status = "at_depot";
    await db.SaveChangesAsync();
    return Results.Ok(route);
}).RequireAuthorization();

legacyRoutes.MapPost("/api/routes/{id:guid}/settle", async (HttpContext ctx, Guid id, GoodSortDbContext db, IConfiguration cfg) =>
{
    var route = await db.Routes.Include(r => r.Stops).Include(r => r.Depot)
        .FirstOrDefaultAsync(r => r.Id == id);
    if (route is null || route.Status != "at_depot") return Results.BadRequest();
    if (route.DriverId != ctx.GetCallerId() && !ctx.IsAdmin()) return Results.Forbid();

    // Claim the transition before crediting anyone. The check above is a
    // courtesy for a clear error message; it is not the guard. Two settles
    // arriving together both pass it, and everything below hands out money —
    // the driver's cash-out-eligible balance twice, and every household's
    // pending credit moved to cleared twice, which invents money that was
    // never scanned. A double-tap on a Settle button sends two requests.
    // The claim and the crediting it authorises must land together. The claim
    // commits on its own statement, so a failure after it would leave the route
    // marked settled with the driver unpaid and the households' credit still
    // pending — and unretryable, because the status guard then rejects it.
    // Settling twice overpays and can be reconciled; settling zero times owes
    // money with no way to reach it.
    return await Atomic.RunAsync(db, async () =>
    {
    if (!await StatusClaim.TryClaimRoute(db, route.Id, from: "at_depot", to: "settled"))
        return Results.BadRequest(new { error = "This route has already been settled." });

    var householdRateCents = CrpSettlement.ActiveHouseholdRateCents(cfg);
    var pickedUp = route.Stops.Where(s => s.Status == "picked_up").ToList();
    var totalCollected = pickedUp.Sum(s => s.ActualContainerCount ?? s.ContainerCount);
    var driverPayout = totalCollected * 5; // 5c per container, no base

    route.DriverPayoutCents = driverPayout;
    // Status and SettledAt were written by the claim above; mirror them onto
    // the tracked entity so the response body matches what is stored.
    route.Status = "settled"; route.SettledAt ??= DateTime.UtcNow;

    var creditedHouseholds = new List<Household>();
    foreach (var stop in pickedUp)
    {
        var hh = await db.Households.Include(h => h.Members).FirstOrDefaultAsync(h => h.Id == stop.HouseholdId);
        if (hh is null) continue;

        var bin = await db.Bins.FirstOrDefaultAsync(b => b.HouseholdId == hh.Id && b.Status == "active");
        var isFirstHouseholdPickup = bin is not null ? bin.LastCollectedAt is null : hh.LastPickupAt is null;

        var count = stop.ActualContainerCount ?? stop.ContainerCount;
        if (bin is not null)
        {
            bin.PendingContainers = Math.Max(0, bin.PendingContainers - count);
            bin.PendingValueCents = bin.PendingContainers * householdRateCents;
            bin.LastCollectedAt = DateTime.UtcNow;
            if (bin.PendingContainers == 0) bin.Materials = new MaterialBreakdown();
        }

        var pendingScans = await db.Scans
            .Where(s => s.HouseholdId == hh.Id && s.Status == "pending")
            .ToListAsync();
        var payees = hh.Members.ToList();
        foreach (var scan in pendingScans)
        {
            if (payees.Any(m => m.Id == scan.UserId)) continue;
            var extra = await db.Profiles.FindAsync(scan.UserId);
            if (extra is not null) payees.Add(extra);
        }
        HouseholdCredit.ApplyPickup(payees, pendingScans, count, householdRateCents);

        // Neighbour referrals earn Good Sort Points only (0¢ cash signup bonus, 0¢/can cash override).
        var referredMember = payees.FirstOrDefault(m => m.ReferrerId.HasValue && m.ReferrerId.Value != m.Id);
        if (referredMember?.ReferrerId is Guid referrerId && count > 0)
        {
            var commission = HouseholdCredit.ReferralCommissionForPickup(count);
            if (commission > 0)
            {
                var referrer = await db.Profiles.FindAsync(referrerId);
                if (referrer is not null)
                    referrer.ClearedCents += commission;
            }
        }

        hh.PendingContainers = Math.Max(0, hh.PendingContainers - count);
        hh.PendingValueCents = hh.PendingContainers * householdRateCents;
        hh.EstimatedBags = (int)Math.Ceiling(hh.PendingContainers / 150.0);
        if (hh.PendingContainers == 0) hh.Materials = new MaterialBreakdown();
        hh.LastPickupAt = DateTime.UtcNow;
        var hasRemainingKerbBags = await db.SortedBags.AnyAsync(b => b.HouseholdId == hh.Id && b.Status == "on_kerb");
        if (!hasRemainingKerbBags
            && (hh.BinIsOutAt is null || stop.PickedUpAt is null || hh.BinIsOutAt <= stop.PickedUpAt))
        {
            hh.BinIsOut = false;
            hh.BinIsOutAt = null;
        }
        creditedHouseholds.Add(hh);
    }

    if (route.DriverId.HasValue)
    {
        var driver = await db.Profiles.FindAsync(route.DriverId.Value);
        if (driver is not null)
        {
            driver.ClearedCents += driverPayout;
            db.Collections.Add(new Collection
            {
                UserId = driver.Id, RouteId = route.Id,
                StopCount = pickedUp.Count, TotalContainers = totalCollected,
                EarnedCents = driverPayout, DepotName = route.Depot?.Name,
            });
        }
    }

    await db.SaveChangesAsync();

    _ = Task.Run(async () =>
    {
        try
        {
            using var scope = app.Services.CreateScope();
            var notif = scope.ServiceProvider.GetRequiredService<NotificationService>();
            foreach (var hh in creditedHouseholds) await notif.SendPickupConfirmation(hh.Id);
        }
        catch (Exception ex) { app.Logger.LogError(ex, "Route post-pickup email burst failed"); }
    });

    return Results.Ok(new { route.Id, driverPayout, totalCollected });
    });
}).RequireAuthorization();

// ── Depots ──
app.MapGet("/api/depots", async (GoodSortDbContext db) =>
    Results.Ok(await db.Depots.ToListAsync()));

// ── Route Optimization (OSRM trip service — open source, no API key) ──
legacyRoutes.MapPost("/api/routes/{id:guid}/optimize", async (HttpContext ctx, Guid id, GoodSortDbContext db, IConfiguration config, IHttpClientFactory httpFactory) =>
{
    var route = await db.Routes.Include(r => r.Stops).Include(r => r.Depot).FirstOrDefaultAsync(r => r.Id == id);
    if (route is null) return Results.NotFound();
    if (route.DriverId != ctx.GetCallerId() && !ctx.IsAdmin()) return Results.Forbid();
    if (route.Status is not ("pending" or "claimed" or "in_progress"))
        return Results.BadRequest(new { error = "Only pending, claimed, or in-progress routes can be optimized." });

    var stops = route.Stops.OrderBy(s => s.Sequence).ToList();
    if (stops.Count < 2) return Results.Ok(new { optimized = false, reason = "Too few stops" });
    if (route.Depot is null) return Results.Ok(new { optimized = false, reason = "Route has no depot assigned" });

    // OSRM /trip/ solves the TSP across waypoints. We pin the first stop as
    // the source and the depot as the destination so the runner ends at the
    // dropoff. Public demo endpoint — fine for pilot scale; swap to a
    // self-hosted instance once volume grows.
    // Coordinates are lng,lat (OSRM convention).
    var coords = new List<string> { $"{stops[0].Lng:F6},{stops[0].Lat:F6}" };
    coords.AddRange(stops.Skip(1).Select(s => $"{s.Lng:F6},{s.Lat:F6}"));
    coords.Add($"{route.Depot.Lng:F6},{route.Depot.Lat:F6}");

    var osrmBase = (config["OSRM_URL"] ?? "https://router.project-osrm.org").TrimEnd('/');
    if (!Uri.TryCreate(osrmBase, UriKind.Absolute, out var osrmUri) || osrmUri.Scheme != Uri.UriSchemeHttps)
        return Results.Ok(new { optimized = false, reason = "OSRM endpoint unavailable" });
    var url = $"{osrmBase}/trip/v1/driving/{string.Join(';', coords)}?source=first&destination=last&roundtrip=false&overview=false";

    var client = httpFactory.CreateClient();
    System.Text.Json.JsonElement json;
    try
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ctx.RequestAborted);
        cts.CancelAfter(TimeSpan.FromSeconds(8));
        var res = await client.GetAsync(url, cts.Token);
        if (!res.IsSuccessStatusCode) return Results.Ok(new { optimized = false, reason = "OSRM call failed" });
        json = await res.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>(cancellationToken: cts.Token);
    }
    catch (Exception)
    {
        return Results.Ok(new { optimized = false, reason = "OSRM request timed out or failed" });
    }

    if (!json.TryGetProperty("code", out var codeEl) || codeEl.ValueKind != System.Text.Json.JsonValueKind.String || codeEl.GetString() != "Ok")
        return Results.Ok(new { optimized = false, reason = "OSRM did not return a valid trip" });

    if (!json.TryGetProperty("trips", out var trips) || trips.ValueKind != System.Text.Json.JsonValueKind.Array || trips.GetArrayLength() == 0)
        return Results.Ok(new { optimized = false, reason = "No trip returned" });
    var trip = trips[0];
    if (trip.TryGetProperty("duration", out var durEl) && durEl.ValueKind == System.Text.Json.JsonValueKind.Number)
        route.EstimatedDurationMin = (int)Math.Round(durEl.GetDouble() / 60);
    if (trip.TryGetProperty("distance", out var distEl) && distEl.ValueKind == System.Text.Json.JsonValueKind.Number)
        route.EstimatedDistanceKm = Math.Round(distEl.GetDouble() / 1000.0, 1);

    // waypoint_index gives each input coordinate's position in the optimized
    // trip. Input order was [stops[0], stops[1..n-1], depot]; we reorder only
    // the household stops (depot's optimized position is fixed by source/destination).
    if (json.TryGetProperty("waypoints", out var waypoints) && waypoints.ValueKind == System.Text.Json.JsonValueKind.Array)
    {
        for (int i = 0; i < stops.Count && i < waypoints.GetArrayLength(); i++)
        {
            if (waypoints[i].TryGetProperty("waypoint_index", out var wpIdx) && wpIdx.ValueKind == System.Text.Json.JsonValueKind.Number)
            {
                stops[i].Sequence = wpIdx.GetInt32();
            }
        }
    }

    await db.SaveChangesAsync();
    return Results.Ok(new { optimized = true, durationMin = route.EstimatedDurationMin, distanceKm = route.EstimatedDistanceKm });
}).RequireAuthorization();

// ── Cash-out (ABA BSB+Account & NPP PayID) ──
app.MapGet("/api/cashout/status", (CashoutService cashout) =>
    Results.Ok(new
    {
        open = cashout.PayoutsOpen(),
        payIdOpen = cashout.PayIdPayoutsOpen(),
        minCents = 2000,
        message = (cashout.PayoutsOpen() || cashout.PayIdPayoutsOpen())
            ? "PayID and bank transfers run weekly once you hit $20."
            : "Payouts are not open yet. Sorting credits stay on your account until bank transfers are live.",
    }));

app.MapPost("/api/cashout", async (HttpContext ctx, CashoutRequestDto req, CashoutService cashout) =>
{
    // Caller-supplied UserId in the body is ignored — JWT sub is the source of truth.
    // Without this, an authenticated user could drain anyone's cleared balance.
    var userId = ctx.GetCallerId();
    if (userId is null) return Results.Unauthorized();
    var (success, error) = await cashout.RequestCashout(userId.Value, req.AmountCents, req.Bsb, req.AccountNumber, req.AccountName);
    return success ? Results.Ok(new { success = true }) : Results.BadRequest(new { error });
}).RequireAuthorization();

app.MapPost("/api/cashout/payid", async (HttpContext ctx, PayIdCashoutRequestDto req, CashoutService cashout) =>
{
    var userId = ctx.GetCallerId();
    if (userId is null) return Results.Unauthorized();
    var (success, error) = await cashout.RequestPayIdCashout(
        userId.Value, req.AmountCents, req.PayIdType, req.PayIdValue, req.AccountName);
    return success ? Results.Ok(new { success = true }) : Results.BadRequest(new { error });
}).RequireAuthorization();

// ── Member: Cancel own pending cashout request back to ClearedCents (enables clean account deletion) ──
app.MapPost("/api/cashout/{id:guid}/cancel", async (HttpContext ctx, Guid id, GoodSortDbContext db) =>
{
    var callerId = ctx.GetCallerId();
    if (callerId is null) return Results.Unauthorized();
    var existing = await db.CashoutRequests.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id);
    if (existing is null) return Results.NotFound();
    if (existing.UserId != callerId.Value && !ctx.IsAdmin()) return Results.Forbid();

    return await Atomic.RunAsync(db, async () =>
    {
        if (!await StatusClaim.TryCancelCashout(db, id, allowProcessing: false))
            return Results.BadRequest(new { error = "Only pending cashout requests can be cancelled." });

        var user = await db.Profiles.FindAsync(existing.UserId);
        if (user is not null)
            user.ClearedCents += existing.AmountCents;
        await db.SaveChangesAsync();
        return Results.Ok(new { id = existing.Id, status = "cancelled", refundedCents = existing.AmountCents });
    });
}).RequireAuthorization();

// ── Admin: Generate ABA file (POST only — mutates pending -> processing and contains payee BSB+account) ──
static async Task<IResult> HandleAbaExport(CashoutService cashout)
{
    if (!cashout.PayoutsOpen()) return Results.Ok(new { message = "Payouts are not enabled. Set ABA_PAYOUTS_ENABLED plus a real remitter BSB/account/user id." });
    var aba = await cashout.GenerateAbaFile();
    if (string.IsNullOrEmpty(aba)) return Results.Ok(new { message = "No pending cashouts" });
    return Results.Text(aba, "text/plain");
}
app.MapPost("/api/admin/aba-export", HandleAbaExport).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Generate NPP PayID batch CSV (POST only — mutates pending -> processing and contains payee PayIDs) ──
static async Task<IResult> HandlePayIdExport(CashoutService cashout)
{
    if (!cashout.PayIdPayoutsOpen()) return Results.Ok(new { message = "PayID payouts are not enabled. Set PAYID_PAYOUTS_ENABLED=true or enable ABA payouts." });
    var csv = await cashout.GeneratePayIdCsv();
    if (string.IsNullOrEmpty(csv)) return Results.Ok(new { message = "No pending PayID cashouts" });
    return Results.Text(csv, "text/csv");
}
app.MapPost("/api/admin/payid-export", HandlePayIdExport).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Re-download an already-claimed ABA / PayID batch without re-claiming ──
app.MapGet("/api/admin/cashouts/batch/{batchId:guid}", async (Guid batchId, CashoutService cashout) =>
{
    var reexported = await cashout.ReexportBatchAsync(batchId);
    return reexported is { } r
        ? Results.Text(r.Content, r.ContentType)
        : Results.NotFound(new { error = "Batch not found orABA payouts closed." });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Mark a processing cashout (or whole batch) as paid ──
app.MapPost("/api/admin/cashouts/{id:guid}/mark-paid", async (Guid id, GoodSortDbContext db) =>
{
    var row = await db.CashoutRequests.FindAsync(id);
    if (row is null) return Results.NotFound();
    if (row.Status != "processing" && row.Status != "pending")
        return Results.BadRequest(new { error = $"Cannot mark cashout in status '{row.Status}' as paid." });
    row.Status = "paid";
    row.ProcessedAt ??= DateTime.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(new { row.Id, row.Status, row.BatchId, row.AmountCents });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Cancel/refund a pending or processing cashout back to user's ClearedCents ──
app.MapPost("/api/admin/cashouts/{id:guid}/refund", async (Guid id, GoodSortDbContext db) =>
{
    var existing = await db.CashoutRequests.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id);
    if (existing is null) return Results.NotFound();

    return await Atomic.RunAsync(db, async () =>
    {
        if (!await StatusClaim.TryCancelCashout(db, id, allowProcessing: true))
            return Results.BadRequest(new { error = $"Cannot refund cashout in status '{existing.Status}'." });

        var user = await db.Profiles.FindAsync(existing.UserId);
        if (user is not null)
            user.ClearedCents += existing.AmountCents;
        await db.SaveChangesAsync();
        return Results.Ok(new { id = existing.Id, status = "cancelled", refundedCents = existing.AmountCents });
    });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: COEX 17.68¢ Secondary-Sorted CRP Settlement Ledger ──
app.MapGet("/api/admin/crp-ledger", async (GoodSortDbContext db, CashoutService cashout, IConfiguration cfg) =>
{
    var crpActive = CrpSettlement.IsCrpActive(cfg);
    var rows = await db.RunSettlementLedgers.AsNoTracking()
        .OrderByDescending(l => l.CreatedAt)
        .Take(100)
        .ToListAsync();

    var allTotals = await db.RunSettlementLedgers.AsNoTracking()
        .GroupBy(_ => 1)
        .Select(g => new
        {
            SettledRuns = g.Count(),
            VerifiedContainers = g.Sum(x => x.VerifiedContainers),
            BagsVerified = g.Sum(x => x.BagsVerified),
            DiscrepancyStops = g.Sum(x => x.DiscrepancyStops),
            GrossBp = g.Sum(x => x.GrossRevenueBasisPoints),
            ProFormaGrossBp = g.Sum(x => x.ProFormaCoexGrossBasisPoints),
            HouseholdCents = g.Sum(x => x.HouseholdPayoutCents),
            MafiaCents = g.Sum(x => x.ContainerMafiaCents),
            RunnerCents = g.Sum(x => x.RunnerPayoutCents),
            TotalPayoutCents = g.Sum(x => x.TotalPayoutCents),
            NetMarginBp = g.Sum(x => x.NetMarginBasisPoints),
            ProFormaMarginBp = g.Sum(x => x.ProFormaCrpNetMarginBasisPoints),
        })
        .FirstOrDefaultAsync();

    var pendingCashouts = await db.CashoutRequests.AsNoTracking()
        .Where(c => c.Status == "pending")
        .Select(c => new { c.PayoutMethod, c.AmountCents })
        .ToListAsync();

    var pendingPayId = pendingCashouts.Where(c => c.PayoutMethod == "payid").ToList();
    var pendingAba = pendingCashouts.Where(c => c.PayoutMethod != "payid").ToList();

    var totalBags = await db.SortedBags.CountAsync(b => b.Status != "cancelled");
    var kerbBags = await db.SortedBags.CountAsync(b => b.Status == "on_kerb");

    return Results.Ok(new
    {
        crpActive,
        activeHouseholdRateCents = CrpSettlement.ActiveHouseholdRateCents(cfg),
        rateCard = new
        {
            coexRefundCents = 10.00m,
            coexHandlingFeeCents = 7.68m,
            coexGrossCents = 17.68m,
            sorterCents = CrpSettlement.CrpHouseholdCentsPerContainer,
            containerMafiaCents = CrpSettlement.ContainerMafiaCentsPerContainer,
            runnerTargetCents = CrpSettlement.CrpRunnerTargetCentsPerContainer,
            netMarginWithMafiaCents = 6.68m,
            netMarginDirectCents = 6.68m,
        },
        payouts = new
        {
            abaOpen = cashout.PayoutsOpen(),
            payIdOpen = cashout.PayIdPayoutsOpen(),
            pendingAbaCount = pendingAba.Count,
            pendingAbaCents = pendingAba.Sum(x => x.AmountCents),
            pendingPayIdCount = pendingPayId.Count,
            pendingPayIdCents = pendingPayId.Sum(x => x.AmountCents),
        },
        bags = new
        {
            totalSealed = totalBags,
            onKerb = kerbBags,
        },
        totals = new
        {
            settledRuns = allTotals?.SettledRuns ?? 0,
            verifiedContainers = allTotals?.VerifiedContainers ?? 0,
            bagsVerified = allTotals?.BagsVerified ?? 0,
            discrepancyStops = allTotals?.DiscrepancyStops ?? 0,
            grossRevenueDollars = CrpSettlement.BasisPointsToDollars(allTotals?.GrossBp ?? 0),
            proFormaCoexGrossDollars = CrpSettlement.BasisPointsToDollars(allTotals?.ProFormaGrossBp ?? 0),
            householdPayoutCents = allTotals?.HouseholdCents ?? 0,
            containerMafiaCents = allTotals?.MafiaCents ?? 0,
            runnerPayoutCents = allTotals?.RunnerCents ?? 0,
            totalPayoutCents = allTotals?.TotalPayoutCents ?? 0,
            netMarginDollars = CrpSettlement.BasisPointsToDollars(allTotals?.NetMarginBp ?? 0),
            proFormaCrpNetMarginDollars = CrpSettlement.BasisPointsToDollars(allTotals?.ProFormaMarginBp ?? 0),
        },
        entries = rows.Select(l => new
        {
            l.Id,
            l.RunId,
            l.AreaName,
            l.SettlementMode,
            l.CoexDocketRef,
            l.VerifiedContainers,
            l.BagsVerified,
            l.DiscrepancyStops,
            coexRefundDollars = CrpSettlement.BasisPointsToDollars(l.CoexRefundBasisPoints),
            coexHandlingFeeDollars = CrpSettlement.BasisPointsToDollars(l.CoexHandlingFeeBasisPoints),
            grossRevenueDollars = CrpSettlement.BasisPointsToDollars(l.GrossRevenueBasisPoints),
            proFormaCoexGrossDollars = CrpSettlement.BasisPointsToDollars(l.ProFormaCoexGrossBasisPoints),
            l.HouseholdPayoutCents,
            l.ContainerMafiaCents,
            l.RunnerPayoutCents,
            l.TotalPayoutCents,
            netMarginDollars = CrpSettlement.BasisPointsToDollars(l.NetMarginBasisPoints),
            netMarginCentsPerCan = CrpSettlement.BasisPointsToCentsPerCan(l.NetMarginBasisPoints, l.VerifiedContainers),
            proFormaCrpNetMarginDollars = CrpSettlement.BasisPointsToDollars(l.ProFormaCrpNetMarginBasisPoints),
            proFormaMarginCentsPerCan = CrpSettlement.BasisPointsToCentsPerCan(l.ProFormaCrpNetMarginBasisPoints, l.VerifiedContainers),
            l.CreatedAt,
        }),
    });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Dashboard stats (auth required) ──
app.MapGet("/api/admin/stats", async (GoodSortDbContext db, IConfiguration cfg) =>
{
    var users = await db.Profiles.CountAsync();
    var nonAdminUsers = await db.Profiles.CountAsync(p => !p.IsAdmin);
    var bins = await db.Bins.CountAsync();
    var scans = await db.Scans.CountAsync();
    // db.Routes is the CollectionRoute table, which nothing ever writes to —
    // see CLAUDE.md. Counting it told ops "Routes: 0" forever and showed
    // nothing about actual collection activity, which lives in db.Runs.
    var routes = await db.Routes.CountAsync();
    var runs = await db.Runs.CountAsync();
    var runsAvailable = await db.Runs.CountAsync(r => r.Status == "available");
    var runsInFlight = await db.Runs.CountAsync(r =>
        r.Status == "claimed" || r.Status == "in_progress" || r.Status == "delivering");
    var runsSettled = await db.Runs.CountAsync(r => r.Status == "settled");
    var totalContainers = await db.Profiles.SumAsync(p => p.TotalContainers);
    var totalPending = await db.Profiles.SumAsync(p => p.PendingCents);
    var totalCleared = await db.Profiles.SumAsync(p => p.ClearedCents);

    // Vision API call counter — for Vision cost and route telemetry
    var since30d = DateTime.UtcNow.AddDays(-30);
    var since7d = DateTime.UtcNow.AddDays(-7);
    var visionTotal = await db.VisionCalls.CountAsync();
    var visionLast30d = await db.VisionCalls.CountAsync(v => v.CreatedAt >= since30d);
    var visionLast7d = await db.VisionCalls.CountAsync(v => v.CreatedAt >= since7d);
    var visionTailor = await db.VisionCalls.CountAsync(v => v.Provider == "tailor" && v.Success);
    var visionPact = await db.VisionCalls.CountAsync(v => v.Provider == "pact" && v.Success);
    var visionOpenAi = await db.VisionCalls.CountAsync(v => v.Provider == "openai" && v.Success);
    var visionFailed = await db.VisionCalls.CountAsync(v => !v.Success);

    // Retention / activation
    var activatedUsers = await db.Profiles.CountAsync(p => p.TotalContainers > 0);
    var householdsWithAddress = await db.Households.CountAsync(h => h.Lat != 0 && h.Lng != 0);
    var runnersRegistered = await db.RunnerProfiles.CountAsync();
    var resetBaselineEnabled = string.Equals(cfg["RESET_BASELINE_ENABLED"], "true", StringComparison.OrdinalIgnoreCase);

    return Results.Ok(new
    {
        users, nonAdminUsers, bins, scans, routes, totalContainers, totalPending, totalCleared,
        runs, runsAvailable, runsInFlight, runsSettled, resetBaselineEnabled,
        activation = new
        {
            activatedUsers,
            activationPct = users > 0 ? Math.Round(100.0 * activatedUsers / users, 1) : 0,
            householdsWithAddress,
            runnersRegistered,
        },
        vision = new
        {
            total = visionTotal,
            last30d = visionLast30d,
            last7d = visionLast7d,
            tailor = visionTailor,
            pact = visionPact,
            openai = visionOpenAi,
            failed = visionFailed,
        },
    });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Vision provider health & latency telemetry ──
app.MapGet("/api/admin/vision/health", async (GoodSortDbContext db, IConfiguration cfg) =>
{
    var sinceHour = DateTime.UtcNow.AddHours(-1);
    var sinceDay = DateTime.UtcNow.AddDays(-1);

    var hourCalls = await db.VisionCalls.Where(v => v.CreatedAt >= sinceHour).ToListAsync();
    var dayTotals = await db.VisionCalls.Where(v => v.CreatedAt >= sinceDay)
        .GroupBy(v => new { v.Provider, v.Success })
        .Select(g => new { g.Key.Provider, g.Key.Success, Count = g.Count() })
        .ToListAsync();

    var lastTailorOk = await db.VisionCalls
        .Where(v => (v.Provider == "tailor" || v.Provider == "pact" || v.Provider == "openai") && v.Success)
        .OrderByDescending(v => v.CreatedAt)
        .Select(v => (DateTime?)v.CreatedAt)
        .FirstOrDefaultAsync();

    var lastTailorFail = await db.VisionCalls
        .Where(v => (v.Provider == "tailor" || v.Provider == "pact" || v.Provider == "openai") && !v.Success)
        .OrderByDescending(v => v.CreatedAt)
        .Select(v => new { v.CreatedAt, v.ErrorSummary })
        .FirstOrDefaultAsync();

    var tailorOkDurations = hourCalls
        .Where(v => (v.Provider == "tailor" || v.Provider == "pact" || v.Provider == "openai") && v.Success)
        .Select(v => v.DurationMs)
        .ToList();
    var avgDurationMs = tailorOkDurations.Count > 0
        ? (int)tailorOkDurations.Average()
        : 0;

    int Cnt(string provider, bool success) =>
        dayTotals.Where(t => t.Provider == provider && t.Success == success).Sum(t => t.Count);

    var tailorOk24h = Cnt("tailor", true);
    var tailorFail24h = Cnt("tailor", false);
    var pactOk24h = Cnt("pact", true);
    var pactFail24h = Cnt("pact", false);
    var openaiOk24h = Cnt("openai", true);
    var openaiFail24h = Cnt("openai", false);
    var sovrgnOk24h = Cnt("sovrgn", true);
    // Denominator covers ALL provider attempts in last 24h to avoid NaN when
    // every call failed.
    var totalAttempts24h = tailorOk24h + tailorFail24h + pactOk24h + pactFail24h + openaiOk24h + openaiFail24h + sovrgnOk24h;
    var fallbackPct24h = totalAttempts24h > 0
        ? Math.Round(100.0 * (openaiOk24h + sovrgnOk24h) / totalAttempts24h, 1)
        : 0;

    var pactConfigured = VisionService.IsPactConfigured(cfg);
    var openAiConfigured = !string.IsNullOrEmpty(cfg["AZURE_OPENAI_ENDPOINT"]) && !string.IsNullOrEmpty(cfg["AZURE_OPENAI_KEY"]);
    var keyConfigured = !string.IsNullOrEmpty(cfg["TAILOR_VISION_API_KEY"])
        || pactConfigured
        || openAiConfigured;

    var azureOpenAiDeployment = string.IsNullOrWhiteSpace(cfg["AZURE_OPENAI_DEPLOYMENT"])
        ? VisionDefaults.OpenAiDeployment
        : cfg["AZURE_OPENAI_DEPLOYMENT"]!.Trim();

    // Coarse health verdict: green if we've had a vision success in the last hour,
    // amber if a provider is configured but no recent success, red if none configured.
    var verdict = !keyConfigured
        ? "red:no-key"
        : (lastTailorOk.HasValue && lastTailorOk.Value >= sinceHour)
            ? "green"
            : (lastTailorOk.HasValue ? "amber:stale" : "amber:never-succeeded");

    return Results.Ok(new
    {
        verdict,
        keyConfigured,
        pactConfigured,
        azureOpenAiDeployment,
        imageDetail = VisionService.ResolveImageDetail(cfg["VISION_IMAGE_DETAIL"]),
        lastTailorSuccess = lastTailorOk,
        lastTailorFailure = lastTailorFail,
        last24h = new
        {
            tailorOk = tailorOk24h,
            tailorFailed = tailorFail24h,
            pactOk = pactOk24h,
            pactFailed = pactFail24h,
            openaiFallback = openaiOk24h,
            openaiFailed = openaiFail24h,
            sovrgnFallback = sovrgnOk24h,
            fallbackPct = fallbackPct24h,
        },
        lastHour = new
        {
            calls = hourCalls.Count,
            tailorSuccess = hourCalls.Count(v => v.Provider == "tailor" && v.Success),
            tailorFailure = hourCalls.Count(v => v.Provider == "tailor" && !v.Success),
            pactSuccess = hourCalls.Count(v => v.Provider == "pact" && v.Success),
            pactFailure = hourCalls.Count(v => v.Provider == "pact" && !v.Success),
            openaiSuccess = hourCalls.Count(v => v.Provider == "openai" && v.Success),
            openaiFailure = hourCalls.Count(v => v.Provider == "openai" && !v.Success),
            avgTailorDurationMs = avgDurationMs,
        },
    });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Enriched User CRM list with search, suburb/status filters, and activity metrics (admin only — PII) ──
app.MapGet("/api/admin/users", async (string? q, string? suburb, string? filter, int? limit, GoodSortDbContext db) =>
{
    var maxRows = Math.Clamp(limit ?? 500, 1, 2000);
    var cutoff7d = DateTime.UtcNow.AddDays(-7);

    var profiles = await db.Profiles
        .AsNoTracking()
        .Include(p => p.Household)
        .OrderByDescending(p => p.CreatedAt)
        .ToListAsync();

    var scanStats = await db.Scans
        .AsNoTracking()
        .GroupBy(s => s.UserId)
        .Select(g => new
        {
            UserId = g.Key,
            LastScanAt = g.Max(s => s.CreatedAt),
            Scans7d = g.Count(s => s.CreatedAt >= cutoff7d),
            TotalScans = g.Count(),
        })
        .ToDictionaryAsync(x => x.UserId);

    var bagStatsByHousehold = await db.SortedBags
        .AsNoTracking()
        .Where(b => b.Status != "cancelled")
        .GroupBy(b => b.HouseholdId)
        .Select(g => new
        {
            HouseholdId = g.Key,
            TotalBags = g.Count(),
            OnKerbBags = g.Count(b => b.Status == "on_kerb"),
        })
        .ToDictionaryAsync(x => x.HouseholdId);

    var runnerProfileIds = await db.RunnerProfiles
        .AsNoTracking()
        .Select(r => r.ProfileId)
        .ToHashSetAsync();

    var profileLookup = profiles.ToDictionary(p => p.Id);
    var referralsByReferrer = profiles
        .Where(p => p.ReferrerId.HasValue && p.ReferrerId.Value != p.Id)
        .GroupBy(p => p.ReferrerId!.Value)
        .ToDictionary(
            g => g.Key,
            g => new
            {
                Count = g.Count(),
                ActiveCount = g.Count(x => x.HouseholdId != null),
                ReferredContainers = g.Sum(x => x.TotalContainers),
            });

    var canonicalSuburbFilter = string.IsNullOrWhiteSpace(suburb)
        ? null
        : BinDayService.CanonicalSuburb(suburb);
    var needle = q?.Trim();
    var filterKey = filter?.Trim().ToLowerInvariant() ?? "all";

    var enriched = profiles.Select(p =>
    {
        var canonicalSuburb = BinDayService.CanonicalSuburb(p.Household?.Suburb);
        var hasAddress = p.Household is not null && !string.IsNullOrWhiteSpace(p.Household.Address) && canonicalSuburb is not null;
        var hasPayoutDetails = !string.IsNullOrWhiteSpace(p.PayIdValue)
            || (!string.IsNullOrWhiteSpace(p.BankBsb) && !string.IsNullOrWhiteSpace(p.BankAccountNumber));
        scanStats.TryGetValue(p.Id, out var scanInfo);
        var hasBags = p.HouseholdId.HasValue && bagStatsByHousehold.TryGetValue(p.HouseholdId.Value, out var bagInfo)
            ? bagInfo
            : null;
        referralsByReferrer.TryGetValue(p.Id, out var refStats);
        var referrer = p.ReferrerId.HasValue && profileLookup.TryGetValue(p.ReferrerId.Value, out var rp) ? rp : null;
        var isRunner = runnerProfileIds.Contains(p.Id) || p.Role is "driver" or "both";

        var statusTag = p.IsAdmin
            ? "admin"
            : !hasAddress
                ? "needs_address"
                : p.TotalContainers == 0
                    ? "no_scans"
                    : !hasPayoutDetails
                        ? "needs_payout"
                        : "active";

        return new
        {
            id = p.Id,
            email = p.Email,
            name = p.Name,
            role = p.Role,
            isAdmin = p.IsAdmin,
            isRunner,
            totalContainers = p.TotalContainers,
            pendingCents = p.PendingCents,
            clearedCents = p.ClearedCents,
            createdAt = p.CreatedAt,
            lastScanAt = scanInfo?.LastScanAt,
            scansLast7d = scanInfo?.Scans7d ?? 0,
            scanCount = scanInfo?.TotalScans ?? 0,
            suburb = canonicalSuburb,
            hasAddress,
            hasPayoutDetails,
            preferredPayoutMethod = p.PreferredPayoutMethod,
            bagsCount = hasBags?.TotalBags ?? 0,
            bagsOnKerbCount = hasBags?.OnKerbBags ?? 0,
            referrerId = p.ReferrerId,
            referrerLabel = referrer is not null ? (referrer.Email ?? referrer.Name) : null,
            referralsCount = refStats?.Count ?? 0,
            networkPoints = HouseholdCredit.ReferralPointsForNetwork(refStats?.ActiveCount ?? 0, refStats?.ReferredContainers ?? 0),
            statusTag,
            household = p.Household is null ? null : new
            {
                id = p.Household.Id,
                name = p.Household.Name,
                address = p.Household.Address,
                suburb = p.Household.Suburb,
                type = p.Household.Type,
                binStatus = p.Household.BinStatus,
                binIsOut = p.Household.BinIsOut,
                lat = p.Household.Lat,
                lng = p.Household.Lng,
                pendingContainers = p.Household.PendingContainers,
                pendingValueCents = p.Household.PendingValueCents,
            },
        };
    });

    if (!string.IsNullOrWhiteSpace(needle))
    {
        enriched = enriched.Where(u =>
            (u.email?.Contains(needle, StringComparison.OrdinalIgnoreCase) ?? false)
            || (u.name?.Contains(needle, StringComparison.OrdinalIgnoreCase) ?? false)
            || (u.suburb?.Contains(needle, StringComparison.OrdinalIgnoreCase) ?? false)
            || (u.household?.address?.Contains(needle, StringComparison.OrdinalIgnoreCase) ?? false)
            || (u.referrerLabel?.Contains(needle, StringComparison.OrdinalIgnoreCase) ?? false));
    }

    if (canonicalSuburbFilter is not null)
    {
        enriched = enriched.Where(u => string.Equals(u.suburb, canonicalSuburbFilter, StringComparison.OrdinalIgnoreCase));
    }

    enriched = filterKey switch
    {
        "no_address" => enriched.Where(u => !u.hasAddress && !u.isAdmin),
        "no_payout" => enriched.Where(u => !u.hasPayoutDetails && !u.isAdmin),
        "zero_scans" => enriched.Where(u => u.totalContainers == 0 && !u.isAdmin),
        "active_7d" => enriched.Where(u => u.scansLast7d > 0),
        "referred" => enriched.Where(u => u.referrerId != null || u.referralsCount > 0),
        "runners" => enriched.Where(u => u.isRunner),
        "admins" => enriched.Where(u => u.isAdmin),
        _ => enriched,
    };

    return Results.Ok(enriched.Take(maxRows).ToList());
})
    .RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Single-user CRM drill-down (scans, bags, referrals, payout readiness, cashouts, syndicate) ──
app.MapGet("/api/admin/users/{id:guid}", async (Guid id, GoodSortDbContext db) =>
{
    var profile = await db.Profiles
        .AsNoTracking()
        .Include(p => p.Household)
        .FirstOrDefaultAsync(p => p.Id == id);
    if (profile is null) return Results.NotFound();

    var recentScans = await db.Scans
        .AsNoTracking()
        .Where(s => s.UserId == id)
        .OrderByDescending(s => s.CreatedAt)
        .Take(50)
        .Select(s => new
        {
            id = s.Id,
            containerName = s.ContainerName,
            material = s.Material,
            barcode = s.Barcode,
            refundCents = s.RefundCents,
            status = s.Status,
            sortedBagId = s.SortedBagId,
            createdAt = s.CreatedAt,
        })
        .ToListAsync();

    var materialCounts = await db.Scans
        .AsNoTracking()
        .Where(s => s.UserId == id)
        .GroupBy(s => s.Material)
        .Select(g => new { material = g.Key, count = g.Count() })
        .ToListAsync();

    var bags = profile.HouseholdId.HasValue
        ? await db.SortedBags
            .AsNoTracking()
            .Where(b => b.HouseholdId == profile.HouseholdId.Value)
            .OrderByDescending(b => b.CreatedAt)
            .Take(30)
            .Select(b => new
            {
                id = b.Id,
                code = b.Code,
                stream = b.Stream,
                declaredContainers = b.DeclaredContainers,
                linkedScanCount = b.LinkedScanCount,
                verifiedContainers = b.VerifiedContainers,
                status = b.Status,
                createdAt = b.CreatedAt,
            })
            .ToListAsync()
        : [];

    var cashouts = await db.CashoutRequests
        .AsNoTracking()
        .Where(c => c.UserId == id)
        .OrderByDescending(c => c.CreatedAt)
        .Take(20)
        .Select(c => new
        {
            id = c.Id,
            amountCents = c.AmountCents,
            payoutMethod = c.PayoutMethod,
            status = c.Status,
            createdAt = c.CreatedAt,
        })
        .ToListAsync();

    var referrer = profile.ReferrerId.HasValue
        ? await db.Profiles
            .AsNoTracking()
            .Where(p => p.Id == profile.ReferrerId.Value)
            .Select(p => new { id = p.Id, name = p.Name, email = p.Email })
            .FirstOrDefaultAsync()
        : null;

    var referrals = await db.Profiles
        .AsNoTracking()
        .Include(p => p.Household)
        .Where(p => p.ReferrerId == id && p.Id != id)
        .OrderByDescending(p => p.CreatedAt)
        .Take(50)
        .Select(p => new
        {
            id = p.Id,
            name = p.Name,
            email = p.Email,
            suburb = p.Household != null ? p.Household.Suburb : null,
            totalContainers = p.TotalContainers,
            createdAt = p.CreatedAt,
        })
        .ToListAsync();

    var syndicateMembership = await db.BuildingSyndicateMembers
        .AsNoTracking()
        .Include(m => m.Syndicate)
        .Where(m => m.ProfileId == id)
        .Select(m => new
        {
            syndicateId = m.SyndicateId,
            buildingName = m.Syndicate.DisplayName,
            suburb = m.Syndicate.Suburb,
            anonHandle = m.AnonHandle,
            role = m.Role,
            status = m.Status,
        })
        .FirstOrDefaultAsync();

    var maskedAccount = !string.IsNullOrWhiteSpace(profile.BankAccountNumber)
        ? (profile.BankAccountNumber.Length > 4
            ? new string('*', profile.BankAccountNumber.Length - 4) + profile.BankAccountNumber[^4..]
            : "****")
        : null;

    var hasPayoutDetails = !string.IsNullOrWhiteSpace(profile.PayIdValue)
        || (!string.IsNullOrWhiteSpace(profile.BankBsb) && !string.IsNullOrWhiteSpace(profile.BankAccountNumber));

    return Results.Ok(new
    {
        id = profile.Id,
        name = profile.Name,
        email = profile.Email,
        role = profile.Role,
        isAdmin = profile.IsAdmin,
        totalContainers = profile.TotalContainers,
        pendingCents = profile.PendingCents,
        clearedCents = profile.ClearedCents,
        totalCo2SavedKg = profile.TotalCo2SavedKg,
        createdAt = profile.CreatedAt,
        lastScanAt = recentScans.FirstOrDefault()?.createdAt,
        household = profile.Household is null ? null : new
        {
            id = profile.Household.Id,
            name = profile.Household.Name,
            address = profile.Household.Address,
            suburb = BinDayService.CanonicalSuburb(profile.Household.Suburb) ?? profile.Household.Suburb,
            type = profile.Household.Type,
            binStatus = profile.Household.BinStatus,
            binIsOut = profile.Household.BinIsOut,
            councilCollectionDay = profile.Household.CouncilCollectionDay,
            lat = profile.Household.Lat,
            lng = profile.Household.Lng,
            pendingContainers = profile.Household.PendingContainers,
            pendingValueCents = profile.Household.PendingValueCents,
        },
        payout = new
        {
            hasPayoutDetails,
            preferredPayoutMethod = profile.PreferredPayoutMethod,
            payIdType = profile.PayIdType,
            payIdValue = profile.PayIdValue,
            bankBsb = profile.BankBsb,
            bankAccountMasked = maskedAccount,
            bankAccountName = profile.BankAccountName,
            payoutUpdatedAt = profile.PayoutUpdatedAt,
        },
        referrer,
        referrals,
        materialCounts,
        recentScans,
        bags,
        cashouts,
        syndicate = syndicateMembership,
    });
})
    .RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Live chronological activity feed (signups, scans, bags, cashouts) ──
app.MapGet("/api/admin/activity", async (int? limit, GoodSortDbContext db) =>
{
    var take = Math.Clamp(limit ?? 30, 1, 100);
    var perKind = Math.Min(take, 40);

    var recentUsers = await db.Profiles
        .AsNoTracking()
        .Include(p => p.Household)
        .OrderByDescending(p => p.CreatedAt)
        .Take(perKind)
        .ToListAsync();

    var recentScans = await db.Scans
        .AsNoTracking()
        .Include(s => s.User).ThenInclude(u => u.Household)
        .OrderByDescending(s => s.CreatedAt)
        .Take(perKind)
        .ToListAsync();

    var recentBags = await db.SortedBags
        .AsNoTracking()
        .Include(b => b.Household)
        .OrderByDescending(b => b.CreatedAt)
        .Take(perKind)
        .ToListAsync();

    var recentCashouts = await db.CashoutRequests
        .AsNoTracking()
        .Include(c => c.User).ThenInclude(u => u.Household)
        .OrderByDescending(c => c.CreatedAt)
        .Take(perKind)
        .ToListAsync();

    var bagCreatorIds = recentBags.Select(b => b.CreatorProfileId).Distinct().ToList();
    var bagCreators = bagCreatorIds.Count == 0
        ? new Dictionary<Guid, (string Name, string? Email)>()
        : await db.Profiles
            .AsNoTracking()
            .Where(p => bagCreatorIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => (p.Name, p.Email));

    var feed = new List<(DateTime Timestamp, object Item)>();

    foreach (var u in recentUsers)
    {
        var suburb = BinDayService.CanonicalSuburb(u.Household?.Suburb);
        var missingAddress = u.Household is null || suburb is null;
        feed.Add((u.CreatedAt, new
        {
            id = $"signup-{u.Id}",
            kind = "signup",
            timestamp = u.CreatedAt,
            userId = (Guid?)u.Id,
            userEmail = u.Email,
            userName = u.Name,
            suburb,
            summary = missingAddress
                ? "Signed up (address still missing)"
                : $"Joined in {suburb}",
            badge = u.ReferrerId.HasValue ? "Referred" : (missingAddress ? "Needs address" : "Joined"),
        }));
    }

    foreach (var s in recentScans)
    {
        var suburb = BinDayService.CanonicalSuburb(s.User?.Household?.Suburb);
        var label = string.IsNullOrWhiteSpace(s.ContainerName) ? "Eligible container" : s.ContainerName;
        feed.Add((s.CreatedAt, new
        {
            id = $"scan-{s.Id}",
            kind = "scan",
            timestamp = s.CreatedAt,
            userId = (Guid?)s.UserId,
            userEmail = s.User?.Email,
            userName = s.User?.Name ?? "Sorter",
            suburb,
            summary = $"Scanned {label} ({s.Material}) · +{s.RefundCents}¢",
            badge = s.Material,
        }));
    }

    foreach (var b in recentBags)
    {
        var suburb = BinDayService.CanonicalSuburb(b.Household?.Suburb);
        bagCreators.TryGetValue(b.CreatorProfileId, out var creator);
        feed.Add((b.CreatedAt, new
        {
            id = $"bag-{b.Id}",
            kind = "bag",
            timestamp = b.CreatedAt,
            userId = b.CreatorProfileId != Guid.Empty ? (Guid?)b.CreatorProfileId : null,
            userEmail = creator.Email,
            userName = string.IsNullOrWhiteSpace(creator.Name) ? (b.Household?.Name ?? "Household") : creator.Name,
            suburb,
            summary = $"Tagged bag {b.Code} ({b.Stream}, {b.DeclaredContainers} cans) — {b.Status}",
            badge = b.Status,
        }));
    }

    foreach (var c in recentCashouts)
    {
        var suburb = BinDayService.CanonicalSuburb(c.User?.Household?.Suburb);
        feed.Add((c.CreatedAt, new
        {
            id = $"cashout-{c.Id}",
            kind = "cashout",
            timestamp = c.CreatedAt,
            userId = (Guid?)c.UserId,
            userEmail = c.User?.Email,
            userName = c.User?.Name ?? "Member",
            suburb,
            summary = $"Requested ${(c.AmountCents / 100.0):0.00} cashout via {c.PayoutMethod}",
            badge = c.Status,
        }));
    }

    var ordered = feed
        .OrderByDescending(x => x.Timestamp)
        .Take(take)
        .Select(x => x.Item)
        .ToList();

    return Results.Ok(new { items = ordered });
})
    .RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Real-Time Interactions Radar (/admin/live) — unified stream, pulse KPIs & per-tester journeys ──
app.MapGet("/api/admin/live-feed", async (int? minutes, int? limit, GoodSortDbContext db) =>
{
    var now = DateTime.UtcNow;
    var windowMinutes = Math.Clamp(minutes ?? 120, 5, 1440);
    var maxItems = Math.Clamp(limit ?? 150, 20, 300);
    var since = now.AddMinutes(-windowMinutes);
    var since15m = now.AddMinutes(-15);
    var since5m = now.AddMinutes(-5);
    const string syntheticGuardEmail = "acs-guard@thegoodsort.org";

    var growthEvents = await db.GrowthEvents
        .AsNoTracking()
        .Where(e => e.CreatedAt >= since)
        .OrderByDescending(e => e.CreatedAt)
        .Take(400)
        .ToListAsync();

    var otpCodes = await db.OtpCodes
        .AsNoTracking()
        .Where(o => o.CreatedAt >= since && o.Email != syntheticGuardEmail)
        .OrderByDescending(o => o.CreatedAt)
        .Take(200)
        .ToListAsync();

    var recentProfiles = await db.Profiles
        .AsNoTracking()
        .Include(p => p.Household)
        .Where(p => !p.IsAdmin)
        .OrderByDescending(p => p.CreatedAt)
        .Take(60)
        .ToListAsync();

    var profileById = recentProfiles.ToDictionary(p => p.Id);
    var profileByEmail = recentProfiles
        .Where(p => !string.IsNullOrWhiteSpace(p.Email))
        .GroupBy(p => p.Email!.Trim().ToLowerInvariant())
        .ToDictionary(g => g.Key, g => g.First());

    var visionCalls = await db.VisionCalls
        .AsNoTracking()
        .Where(v => v.CreatedAt >= since)
        .OrderByDescending(v => v.CreatedAt)
        .Take(200)
        .ToListAsync();

    var scans = await db.Scans
        .AsNoTracking()
        .Include(s => s.User)
            .ThenInclude(u => u!.Household)
        .Where(s => s.CreatedAt >= since)
        .OrderByDescending(s => s.CreatedAt)
        .Take(200)
        .ToListAsync();

    var households = await db.Households
        .AsNoTracking()
        .Where(h => h.CreatedAt >= since)
        .OrderByDescending(h => h.CreatedAt)
        .Take(100)
        .ToListAsync();

    var bags = await db.SortedBags
        .AsNoTracking()
        .Include(b => b.Household)
        .Where(b => b.CreatedAt >= since)
        .OrderByDescending(b => b.CreatedAt)
        .Take(100)
        .ToListAsync();

    var cashouts = await db.CashoutRequests
        .AsNoTracking()
        .Include(c => c.User)
            .ThenInclude(u => u!.Household)
        .Where(c => c.CreatedAt >= since)
        .OrderByDescending(c => c.CreatedAt)
        .Take(100)
        .ToListAsync();

    // Also pull historical recent scans & vision calls for our top 25 testers so their journey cards stay rich across windows.
    var topTesterIds = recentProfiles.Take(25).Select(p => p.Id).ToList();
    var testerRecentScans = topTesterIds.Count == 0
        ? new List<Scan>()
        : await db.Scans
            .AsNoTracking()
            .Where(s => topTesterIds.Contains(s.UserId))
            .OrderByDescending(s => s.CreatedAt)
            .Take(250)
            .ToListAsync();
    var testerRecentVision = topTesterIds.Count == 0
        ? new List<VisionCall>()
        : await db.VisionCalls
            .AsNoTracking()
            .Where(v => v.UserId.HasValue && topTesterIds.Contains(v.UserId.Value))
            .OrderByDescending(v => v.CreatedAt)
            .Take(200)
            .ToListAsync();
    var testerRecentBags = topTesterIds.Count == 0
        ? new List<SortedBag>()
        : await db.SortedBags
            .AsNoTracking()
            .Where(b => topTesterIds.Contains(b.CreatorProfileId) && b.Status != "cancelled")
            .OrderByDescending(b => b.CreatedAt)
            .Take(100)
            .ToListAsync();
    var testerOtps = await db.OtpCodes
        .AsNoTracking()
        .Where(o => o.Email != syntheticGuardEmail)
        .OrderByDescending(o => o.CreatedAt)
        .Take(150)
        .ToListAsync();

    // ── Build unified live stream ──
    var stream = new List<(DateTime Ts, object Item)>();

    static (string Kind, string Severity, string Title) DescribeGrowthEvent(string name) => name switch
    {
        "landing_viewed" => ("page", "info", "Viewed homepage"),
        "suburb_page_viewed" => ("page", "info", "Viewed suburb page"),
        "map_viewed" => ("page", "info", "Opened Brisbane map"),
        "sort_dashboard_viewed" => ("page", "info", "Opened /sort dashboard"),
        "onboard_viewed" => ("page", "info", "Opened address onboarding"),
        "waitlist_cta" => ("cta", "info", "Tapped primary CTA"),
        "suburb_picked" => ("cta", "info", "Picked suburb"),
        "bin_day_looked_up" => ("cta", "info", "Looked up bin day"),
        "scan_camera_opened" => ("camera", "info", "Opened scanner camera"),
        "camera_denied" => ("error", "error", "Camera permission denied"),
        "scan_captured" => ("camera", "info", "Captured container"),
        "scan_vision_ok" => ("vision", "success", "AI identified container"),
        "scan_vision_empty" => ("vision", "warn", "AI found 0 containers"),
        "scan_vision_error" => ("error", "error", "Photo scan API error"),
        "scan_barcode_ok" => ("scan", "success", "Barcode scan matched"),
        "scan_credited" => ("scan", "success", "Scan credited"),
        "first_scan_credited" => ("scan", "success", "First scan activated!"),
        "otp_sent" => ("otp", "info", "Requested login code"),
        "otp_verified" => ("otp", "success", "Verified login code"),
        "household_joined" => ("household", "success", "Saved home address"),
        "payout_details_saved" => ("household", "success", "Saved PayID / bank details"),
        "bag_tagged" => ("bag", "success", "Tagged home bag"),
        "flyer_printed" => ("cta", "info", "Opened printable flyer"),
        "invite_whatsapp" => ("cta", "success", "Shared invite via WhatsApp"),
        "invite_sms" => ("cta", "success", "Shared invite via SMS"),
        "invite_share" => ("cta", "success", "Copied / shared street link"),
        "invite_landed" => ("page", "info", "Landed via neighbour invite"),
        "points_swap_voted" => ("cta", "info", "Voted for points swap"),
        "cash_payout_selected" => ("cta", "info", "Selected 8¢ cash payouts"),
        _ => ("page", "info", name.Replace('_', ' ')),
    };

    foreach (var e in growthEvents)
    {
        var (kind, severity, title) = DescribeGrowthEvent(e.Name);
        var detailParts = new List<string>();
        if (!string.IsNullOrWhiteSpace(e.Path)) detailParts.Add(e.Path);
        if (!string.IsNullOrWhiteSpace(e.Suburb)) detailParts.Add(e.Suburb);
        stream.Add((e.CreatedAt, new
        {
            id = $"evt-{e.Id}",
            kind,
            severity,
            timestamp = e.CreatedAt,
            actor = "Visitor",
            userId = (Guid?)null,
            suburb = e.Suburb,
            path = e.Path,
            title,
            detail = detailParts.Count > 0 ? string.Join(" · ", detailParts) : e.Name,
        }));
    }

    foreach (var o in otpCodes)
    {
        var emailKey = o.Email.Trim().ToLowerInvariant();
        profileByEmail.TryGetValue(emailKey, out var matchedProfile);
        var state = o.Used ? "verified" : (o.ExpiresAt < now ? "expired" : "waiting for code");
        var severity = o.Used ? "success" : (o.Attempts >= 3 ? "warn" : "info");
        stream.Add((o.CreatedAt, new
        {
            id = $"otp-{o.Id}",
            kind = "otp",
            severity,
            timestamp = o.CreatedAt,
            actor = o.Email,
            userId = matchedProfile?.Id,
            suburb = BinDayService.CanonicalSuburb(matchedProfile?.Household?.Suburb),
            path = (string?)null,
            title = o.Used ? "OTP verified" : "OTP emailed",
            detail = $"{o.Email} · {state}" + (o.Attempts > 0 ? $" · {o.Attempts} {(o.Attempts == 1 ? "attempt" : "attempts")}" : ""),
        }));
    }

    foreach (var u in recentProfiles.Where(p => p.CreatedAt >= since))
    {
        var suburb = BinDayService.CanonicalSuburb(u.Household?.Suburb);
        var missingAddress = u.Household is null || suburb is null;
        stream.Add((u.CreatedAt, new
        {
            id = $"signup-{u.Id}",
            kind = "signup",
            severity = "success",
            timestamp = u.CreatedAt,
            actor = u.Email ?? u.Name,
            userId = (Guid?)u.Id,
            suburb,
            path = (string?)null,
            title = "New user signed up",
            detail = $"{u.Name}" + (!string.IsNullOrWhiteSpace(u.Email) ? $" ({u.Email})" : "") + (missingAddress ? " · address pending" : $" · {suburb}"),
        }));
    }

    foreach (var v in visionCalls)
    {
        Profile? caller = null;
        if (v.UserId.HasValue) profileById.TryGetValue(v.UserId.Value, out caller);
        var severity = !v.Success ? "error" : (v.ContainerCount == 0 ? "warn" : "success");
        var title = !v.Success
            ? $"AI Vision failed ({v.Provider})"
            : $"AI Vision · {v.ContainerCount} {(v.ContainerCount == 1 ? "can" : "cans")}";
        var detail = !v.Success
            ? $"{v.Provider} · {v.DurationMs}ms · {v.ErrorSummary ?? "unknown error"}"
            : $"{v.Provider} · {v.DurationMs}ms" + (caller?.Email is not null ? $" · {caller.Email}" : "");
        stream.Add((v.CreatedAt, new
        {
            id = $"vision-{v.Id}",
            kind = v.Success ? "vision" : "error",
            severity,
            timestamp = v.CreatedAt,
            actor = caller?.Email ?? caller?.Name ?? "Scanner user",
            userId = v.UserId,
            suburb = BinDayService.CanonicalSuburb(caller?.Household?.Suburb),
            path = "/scan",
            title,
            detail,
        }));
    }

    foreach (var s in scans)
    {
        var suburb = BinDayService.CanonicalSuburb(s.User?.Household?.Suburb);
        var label = string.IsNullOrWhiteSpace(s.ContainerName) ? "Eligible container" : s.ContainerName;
        var via = string.Equals(s.Barcode, "PHOTO", StringComparison.OrdinalIgnoreCase) ? "photo" : $"barcode {s.Barcode}";
        stream.Add((s.CreatedAt, new
        {
            id = $"scan-{s.Id}",
            kind = "scan",
            severity = "success",
            timestamp = s.CreatedAt,
            actor = s.User?.Email ?? s.User?.Name ?? "Sorter",
            userId = (Guid?)s.UserId,
            suburb,
            path = "/scan",
            title = $"Scan credited +{s.RefundCents}¢",
            detail = $"{label} ({s.Material}) via {via}" + (s.HouseholdId is null ? " · orphan (no address yet)" : ""),
        }));
    }

    foreach (var h in households)
    {
        var suburb = BinDayService.CanonicalSuburb(h.Suburb);
        stream.Add((h.CreatedAt, new
        {
            id = $"hh-{h.Id}",
            kind = "household",
            severity = "success",
            timestamp = h.CreatedAt,
            actor = h.Name,
            userId = (Guid?)null,
            suburb,
            path = "/onboard",
            title = h.Type == "unit_complex" ? "Unit complex waitlisted" : "Household onboarded",
            detail = $"{h.Address}" + (h.PendingContainers > 0 ? $" · {h.PendingContainers} backfilled" : ""),
        }));
    }

    foreach (var b in bags)
    {
        var suburb = BinDayService.CanonicalSuburb(b.Household?.Suburb);
        profileById.TryGetValue(b.CreatorProfileId, out var creator);
        stream.Add((b.CreatedAt, new
        {
            id = $"bag-{b.Id}",
            kind = "bag",
            severity = "success",
            timestamp = b.CreatedAt,
            actor = creator?.Email ?? creator?.Name ?? b.Household?.Name ?? "Household",
            userId = b.CreatorProfileId != Guid.Empty ? (Guid?)b.CreatorProfileId : null,
            suburb,
            path = "/bags",
            title = $"Bag tagged ({b.Code})",
            detail = $"{b.Stream} · {b.DeclaredContainers} cans · {b.Status}",
        }));
    }

    foreach (var c in cashouts)
    {
        var suburb = BinDayService.CanonicalSuburb(c.User?.Household?.Suburb);
        stream.Add((c.CreatedAt, new
        {
            id = $"cashout-{c.Id}",
            kind = "cashout",
            severity = "success",
            timestamp = c.CreatedAt,
            actor = c.User?.Email ?? c.User?.Name ?? "Member",
            userId = (Guid?)c.UserId,
            suburb,
            path = "/sort",
            title = $"Cashout ${(c.AmountCents / 100.0):0.00}",
            detail = $"{c.PayoutMethod} · {c.Status}",
        }));
    }

    var orderedStream = stream
        .OrderByDescending(x => x.Ts)
        .Take(maxItems)
        .Select(x => x.Item)
        .ToList();

    // ── Live KPIs & Funnel for selected window ──
    var evtCounts = growthEvents
        .GroupBy(e => e.Name, StringComparer.OrdinalIgnoreCase)
        .ToDictionary(g => g.Key, g => g.Count(), StringComparer.OrdinalIgnoreCase);
    int EvtCount(string name) => evtCounts.TryGetValue(name, out var c) ? c : 0;

    var visionSucceeded = visionCalls.Count(v => v.Success);
    var visionFailed = visionCalls.Count(v => !v.Success);
    var avgVisionMs = visionCalls.Count > 0 ? (int)Math.Round(visionCalls.Average(v => v.DurationMs)) : 0;
    var eventsLast15m = growthEvents.Count(e => e.CreatedAt >= since15m)
        + otpCodes.Count(o => o.CreatedAt >= since15m)
        + visionCalls.Count(v => v.CreatedAt >= since15m)
        + scans.Count(s => s.CreatedAt >= since15m)
        + households.Count(h => h.CreatedAt >= since15m);
    var interactionsLast5m = growthEvents.Count(e => e.CreatedAt >= since5m)
        + otpCodes.Count(o => o.CreatedAt >= since5m)
        + visionCalls.Count(v => v.CreatedAt >= since5m)
        + scans.Count(s => s.CreatedAt >= since5m);

    var pulse = new
    {
        eventsLast15m,
        interactionsLast5m,
        pageViews = EvtCount("landing_viewed") + EvtCount("suburb_page_viewed") + EvtCount("map_viewed") + EvtCount("sort_dashboard_viewed"),
        ctaTaps = EvtCount("waitlist_cta"),
        otpsSent = otpCodes.Count,
        otpsVerified = otpCodes.Count(o => o.Used),
        newSignups = recentProfiles.Count(p => p.CreatedAt >= since),
        cameraOpens = EvtCount("scan_camera_opened"),
        cameraDenied = EvtCount("camera_denied"),
        scansCaptured = EvtCount("scan_captured"),
        visionCalls = visionCalls.Count,
        visionSucceeded,
        visionFailed,
        avgVisionMs,
        scansCredited = scans.Count,
        householdsCreated = households.Count,
        bagsTagged = bags.Count,
    };

    var funnel = new[]
    {
        new { key = "views", label = "Page views", count = pulse.pageViews },
        new { key = "cta", label = "CTA tapped", count = pulse.ctaTaps },
        new { key = "otp_sent", label = "OTP sent", count = Math.Max(pulse.otpsSent, EvtCount("otp_sent")) },
        new { key = "otp_verified", label = "OTP verified", count = Math.Max(pulse.otpsVerified, EvtCount("otp_verified")) },
        new { key = "camera", label = "Camera opened", count = pulse.cameraOpens },
        new { key = "captured", label = "Photo / barcode", count = Math.Max(pulse.scansCaptured, pulse.visionCalls) },
        new { key = "credited", label = "Scan credited", count = Math.Max(pulse.scansCredited, EvtCount("scan_credited")) },
        new { key = "address", label = "Address saved", count = Math.Max(pulse.householdsCreated, EvtCount("household_joined")) },
        new { key = "payout", label = "PayID / bank saved", count = EvtCount("payout_details_saved") },
    };

    var topSuburbs = growthEvents
        .Where(e => !string.IsNullOrWhiteSpace(e.Suburb))
        .GroupBy(e => e.Suburb!)
        .Select(g => new { suburb = g.Key, events = g.Count() })
        .OrderByDescending(x => x.events)
        .Take(10)
        .ToList();

    // ── Per-tester live journeys (profiles + unverified OTP leads) ──
    var otpsByEmail = testerOtps
        .GroupBy(o => o.Email.Trim().ToLowerInvariant())
        .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.CreatedAt).ToList());
    var scansByUser = testerRecentScans
        .GroupBy(s => s.UserId)
        .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.CreatedAt).ToList());
    var visionByUser = testerRecentVision
        .Where(v => v.UserId.HasValue)
        .GroupBy(v => v.UserId!.Value)
        .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.CreatedAt).ToList());
    var bagsByUser = testerRecentBags
        .GroupBy(b => b.CreatorProfileId)
        .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.CreatedAt).ToList());

    var testerEntries = new List<(DateTime LastSeen, object Card)>();
    var seenEmails = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    foreach (var p in recentProfiles.Take(25))
    {
        var emailNorm = (p.Email ?? "").Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(emailNorm)) seenEmails.Add(emailNorm);

        otpsByEmail.TryGetValue(emailNorm, out var pOtps);
        scansByUser.TryGetValue(p.Id, out var pScans);
        visionByUser.TryGetValue(p.Id, out var pVision);
        bagsByUser.TryGetValue(p.Id, out var pBags);

        var suburb = BinDayService.CanonicalSuburb(p.Household?.Suburb);
        var hasAddress = p.Household is not null && !string.IsNullOrWhiteSpace(p.Household.Address) && suburb is not null;
        var hasPayout = !string.IsNullOrWhiteSpace(p.PayIdValue)
            || (!string.IsNullOrWhiteSpace(p.BankBsb) && !string.IsNullOrWhiteSpace(p.BankAccountNumber));
        var hasScan = p.TotalContainers > 0 || (pScans?.Count ?? 0) > 0;
        var hasBag = (pBags?.Count ?? 0) > 0;

        var steps = new List<(DateTime Ts, string Label, string Tone)>();
        if (pOtps is not null)
        {
            foreach (var o in pOtps.Take(2))
                steps.Add((o.CreatedAt, o.Used ? "OTP verified" : "OTP emailed", o.Used ? "ok" : "info"));
        }
        steps.Add((p.CreatedAt, "Account created", "ok"));
        if (p.Household is not null)
            steps.Add((p.Household.CreatedAt, $"Saved address ({suburb ?? p.Household.Suburb ?? "Brisbane"})", "ok"));
        if (pVision is not null)
        {
            foreach (var v in pVision.Take(3))
                steps.Add((v.CreatedAt, v.Success ? $"AI Vision: {v.ContainerCount} can(s) ({v.DurationMs}ms)" : $"AI Vision error: {v.ErrorSummary ?? "failed"}", v.Success ? "ok" : "err"));
        }
        if (pScans is not null)
        {
            foreach (var s in pScans.Take(3))
                steps.Add((s.CreatedAt, $"Credited +{s.RefundCents}¢ · {(string.IsNullOrWhiteSpace(s.ContainerName) ? s.Material : s.ContainerName)}", "ok"));
        }
        if (pBags is not null)
        {
            foreach (var b in pBags.Take(2))
                steps.Add((b.CreatedAt, $"Tagged bag {b.Code} ({b.DeclaredContainers} cans)", "ok"));
        }

        var lastSeen = steps.Count > 0 ? steps.Max(x => x.Ts) : p.CreatedAt;
        var status = hasScan && hasAddress
            ? "activated"
            : hasScan
                ? "scanned_no_address"
                : hasAddress
                    ? "address_no_scan"
                    : "verified_no_scan";

        testerEntries.Add((lastSeen, new
        {
            key = p.Id.ToString(),
            userId = (Guid?)p.Id,
            email = p.Email,
            name = p.Name,
            suburb,
            status,
            milestones = new
            {
                otpSent = true,
                otpVerified = true,
                scanned = hasScan,
                hasAddress,
                hasPayout,
                hasBag,
            },
            otpAttempts = pOtps?.Sum(o => o.Attempts) ?? 0,
            scansCount = p.TotalContainers,
            pendingCents = p.PendingCents,
            visionCalls = pVision?.Count ?? 0,
            visionErrors = pVision?.Count(v => !v.Success) ?? 0,
            createdAt = p.CreatedAt,
            lastSeenAt = lastSeen,
            recentSteps = steps
                .OrderByDescending(x => x.Ts)
                .Take(6)
                .Select(x => new { timestamp = x.Ts, label = x.Label, tone = x.Tone })
                .ToList(),
        }));
    }

    // Include unverified OTP leads (people who entered their email but haven't verified yet!)
    foreach (var kv in otpsByEmail)
    {
        if (seenEmails.Contains(kv.Key)) continue;
        var latest = kv.Value[0];
        if (latest.CreatedAt < now.AddHours(-24)) continue;
        testerEntries.Add((latest.CreatedAt, new
        {
            key = $"otp-{latest.Id}",
            userId = (Guid?)null,
            email = latest.Email,
            name = latest.Email.Split('@')[0],
            suburb = (string?)null,
            status = "otp_pending",
            milestones = new
            {
                otpSent = true,
                otpVerified = latest.Used,
                scanned = false,
                hasAddress = false,
                hasPayout = false,
                hasBag = false,
            },
            otpAttempts = kv.Value.Sum(o => o.Attempts),
            scansCount = 0,
            pendingCents = 0,
            visionCalls = 0,
            visionErrors = 0,
            createdAt = latest.CreatedAt,
            lastSeenAt = latest.CreatedAt,
            recentSteps = kv.Value.Take(3)
                .Select(o => new
                {
                    timestamp = o.CreatedAt,
                    label = o.Used ? "OTP verified" : (o.ExpiresAt < now ? "OTP expired without verify" : "OTP emailed — waiting for 6-digit code"),
                    tone = o.Used ? "ok" : "warn",
                })
                .ToList(),
        }));
    }

    var testers = testerEntries
        .OrderByDescending(x => x.LastSeen)
        .Take(25)
        .Select(x => x.Card)
        .ToList();

    return Results.Ok(new
    {
        serverTimeUtc = now,
        windowMinutes,
        pulse,
        funnel,
        topSuburbs,
        testers,
        stream = orderedStream,
    });
})
    .RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Tomorrow's pickups + active/pilot runner status ──
app.MapGet("/api/admin/pickups/tomorrow", async (GoodSortDbContext db) =>
{
    var brisbane = BrisbaneTime.Now;
    var tomorrowDow = (int)brisbane.AddDays(1).DayOfWeek;
    var utcNow = DateTime.UtcNow;

    var activeRuns = await db.Runs
        .Include(r => r.Runner).ThenInclude(rp => rp!.Profile)
        .Include(r => r.Stops)
        .Where(r => (RunLifecycle.HoldsBin.Contains(r.Status) || r.Status == "completed")
                    && (!RunLifecycle.Unclaimed.Contains(r.Status) || r.ExpiresAt > utcNow))
        .OrderByDescending(r => r.CreatedAt)
        .ToListAsync();

    var activeStopBinIds = activeRuns
        .SelectMany(r => r.Stops.Select(s => s.BinId))
        .ToHashSet();
    var activeRunBins = activeStopBinIds.Count == 0
        ? new List<Bin>()
        : await db.Bins.Where(b => activeStopBinIds.Contains(b.Id)).ToListAsync();
    var activeRunHhIds = activeRunBins
        .Where(b => b.HouseholdId.HasValue)
        .Select(b => b.HouseholdId!.Value)
        .ToHashSet();

    var households = await db.Households
        .Include(h => h.Members)
        .Where(h => h.Type != "unit_complex"
                    && BinStatuses.Serviceable.Contains(h.BinStatus)
                    && (h.BinIsOut || h.PendingContainers > 0 || activeRunHhIds.Contains(h.Id)))
        .ToListAsync();

    var hhIds = households.Select(h => h.Id).ToHashSet();
    var bins = await db.Bins
        .Where(b => (b.HouseholdId != null && hhIds.Contains(b.HouseholdId.Value)) || activeStopBinIds.Contains(b.Id))
        .ToListAsync();
    var binById = bins.ToDictionary(b => b.Id);

    var assignedRuns = activeRuns
        .Where(r => !RunLifecycle.Unclaimed.Contains(r.Status))
        .ToList();

    return Results.Ok(new
    {
        tomorrowDayOfWeek = tomorrowDow,
        totalHouseholds = households.Count,
        householdsWithBinOut = households.Count(h => h.BinIsOut),
        runsCovering = activeRuns.Count,
        runsClaimed = assignedRuns.Count,
        householdsUncovered = households.Count(h => !assignedRuns.Any(r =>
            r.Stops.Any(s => binById.TryGetValue(s.BinId, out var b) && b.HouseholdId == h.Id))),
        households = households.Select(h => new {
            h.Id, h.Name, h.Address, h.PendingContainers, h.UsesDivider, h.BinIsOut, h.BinStatus,
            memberEmails = h.Members.Select(m => m.Email).Where(e => e != null),
        }),
        runs = activeRuns.Select(r => new {
            r.Id, r.Status, r.AreaName, r.EstimatedContainers, r.ActualContainers,
            r.DepotVerifiedContainers, r.CoexDocketRef, r.PerContainerCents, r.EstimatedPayoutCents,
            runnerName = r.Runner != null ? r.Runner.Profile!.Name : null,
            runnerEmail = r.Runner != null ? r.Runner.Profile!.Email : null,
            stops = r.Stops.Count,
        }),
    });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Promote a below_threshold pilot run to "available" on the Runner marketplace ──
app.MapPost("/api/admin/marketplace/runs/{id:guid}/publish", async (Guid id, GoodSortDbContext db) =>
{
    var run = await db.Runs.FindAsync(id);
    if (run is null) return Results.NotFound();
    if (run.Status != "below_threshold" && run.Status != "available")
        return Results.BadRequest(new { error = $"Cannot publish run in status '{run.Status}'." });
    run.Status = "available";
    if (run.ExpiresAt <= DateTime.UtcNow)
        run.ExpiresAt = DateTime.UtcNow.AddHours(18);
    await db.SaveChangesAsync();
    return Results.Ok(new { run.Id, run.Status, run.AreaName, run.ExpiresAt });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: manually trigger the pickup reminder service (for dry-run testing) ──
app.MapPost("/api/admin/trigger-pickup-reminders", async (PickupReminderService svc) =>
{
    var (households, runners) = await svc.TriggerNow();
    return Results.Ok(new { households, runners });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: waitlist by suburb — trigger bin purchase when density is met ──
app.MapGet("/api/admin/waitlist", async (GoodSortDbContext db) =>
{
    var liveThreshold = WaitlistDensity.LiveThreshold;
    var dayNames = WaitlistDensity.DayNames;
    var rows = await db.Households.AsNoTracking()
        // Not == "residential": legacy rows carry an empty Type from the
        // migration default, and excluding them here while WaitlistDensity
        // counts them would make ops blind to households driving a run.
        .Where(h => h.Type != "unit_complex")
        .Select(h => new
        {
            h.Id, h.Name, h.Address, h.Suburb, h.Street,
            h.CouncilCollectionDay, h.BinStatus, h.WaitlistedAt, h.CreatedAt, h.PendingContainers,
        })
        .ToListAsync();

    var suburbs = rows
        .GroupBy(r => WaitlistDensity.AdminGroupKey(r.Suburb))
        .Select(g =>
        {
            var clusterable = WaitlistDensity.CanAllocateSuburb(g.Key);
            var containers = g.Sum(x => Math.Max(0, x.PendingContainers));
            var suburbReady = clusterable
                && WaitlistDensity.CanDispatch(containers, g.Count())
                && g.Any(x => x.BinStatus == BinStatuses.Waitlisted);
            var days = g.Where(x => x.CouncilCollectionDay != null)
                .GroupBy(x => x.CouncilCollectionDay!.Value)
                .Select(d => new
                {
                    day = d.Key,
                    dayName = d.Key is >= 0 and <= 6 ? dayNames[d.Key] : "recycling day",
                    households = d.Count(),
                    containers = d.Sum(x => Math.Max(0, x.PendingContainers)),
                    waitlisted = d.Count(x => x.BinStatus == BinStatuses.Waitlisted),
                    allocated = d.Count(x => x.BinStatus == BinStatuses.Allocated),
                    delivered = d.Count(x => x.BinStatus == BinStatuses.Delivered),
                    collecting = d.Count(x => x.BinStatus == BinStatuses.Collecting),
                    readyToOrder = suburbReady && d.Any(x => x.BinStatus == BinStatuses.Waitlisted),
                })
                .OrderByDescending(d => d.containers)
                .ThenByDescending(d => d.households)
                .ToList();
            return new
            {
                suburb = g.Key,
                households = g.Count(),
                containers,
                waitlisted = g.Count(x => x.BinStatus == BinStatuses.Waitlisted),
                allocated = g.Count(x => x.BinStatus == BinStatuses.Allocated),
                delivered = g.Count(x => x.BinStatus == BinStatuses.Delivered),
                collecting = g.Count(x => x.BinStatus == BinStatuses.Collecting),
                readyToOrder = suburbReady,
                days,
                houses = g.OrderBy(x => x.WaitlistedAt ?? x.CreatedAt).Select(x => new
                {
                    x.Id, x.Name, x.Address, x.Street, x.CouncilCollectionDay, x.BinStatus, x.WaitlistedAt, x.PendingContainers,
                }),
            };
        })
        .OrderByDescending(s => s.containers)
        .ThenByDescending(s => s.households)
        .ToList();

    return Results.Ok(new { liveThreshold, total = rows.Count, suburbs });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

app.MapPost("/api/admin/areas/{suburb}/allocate", async (string suburb, int? day, GoodSortDbContext db, NotificationService notif, ILogger<Program> log) =>
{
    if (!WaitlistDensity.CanAllocateSuburb(suburb))
        return Results.BadRequest(new { error = "Not a residential suburb cluster." });
    if (day is < 0 or > 6)
        return Results.BadRequest(new { error = "Day of week must be between 0 (Sunday) and 6 (Saturday)." });
    var key = BinDayService.CanonicalSuburb(suburb)!;
    var suburbRows = await db.Households.AsNoTracking()
        .Where(h => h.Type != "unit_complex" && h.Suburb != null && h.Suburb.ToUpper() == key)
        .Select(h => new { h.Id, h.Suburb, h.Address, h.Street, h.PendingContainers })
        .ToListAsync();
    var containers = suburbRows.Sum(h => h.PendingContainers > 0 ? h.PendingContainers : 0);
    var households = suburbRows
        .Select(h => WaitlistJoin.PhysicalHouseKey(h.Suburb, h.Address, h.Street) ?? h.Id.ToString("N"))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .Count();
    if (!WaitlistDensity.CanPurchase(containers))
        return Results.BadRequest(new { error = $"Need {WaitlistDensity.LiveThreshold} scanned containers in the suburb. This suburb has {containers}." });
    if (!WaitlistDensity.CanDispatch(containers, households))
        return Results.BadRequest(new { error = $"Need at least {WaitlistDensity.MinHouseholdsForRun} households in the suburb to send a driver. This suburb has {households}." });
    var q = db.Households.Where(h => h.Type != "unit_complex" && h.Suburb != null && h.Suburb.ToUpper() == key && h.BinStatus == BinStatuses.Waitlisted);
    if (day is int d) q = q.Where(h => h.CouncilCollectionDay == d);
    var rows = await q.ToListAsync();
    foreach (var h in rows) h.BinStatus = BinStatuses.Allocated;
    await db.SaveChangesAsync();
    // Must not fail the allocation, but must not be silent either: this is the
    // message telling a suburb their bins are coming, and a failure has no
    // other symptom. The ACS outage that opened this week was invisible for
    // exactly this reason.
    try { await notif.SendBinsOnOrder(key, day); }
    catch (Exception ex) { log.LogError(ex, "Bins-on-order email failed for {Suburb} day {Day} - allocation still applied", key, day); }
    return Results.Ok(new { suburb = key, day, allocated = rows.Count, containers });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

app.MapPost("/api/admin/areas/{suburb}/advance", async (string suburb, int? day, string? to, GoodSortDbContext db, NotificationService notif, ILogger<Program> log) =>
{
    if (!WaitlistDensity.CanAllocateSuburb(suburb))
        return Results.BadRequest(new { error = "Not a residential suburb cluster." });
    if (day is < 0 or > 6)
        return Results.BadRequest(new { error = "Day of week must be between 0 (Sunday) and 6 (Saturday)." });
    if (string.IsNullOrWhiteSpace(to))
        return Results.BadRequest(new { error = "Advance to delivered or collecting only." });
    var next = to.Trim().ToLowerInvariant();
    var from = next switch
    {
        BinStatuses.Delivered => BinStatuses.Allocated,
        BinStatuses.Collecting => BinStatuses.Delivered,
        _ => null,
    };
    if (from is null) return Results.BadRequest(new { error = "Advance to delivered or collecting only." });
    var key = BinDayService.CanonicalSuburb(suburb)!;
    var q = db.Households.Where(h => h.Type != "unit_complex" && h.Suburb != null && h.Suburb.ToUpper() == key && h.BinStatus == from);
    if (day is int d) q = q.Where(h => h.CouncilCollectionDay == d);
    var rows = await q.ToListAsync();
    foreach (var h in rows) h.BinStatus = next;
    await db.SaveChangesAsync();
    if (next == BinStatuses.Collecting)
    {
        foreach (var h in rows)
        {
            // Must not fail the status change, but must not be silent either:
            // this is the message telling a member to put their bags out, and
            // a failure here has no other symptom.
            try { await notif.SendCollectingNow(h); }
            catch (Exception ex) { log.LogError(ex, "Collecting-now email failed for household {HouseholdId} — status still changed", h.Id); }
        }
    }
    return Results.Ok(new { suburb = key, day, to = next, updated = rows.Count });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

app.MapPost("/api/admin/households/{id:guid}/bin-status", async (Guid id, BinStatusRequest req, GoodSortDbContext db, NotificationService notif, ILogger<Program> log) =>
{
    var allowed = new[] { BinStatuses.Waitlisted, BinStatuses.Allocated, BinStatuses.Delivered, BinStatuses.Collecting };
    if (!allowed.Contains(req.Status)) return Results.BadRequest(new { error = "Invalid status" });
    var h = await db.Households.FindAsync(id);
    if (h is null) return Results.NotFound();
    var previous = h.BinStatus;
    h.BinStatus = req.Status;
    await db.SaveChangesAsync();
    if (previous != req.Status && BinStatuses.IsServiceable(req.Status))
    {
        // Must not fail the status change, but must not be silent either:
        // this is the message telling a member to put their bags out, and
        // a failure here has no other symptom.
        try { await notif.SendCollectingNow(h); }
        catch (Exception ex) { log.LogError(ex, "Collecting-now email failed for household {HouseholdId} — status still changed", h.Id); }
    }
    return Results.Ok(new { h.Id, h.BinStatus });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Recyclers — material destination endpoints ──
app.MapGet("/api/recyclers", async (string? stream, GoodSortDbContext db) =>
{
    var q = db.Recyclers.Where(r => r.Status == "active" || r.Status == "agreed");
    if (!string.IsNullOrEmpty(stream))
        q = q.Where(r => r.AcceptedStreams.Contains(stream));
    return Results.Ok(await q.ToListAsync());
});

app.MapGet("/api/recyclers/all", async (GoodSortDbContext db) =>
    Results.Ok(await db.Recyclers.OrderBy(r => r.Name).ToListAsync()))
    .RequireAuthorization(AuthHelpers.AdminPolicy);

app.MapPost("/api/recyclers", async (Recycler recycler, GoodSortDbContext db) =>
{
    db.Recyclers.Add(recycler);
    await db.SaveChangesAsync();
    return Results.Created($"/api/recyclers/{recycler.Id}", recycler);
}).RequireAuthorization(AuthHelpers.AdminPolicy);

app.MapPatch("/api/recyclers/{id:guid}", async (Guid id, Recycler update, GoodSortDbContext db) =>
{
    var r = await db.Recyclers.FindAsync(id);
    if (r is null) return Results.NotFound();
    if (update.Name is not null) r.Name = update.Name;
    if (update.Status is not null) r.Status = update.Status;
    if (update.PricePerKgCents > 0) r.PricePerKgCents = update.PricePerKgCents;
    if (update.ContactName is not null) r.ContactName = update.ContactName;
    if (update.ContactEmail is not null) r.ContactEmail = update.ContactEmail;
    if (update.ContactPhone is not null) r.ContactPhone = update.ContactPhone;
    if (update.Notes is not null) r.Notes = update.Notes;
    await db.SaveChangesAsync();
    return Results.Ok(r);
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: List all cashout requests (admin only — BSBs + account numbers) ──
app.MapGet("/api/admin/cashouts", async (GoodSortDbContext db) =>
    Results.Ok(await db.Set<GoodSort.Api.Services.CashoutRequest>().Include(c => c.User).OrderByDescending(c => c.CreatedAt).Take(100).ToListAsync()))
    .RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Profile PATCH (update name + household) ──
app.MapPatch("/api/profiles/{id:guid}", async (HttpContext ctx, Guid id, ProfileUpdateRequest req, GoodSortDbContext db) =>
{
    if (!ctx.IsOwnerOrAdmin(id)) return Results.Forbid();
    var profile = await db.Profiles.FindAsync(id);
    if (profile is null) return Results.NotFound();
    if (req.Name is not null) profile.Name = req.Name.Trim();
    if (req.HouseholdId is Guid targetHhId && profile.HouseholdId != targetHhId)
    {
        // Guard cross-tenant household attachment: attaching to another member's
        // HouseholdId would satisfy CallerCanAccessHousehold and expose their
        // street address, coordinates, QR bags, and settlement payee list.
        if (!ctx.IsAdmin())
        {
            if (profile.HouseholdId is not null)
                return Results.Forbid();
            if (!await db.Households.AnyAsync(h => h.Id == targetHhId))
                return Results.NotFound("Household not found");
            var occupiedByAnother = await db.Profiles.AnyAsync(p => p.HouseholdId == targetHhId && p.Id != profile.Id);
            if (occupiedByAnother)
                return Results.Forbid();
        }
        // Attaching a household via PATCH bypasses the same-house/same-building anti-abuse checks
        // on POST /api/households, so clear any pending ReferrerId when linking this way.
        if (profile.HouseholdId is null)
            profile.ReferrerId = null;
        profile.HouseholdId = targetHhId;
    }
    await db.SaveChangesAsync();
    return Results.Ok(profile);
}).RequireAuthorization();

// ── Profile DELETE — full account wipe (GDPR / privacy-policy right-to-erasure) ──
app.MapDelete("/api/profiles/{id:guid}", async (HttpContext ctx, Guid id, GoodSortDbContext db, IConfiguration cfg, PricingService pricing) =>
{
    if (!ctx.IsOwnerOrAdmin(id)) return Results.Forbid();
    var profile = await db.Profiles.Include(p => p.Scans).Include(p => p.Collections).FirstOrDefaultAsync(p => p.Id == id);
    if (profile is null) return Results.NotFound();

    var cashouts = await db.CashoutRequests.Where(c => c.UserId == id).ToListAsync();
    if (cashouts.Any(c => c.Status == "pending" || c.Status == "processing"))
    {
        return Results.Conflict(new
        {
            error = "Cannot delete account while a payout request is pending or processing. Cancel any pending payout first or wait for your bank transfer to settle.",
        });
    }

    db.Scans.RemoveRange(profile.Scans);
    db.Collections.RemoveRange(profile.Collections);
    db.CashoutRequests.RemoveRange(cashouts);

    // Clean up any anonymous building syndicate memberships before removing the profile (FK is NoAction on SQL Server)
    var syndicateMemberships = await db.BuildingSyndicateMembers
        .Where(m => m.ProfileId == id)
        .ToListAsync();
    if (syndicateMemberships.Count > 0)
    {
        var memberIds = syndicateMemberships.Select(m => m.Id).ToHashSet();
        var memberMsgs = await db.BuildingSyndicateMessages
            .Where(m => m.MemberId.HasValue && memberIds.Contains(m.MemberId.Value))
            .ToListAsync();
        foreach (var msg in memberMsgs) msg.MemberId = null;
        db.BuildingSyndicateMembers.RemoveRange(syndicateMemberships);
    }

    // Neighbour referrals earn Good Sort Points only (no pending cash signup bonus to reverse on delete).
    var referredProfiles = await db.Profiles.Where(p => p.ReferrerId == id).ToListAsync();
    foreach (var r in referredProfiles) r.ReferrerId = null;

    // Null out runner claims so runs aren't orphaned or stuck in an active state
    var claimedRoutes = await db.Routes.Where(r => r.DriverId == id).ToListAsync();
    foreach (var r in claimedRoutes)
    {
        r.DriverId = null;
        if (r.Status is "claimed" or "in_progress")
        {
            r.Status = "pending";
            r.ClaimedAt = null;
        }
    }

    var minPayoutCents = RunGenerationService.ResolveMinPayoutCents(cfg);
    var runnerProfile = await db.RunnerProfiles.FirstOrDefaultAsync(rp => rp.ProfileId == id);
    if (runnerProfile != null)
    {
        var runnerRuns = await db.Runs.Include(r => r.Stops).Where(r => r.RunnerId == runnerProfile.Id).ToListAsync();
        var releasedRunIds = new HashSet<Guid>();
        foreach (var r in runnerRuns)
        {
            r.RunnerId = null;
            if (r.Status is "claimed" or "in_progress" or "delivering")
            {
                r.ClaimedAt = null;
                r.StartedAt = null;
                r.LastBriefedAt = null;
                releasedRunIds.Add(r.Id);
                foreach (var s in r.Stops)
                {
                    if (s.Status is "arrived" or "picked_up" or "skipped")
                    {
                        s.Status = "pending";
                        s.ArrivedAt = null;
                        s.PickedUpAt = null;
                        s.ActualContainers = null;
                        s.ScannedBagCount = 0;
                    }
                }

                if (r.ExpiresAt <= DateTime.UtcNow)
                {
                    r.Status = "expired";
                }
                else
                {
                    var repriced = await pricing.CalculateRate(r);
                    r.PerContainerCents = repriced.PerContainerCents;
                    r.EstimatedPayoutCents = repriced.EstimatedPayoutCents;
                    r.PricingTier = repriced.PricingTier;
                    r.LastPricedAt = DateTime.UtcNow;
                    r.Status = repriced.EstimatedPayoutCents >= minPayoutCents
                        ? "available"
                        : "below_threshold";
                }
            }
        }
        var runnerBags = await db.SortedBags.Where(b => b.PickedUpByRunnerId == runnerProfile.Id).ToListAsync();
        foreach (var b in runnerBags)
        {
            b.PickedUpByRunnerId = null;
            if (b.Status == "picked_up" && b.RunId is Guid bagRunId && releasedRunIds.Contains(bagRunId))
            {
                b.Status = "on_kerb";
                b.PickedUpAt = null;
                b.RunId = null;
                b.RunStopId = null;
            }
        }

        // RunnerRating → RunnerProfile uses DeleteBehavior.NoAction on SQL Server;
        // remove ratings first so deleting a runner with settled runs never 500s.
        var ratings = await db.RunnerRatings.Where(rr => rr.RunnerId == runnerProfile.Id).ToListAsync();
        db.RunnerRatings.RemoveRange(ratings);
        db.RunnerProfiles.Remove(runnerProfile);
    }

    // Expire OTPs
    var otps = await db.OtpCodes.Where(o => o.Email == profile.Email).ToListAsync();
    db.OtpCodes.RemoveRange(otps);

    var soleHouseholdId = profile.HouseholdId;
    profile.HouseholdId = null;
    db.Profiles.Remove(profile);

    if (soleHouseholdId is Guid hhId)
    {
        var hasRemainingMembers = await db.Profiles.AnyAsync(p => p.HouseholdId == hhId && p.Id != id);
        if (!hasRemainingMembers)
        {
            var hh = await db.Households.FirstOrDefaultAsync(h => h.Id == hhId);
            if (hh is not null)
            {
                var orphanScans = await db.Scans.Where(s => s.HouseholdId == hhId && s.UserId != id).ToListAsync();
                db.Scans.RemoveRange(orphanScans);

                var orphanBags = await db.SortedBags.Where(b => b.HouseholdId == hhId).ToListAsync();
                db.SortedBags.RemoveRange(orphanBags);

                var orphanRouteStops = await db.RouteStops.Where(rs => rs.HouseholdId == hhId).ToListAsync();
                db.RouteStops.RemoveRange(orphanRouteStops);

                var hhBins = await db.Bins.Where(b => b.HouseholdId == hhId).ToListAsync();
                if (hhBins.Count > 0)
                {
                    var hhBinIds = hhBins.Select(b => b.Id).ToHashSet();
                    var referencingStops = await db.RunStops
                        .Include(s => s.Run)
                        .Where(s => hhBinIds.Contains(s.BinId))
                        .ToListAsync();

                    var removableStops = referencingStops
                        .Where(s => RunLifecycle.Unclaimed.Contains(s.Run.Status) || s.Run.Status == "expired")
                        .ToList();
                    if (removableStops.Count > 0)
                    {
                        var touchedRunIds = removableStops.Select(s => s.RunId).Distinct().ToHashSet();
                        db.RunStops.RemoveRange(removableStops);

                        var touchedRuns = await db.Runs
                            .Include(r => r.Stops)
                            .Where(r => touchedRunIds.Contains(r.Id))
                            .ToListAsync();
                        foreach (var tr in touchedRuns)
                        {
                            var remainingStops = tr.Stops.Count(s => !removableStops.Contains(s));
                            if (remainingStops == 0)
                                db.Runs.Remove(tr);
                        }
                    }

                    var lockedStops = referencingStops
                        .Except(removableStops)
                        .ToList();
                    foreach (var stop in lockedStops)
                    {
                        stop.PickupInstruction = "Deleted household";
                        stop.Lat = 0;
                        stop.Lng = 0;
                        if (stop.Status is "pending" or "arrived")
                            stop.Status = "skipped";
                    }

                    var lockedBinIds = lockedStops
                        .Select(s => s.BinId)
                        .ToHashSet();

                    foreach (var bin in hhBins)
                    {
                        if (lockedBinIds.Contains(bin.Id))
                        {
                            // Preserve RunStop.BinId FK on historical/settled or in-flight runs while scrubbing all PII & coordinates.
                            bin.HouseholdId = null;
                            bin.Code = $"DEL-{bin.Id:N}";
                            bin.Name = "Deleted household";
                            bin.Address = "";
                            bin.HostedBy = null;
                            bin.Lat = 0;
                            bin.Lng = 0;
                            bin.PendingContainers = 0;
                            bin.PendingValueCents = 0;
                            bin.EstimatedWeightKg = 0;
                            bin.Materials = new MaterialBreakdown();
                            bin.Status = "deleted";
                        }
                        else
                        {
                            db.Bins.Remove(bin);
                        }
                    }
                }

                db.Households.Remove(hh);
            }
        }
    }

    await db.SaveChangesAsync();
    return Results.Ok(new { deleted = true });
}).RequireAuthorization();


// ══════════════════════════════════════════════════════════════════════
// ── 4-STREAM SECONDARY-SORTED QR BAG TAGS (SORTERS) ──
// ══════════════════════════════════════════════════════════════════════

app.MapPost("/api/bags", async (HttpContext ctx, CreateSortedBagRequest req, GoodSortDbContext db) =>
{
    var callerId = ctx.GetCallerId();
    if (callerId is null) return Results.Unauthorized();

    var profile = await db.Profiles.FindAsync(callerId.Value);
    if (profile is null) return Results.NotFound("Profile not found");
    if (profile.HouseholdId is not Guid hhId)
        return Results.BadRequest(new { error = "Add your street address first so QR bag tags link to your household." });

    var household = await db.Households.FindAsync(hhId);
    if (household is null) return Results.NotFound("Household not found");

    var stream = CrpSettlement.NormalizeStream(req.Stream);
    if (stream is null)
        return Results.BadRequest(new { error = "Stream must be aluminium, pet_clear, pet_coloured, or glass." });
    if (req.DeclaredContainers is < 0)
        return Results.BadRequest(new { error = "Declared containers must be between 1 and 500." });

    var activeBagCount = await db.SortedBags.CountAsync(b =>
        b.HouseholdId == hhId && (b.Status == "sealed" || b.Status == "on_kerb"));
    if (activeBagCount >= 50)
        return Results.BadRequest(new { error = "Maximum 50 active uncollected QR bags per household." });

    var unbaggedScans = await db.Scans
        .Where(s => s.HouseholdId == hhId && s.Status == "pending" && s.SortedBagId == null)
        .OrderBy(s => s.CreatedAt)
        .ToListAsync();

    var matchingScans = unbaggedScans
        .Where(s => CrpSettlement.ScanMatchesBagStream(s.Material, stream))
        .ToList();

    var declared = req.DeclaredContainers is > 0
        ? Math.Clamp(req.DeclaredContainers.Value, 1, 500)
        : Math.Clamp(Math.Max(matchingScans.Count, 1), 1, 500);

    var code = CrpSettlement.GenerateBagCode(stream);
    for (var attempt = 0; attempt < 5 && await db.SortedBags.AnyAsync(b => b.Code == code); attempt++)
        code = CrpSettlement.GenerateBagCode(stream);

    var putOnKerb = req.PutOnKerb == true;
    var bag = new SortedBag
    {
        Code = code,
        HouseholdId = hhId,
        CreatorProfileId = profile.Id,
        Stream = stream,
        DeclaredContainers = declared,
        Status = putOnKerb ? "on_kerb" : "sealed",
        KerbAt = putOnKerb ? DateTime.UtcNow : null,
    };

    var scansToLink = matchingScans.Take(declared).ToList();
    foreach (var scan in scansToLink)
        scan.SortedBagId = bag.Id;
    bag.LinkedScanCount = scansToLink.Count;

    if (putOnKerb)
    {
        household.BinIsOut = true;
        household.BinIsOutAt = DateTime.UtcNow;
    }

    db.SortedBags.Add(bag);
    await db.SaveChangesAsync();

    return Results.Created($"/api/bags/{bag.Id}", new
    {
        bag.Id,
        bag.Code,
        bag.Stream,
        bag.DeclaredContainers,
        bag.LinkedScanCount,
        bag.VerifiedContainers,
        bag.Status,
        bag.CreatedAt,
        bag.KerbAt,
    });
}).RequireAuthorization();

app.MapGet("/api/bags/mine", async (HttpContext ctx, GoodSortDbContext db) =>
{
    var callerId = ctx.GetCallerId();
    if (callerId is null) return Results.Unauthorized();

    var profile = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(p => p.Id == callerId.Value);
    if (profile is null) return Results.NotFound();

    var pendingScans = profile.HouseholdId is Guid hhId
        ? await db.Scans.AsNoTracking()
            .Where(s => s.HouseholdId == hhId && s.Status == "pending" && s.SortedBagId == null)
            .Select(s => s.Material)
            .ToListAsync()
        : await db.Scans.AsNoTracking()
            .Where(s => s.UserId == profile.Id && s.Status == "pending" && s.SortedBagId == null)
            .Select(s => s.Material)
            .ToListAsync();

    var unbaggedByStream = new
    {
        aluminium = pendingScans.Count(m => CrpSettlement.ScanMatchesBagStream(m, "aluminium")),
        pet_clear = pendingScans.Count(m => CrpSettlement.ScanMatchesBagStream(m, "pet_clear")),
        pet_coloured = pendingScans.Count(m => CrpSettlement.ScanMatchesBagStream(m, "pet_coloured")),
        glass = pendingScans.Count(m => CrpSettlement.ScanMatchesBagStream(m, "glass")),
    };

    if (profile.HouseholdId is not Guid householdId)
    {
        return Results.Ok(new
        {
            hasHousehold = false,
            unbaggedByStream,
            bags = Array.Empty<object>(),
        });
    }

    var bags = await db.SortedBags.AsNoTracking()
        .Where(b => b.HouseholdId == householdId && b.Status != "cancelled")
        .OrderBy(b => b.Status == "verified" ? 1 : 0)
        .ThenByDescending(b => b.CreatedAt)
        .Take(50)
        .Select(b => new
        {
            b.Id,
            b.Code,
            b.Stream,
            b.DeclaredContainers,
            b.LinkedScanCount,
            b.VerifiedContainers,
            b.ContaminationFlag,
            b.DiscrepancyCode,
            b.DiscrepancyNote,
            b.Status,
            b.CreatedAt,
            b.KerbAt,
            b.PickedUpAt,
            b.VerifiedAt,
        })
        .ToListAsync();

    return Results.Ok(new
    {
        hasHousehold = true,
        unbaggedByStream,
        bags,
    });
}).RequireAuthorization();

app.MapPatch("/api/bags/{id:guid}/status", async (HttpContext ctx, Guid id, UpdateSortedBagStatusRequest req, GoodSortDbContext db) =>
{
    var bag = await db.SortedBags.FindAsync(id);
    if (bag is null) return Results.NotFound();
    if (!await CallerCanAccessHousehold(ctx, bag.HouseholdId, db)) return Results.Forbid();

    if (bag.Status is "picked_up" or "verified")
        return Results.BadRequest(new { error = "This bag has already been collected by a Runner." });

    var next = (req.Status ?? "").Trim().ToLowerInvariant();
    if (next is not ("sealed" or "on_kerb" or "cancelled"))
        return Results.BadRequest(new { error = "Status must be sealed, on_kerb, or cancelled." });

    bag.Status = next;
    if (next == "on_kerb")
    {
        bag.KerbAt = DateTime.UtcNow;
        var hh = await db.Households.FindAsync(bag.HouseholdId);
        if (hh is not null)
        {
            hh.BinIsOut = true;
            hh.BinIsOutAt = DateTime.UtcNow;
        }
    }
    else if (next == "sealed")
    {
        bag.KerbAt = null;
        var stillOnKerb = await db.SortedBags.AnyAsync(b =>
            b.HouseholdId == bag.HouseholdId && b.Id != bag.Id && b.Status == "on_kerb");
        if (!stillOnKerb)
        {
            var hh = await db.Households.FindAsync(bag.HouseholdId);
            if (hh is not null)
            {
                hh.BinIsOut = false;
                hh.BinIsOutAt = null;
            }
        }
    }
    else if (next == "cancelled")
    {
        var linkedScans = await db.Scans.Where(s => s.SortedBagId == bag.Id).ToListAsync();
        foreach (var s in linkedScans) s.SortedBagId = null;
        bag.LinkedScanCount = 0;
        var stillOnKerb = await db.SortedBags.AnyAsync(b =>
            b.HouseholdId == bag.HouseholdId && b.Id != bag.Id && b.Status == "on_kerb");
        if (!stillOnKerb)
        {
            var hh = await db.Households.FindAsync(bag.HouseholdId);
            if (hh is not null)
            {
                hh.BinIsOut = false;
                hh.BinIsOutAt = null;
            }
        }
    }

    await db.SaveChangesAsync();
    return Results.Ok(new
    {
        bag.Id,
        bag.Code,
        bag.Stream,
        bag.DeclaredContainers,
        bag.LinkedScanCount,
        bag.Status,
        bag.KerbAt,
    });
}).RequireAuthorization();

app.MapGet("/api/bags/lookup/{code}", async (HttpContext ctx, string code, GoodSortDbContext db) =>
{
    var callerId = ctx.GetCallerId();
    if (callerId is null) return Results.Unauthorized();

    var normalized = code.Trim().ToUpperInvariant();
    var bag = await db.SortedBags.AsNoTracking()
        .Include(b => b.Household)
        .FirstOrDefaultAsync(b => b.Code == normalized);
    if (bag is null) return Results.NotFound(new { error = "Bag tag not found" });

    var isRunner = await db.RunnerProfiles.AnyAsync(rp => rp.ProfileId == callerId.Value);
    var canAccessHousehold = await CallerCanAccessHousehold(ctx, bag.HouseholdId, db);
    if (!isRunner && !canAccessHousehold) return Results.Forbid();

    return Results.Ok(new
    {
        bag.Id,
        bag.Code,
        bag.Stream,
        bag.DeclaredContainers,
        bag.LinkedScanCount,
        bag.VerifiedContainers,
        bag.ContaminationFlag,
        bag.DiscrepancyCode,
        bag.Status,
        suburb = BinDayService.CanonicalSuburb(bag.Household?.Suburb),
    });
}).RequireAuthorization();

// ══════════════════════════════════════════════════════════════════════
// ── SORTERS & RUNNERS MARKETPLACE ──
// ══════════════════════════════════════════════════════════════════════

// Public marketplace overview: aggregate suburb pools + active run bounties.
// Strictly projected to canonical suburb names, ~1.1km rounded suburb centroids,
// aggregate container/bag counts, and payout rates — NEVER member names, street
// addresses, or exact household coordinates.
app.MapGet("/api/marketplace/overview", async (GoodSortDbContext db, IConfiguration cfg) =>
{
    var crpActive = CrpSettlement.IsCrpActive(cfg);
    var activeSorterRate = CrpSettlement.ActiveHouseholdRateCents(cfg);

    var availableRuns = await db.Runs.AsNoTracking()
        .Include(r => r.Stops)
        .Where(r => r.Status == "available" && r.ExpiresAt > DateTime.UtcNow)
        .OrderByDescending(r => r.EstimatedPayoutCents)
        .Take(30)
        .ToListAsync();

    var residentialRows = await db.Households.AsNoTracking()
        .Where(h => h.Type != "unit_complex" && h.Suburb != null && h.Lat != 0 && h.Lng != 0)
        .Select(h => new { h.Id, h.Suburb, h.Lat, h.Lng, h.PendingContainers, h.BinIsOut })
        .ToListAsync();

    var openBagsByHousehold = await db.SortedBags.AsNoTracking()
        .Where(b => b.Status == "sealed" || b.Status == "on_kerb")
        .GroupBy(b => b.HouseholdId)
        .Select(g => new { HouseholdId = g.Key, Bags = g.Count(), OnKerb = g.Count(x => x.Status == "on_kerb") })
        .ToDictionaryAsync(x => x.HouseholdId);

    var suburbPools = residentialRows
        .Where(r => WaitlistDensity.CanAllocateSuburb(r.Suburb))
        .GroupBy(r => BinDayService.CanonicalSuburb(r.Suburb)!)
        .Select(g =>
        {
            var pendingContainers = g.Sum(x => Math.Max(0, x.PendingContainers));
            var bagsSealed = g.Sum(x => openBagsByHousehold.TryGetValue(x.Id, out var bc) ? bc.Bags : 0);
            var bagsOnKerb = g.Sum(x => openBagsByHousehold.TryGetValue(x.Id, out var bc) ? bc.OnKerb : 0);
            var sortersCount = g.Count();
            // Privacy floor: round suburb centroids to 2 decimal places (~1.1 km)
            // so a single-household suburb never reveals an exact house pin.
            var centroidLat = Math.Round(g.Average(x => x.Lat), 2);
            var centroidLng = Math.Round(g.Average(x => x.Lng), 2);
            var ready = WaitlistDensity.CanDispatch(pendingContainers, sortersCount);
            return new
            {
                suburb = g.Key,
                centroidLat,
                centroidLng,
                sortersCount,
                pendingContainers,
                targetContainers = WaitlistDensity.LiveThreshold,
                progressPct = Math.Min(100, (int)Math.Round(100.0 * pendingContainers / WaitlistDensity.LiveThreshold)),
                bagsSealed,
                bagsOnKerb,
                readyForRun = ready,
                estimatedRunnerBountyCents = Math.Max(pendingContainers, WaitlistDensity.LiveThreshold) * CrpSettlement.CrpRunnerTargetCentsPerContainer,
                estimatedSorterPoolCents = pendingContainers * CrpSettlement.CrpHouseholdCentsPerContainer,
            };
        })
        .OrderByDescending(p => p.pendingContainers)
        .ThenByDescending(p => p.sortersCount)
        .Take(30)
        .ToList();

    var activeSorters = await db.Profiles.CountAsync(p => p.TotalContainers > 0 || p.HouseholdId != null);
    var registeredRunners = await db.RunnerProfiles.CountAsync();
    var onlineCutoff = DateTime.UtcNow - PricingService.OnlineRunnerFreshness;
    var runnersOnline = await db.RunnerProfiles.CountAsync(
        rp => rp.IsOnline && rp.LastLocationAt != null && rp.LastLocationAt >= onlineCutoff);
    var totalContainersSorted = await db.Profiles.SumAsync(p => p.TotalContainers);
    var totalBagsOnKerb = await db.SortedBags.CountAsync(b => b.Status == "on_kerb");

    return Results.Ok(new
    {
        crpActive,
        rateCard = new
        {
            coexGrossCents = 17.68m,
            coexRefundCents = 10.00m,
            coexHandlingFeeCents = 7.68m,
            fullScaleSorterCents = CrpSettlement.CrpHouseholdCentsPerContainer,
            currentSorterCents = activeSorterRate,
            launchBonusCents = HouseholdCredit.CentsPerContainer + LaunchBonus.ExtraCentsPerContainer,
            launchBonusCap = LaunchBonus.CapFrom(cfg),
            containerMafiaCents = CrpSettlement.ContainerMafiaCentsPerContainer,
            runnerTargetCents = CrpSettlement.CrpRunnerTargetCentsPerContainer,
        },
        stats = new
        {
            activeSorters,
            registeredRunners,
            runnersOnline,
            totalContainersSorted,
            bagsOnKerb = totalBagsOnKerb,
            availableRunsCount = availableRuns.Count,
            formingSuburbsCount = suburbPools.Count,
        },
        availableRuns = availableRuns.Select(r => new
        {
            r.Id,
            r.AreaName,
            CentroidLat = Math.Round(r.CentroidLat, 2),
            CentroidLng = Math.Round(r.CentroidLng, 2),
            r.MaterialFocus,
            r.EstimatedContainers,
            r.EstimatedWeightKg,
            r.PerContainerCents,
            r.EstimatedPayoutCents,
            r.PricingTier,
            r.EstimatedDistanceKm,
            r.EstimatedDurationMin,
            StopCount = r.Stops.Count,
            r.ExpiresAt,
            r.Materials,
        }),
        suburbPools,
    });
});

var allowedRunnerVehicleTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
{
    "car", "ute", "van", "suv", "bike", "cargo_bike", "scooter", "walk", "truck",
};

static string SanitizeSingleLine(string? value, int maxLen)
{
    if (string.IsNullOrWhiteSpace(value)) return "";
    var cleaned = new string(value.Trim().Where(c => !char.IsControl(c)).ToArray());
    return cleaned.Length <= maxLen ? cleaned : cleaned[..maxLen];
}

// ── Runner: Register as runner ──
app.MapPost("/api/runner/register", async (HttpContext ctx, RunnerRegisterRequest req, GoodSortDbContext db, IConfiguration cfg) =>
{
    var profileId = ctx.GetCallerId();
    if (profileId is null) return Results.Unauthorized();
    var profile = await db.Profiles.FindAsync(profileId.Value);
    if (profile is null) return Results.NotFound("Profile not found");

    var vehicleType = string.IsNullOrWhiteSpace(req.VehicleType) ? "car" : req.VehicleType.Trim().ToLowerInvariant();
    if (!allowedRunnerVehicleTypes.Contains(vehicleType))
        return Results.BadRequest(new { error = "VehicleType must be one of: car, ute, van, suv, bike, cargo_bike, scooter, walk, truck." });

    if (req.CapacityBags is < 1 or > 100)
        return Results.BadRequest(new { error = "Bag capacity must be between 1 and 100." });
    if (req.ServiceRadiusKm is <= 0 or > 200 || (req.ServiceRadiusKm is double radius && !double.IsFinite(radius)))
        return Results.BadRequest(new { error = "Service radius must be between 1 and 200 km." });

    var existing = await db.RunnerProfiles.FirstOrDefaultAsync(rp => rp.ProfileId == profileId.Value);
    if (existing is not null)
    {
        if (!string.IsNullOrWhiteSpace(req.CoexSchemeId))
        {
            var trimmed = SanitizeSingleLine(req.CoexSchemeId, 32).ToUpperInvariant();
            existing.CoexSchemeId = trimmed.Length == 0 ? null : trimmed;
            await db.SaveChangesAsync();
        }
        return Results.Ok(existing);
    }

    var requireApproval = string.Equals(cfg["RUNNER_REQUIRE_APPROVAL"], "true", StringComparison.OrdinalIgnoreCase) && !profile.IsAdmin;
    var schemeId = SanitizeSingleLine(req.CoexSchemeId, 32).ToUpperInvariant();
    var runner = new RunnerProfile
    {
        ProfileId = profile.Id,
        VehicleType = vehicleType,
        VehicleMake = SanitizeSingleLine(req.VehicleMake, 80),
        VehicleRego = SanitizeSingleLine(req.VehicleRego, 16).ToUpperInvariant(),
        CapacityBags = req.CapacityBags ?? 10,
        ServiceRadiusKm = req.ServiceRadiusKm ?? 10.0,
        CoexSchemeId = schemeId.Length == 0 ? null : schemeId,
        ApprovalStatus = requireApproval ? "pending" : "approved",
        ApprovedAt = requireApproval ? null : DateTime.UtcNow,
    };
    profile.Role = "both";
    db.RunnerProfiles.Add(runner);
    await db.SaveChangesAsync();
    return Results.Created($"/api/runner/profile", runner);
}).RequireAuthorization();

// ── Runner: Get my profile ──
app.MapGet("/api/runner/profile/{profileId:guid}", async (HttpContext ctx, Guid profileId, GoodSortDbContext db) =>
{
    if (!ctx.IsOwnerOrAdmin(profileId)) return Results.Forbid();
    return await db.RunnerProfiles.Include(rp => rp.Profile).FirstOrDefaultAsync(rp => rp.ProfileId == profileId)
        is { } rp ? Results.Ok(rp) : Results.NotFound();
}).RequireAuthorization();

// ── Runner: Update profile ──
app.MapPatch("/api/runner/profile/{profileId:guid}", async (HttpContext ctx, Guid profileId, RunnerProfileUpdateRequest req, GoodSortDbContext db) =>
{
    if (!ctx.IsOwnerOrAdmin(profileId)) return Results.Forbid();
    string? normalizedVehicleType = null;
    if (req.VehicleType is not null)
    {
        normalizedVehicleType = req.VehicleType.Trim().ToLowerInvariant();
        if (!allowedRunnerVehicleTypes.Contains(normalizedVehicleType))
            return Results.BadRequest(new { error = "VehicleType must be one of: car, ute, van, suv, bike, cargo_bike, scooter, walk, truck." });
    }
    if (req.CapacityBags is < 1 or > 100)
        return Results.BadRequest(new { error = "Bag capacity must be between 1 and 100." });
    if (req.ServiceRadiusKm is <= 0 or > 200 || (req.ServiceRadiusKm is double radius && !double.IsFinite(radius)))
        return Results.BadRequest(new { error = "Service radius must be between 1 and 200 km." });
    var runner = await db.RunnerProfiles.FirstOrDefaultAsync(rp => rp.ProfileId == profileId);
    if (runner is null) return Results.NotFound();
    if (normalizedVehicleType is not null) runner.VehicleType = normalizedVehicleType;
    if (req.CapacityBags.HasValue) runner.CapacityBags = req.CapacityBags.Value;
    if (req.ServiceRadiusKm.HasValue) runner.ServiceRadiusKm = req.ServiceRadiusKm.Value;
    if (req.CoexSchemeId is not null)
    {
        var trimmed = SanitizeSingleLine(req.CoexSchemeId, 32).ToUpperInvariant();
        runner.CoexSchemeId = trimmed.Length == 0 ? null : trimmed;
    }
    await db.SaveChangesAsync();
    return Results.Ok(runner);
}).RequireAuthorization();

// ── Runner: Location heartbeat ──
app.MapPost("/api/runner/heartbeat", async (HttpContext ctx, RunnerHeartbeatRequest req, GoodSortDbContext db) =>
{
    // Caller-supplied ProfileId in body is ignored — spoofable, would let
    // anyone toggle another runner's online/location.
    var profileId = ctx.GetCallerId();
    if (profileId is null) return Results.Unauthorized();
    if (!double.IsFinite(req.Lat) || !double.IsFinite(req.Lng)
        || req.Lat is < -90 or > 90 || req.Lng is < -180 or > 180)
        return Results.BadRequest(new { error = "Valid lat and lng coordinates are required." });

    var runner = await db.RunnerProfiles.FirstOrDefaultAsync(rp => rp.ProfileId == profileId.Value);
    if (runner is null) return Results.NotFound();
    if (runner.ApprovalStatus != "approved")
    {
        if (runner.IsOnline)
        {
            runner.IsOnline = false;
            await db.SaveChangesAsync();
        }
        var msg = runner.ApprovalStatus == "suspended"
            ? "Your runner account is suspended. Contact hello@thegoodsort.org."
            : "Your runner account is pending approval. Ops will activate you shortly.";
        return Results.Json(new { error = msg, approvalStatus = runner.ApprovalStatus }, statusCode: StatusCodes.Status403Forbidden);
    }
    runner.IsOnline = req.IsOnline;
    runner.LastLat = req.Lat;
    runner.LastLng = req.Lng;
    runner.LastLocationAt = DateTime.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(new { online = runner.IsOnline });
}).RequireAuthorization();

// ── Marketplace: Get available runs near location ──
app.MapGet("/api/marketplace/runs", async (double lat, double lng, double? radiusKm, string? material, GoodSortDbContext db) =>
{
    if (!double.IsFinite(lat) || !double.IsFinite(lng) || lat is < -90 or > 90 || lng is < -180 or > 180)
        return Results.BadRequest(new { error = "Valid lat and lng coordinates are required." });
    if (radiusKm is double rk && (!double.IsFinite(rk) || rk <= 0))
        return Results.BadRequest(new { error = "Radius must be greater than 0 km." });

    var radius = Math.Clamp(radiusKm ?? 15.0, 0.5, 200.0);
    var q = db.Runs.Include(r => r.Stops)
        .Where(r => r.Status == "available" && r.ExpiresAt > DateTime.UtcNow);

    // Optional material filter — runners can browse by material type
    if (!string.IsNullOrEmpty(material))
        q = q.Where(r => r.MaterialFocus == material || r.MaterialFocus == "mixed");

    var runs = await q.ToListAsync();

    var nearby = runs
        .Select(r => new
        {
            Run = r,
            DistanceKm = HaversineKm(lat, lng, r.CentroidLat, r.CentroidLng)
        })
        .Where(x => x.DistanceKm <= radius)
        .OrderBy(x => x.DistanceKm)
        .Select(x =>
        {
            var m = x.Run.Materials;
            var total = m.Aluminium + m.Pet + m.Glass + m.Other;
            return new
            {
                x.Run.Id,
                x.Run.Status,
                x.Run.AreaName,
                CentroidLat = Math.Round(x.Run.CentroidLat, 2),
                CentroidLng = Math.Round(x.Run.CentroidLng, 2),
                x.Run.MaterialFocus,
                x.Run.EstimatedContainers,
                x.Run.EstimatedWeightKg,
                x.Run.PerContainerCents,
                x.Run.EstimatedPayoutCents,
                x.Run.PricingTier,
                x.Run.EstimatedDistanceKm,
                x.Run.EstimatedDurationMin,
                StopCount = x.Run.Stops.Count,
                DistanceKm = Math.Round(x.DistanceKm, 2),
                x.Run.ExpiresAt,
                x.Run.Materials,
                // Material percentages for the runner to see at a glance
                MaterialPct = total > 0 ? new
                {
                    aluminium = Math.Round(100.0 * m.Aluminium / total),
                    pet = Math.Round(100.0 * m.Pet / total),
                    glass = Math.Round(100.0 * m.Glass / total),
                    other = Math.Round(100.0 * m.Other / total),
                } : null,
                // Vehicle hint based on weight
                VehicleHint = x.Run.EstimatedWeightKg > 20 ? "car_or_ute"
                            : x.Run.EstimatedWeightKg > 5 ? "car_or_bike"
                            : "any",
            };
        })
        .ToList();

    return Results.Ok(nearby);
});

// ── Marketplace: Claim a run ──
app.MapPost("/api/marketplace/runs/{id:guid}/claim", async (HttpContext ctx, Guid id, MarketplaceClaimRequest req, GoodSortDbContext db, PricingService pricing) =>
{
    var profileId = ctx.GetCallerId();
    if (profileId is null) return Results.Unauthorized();
    var run = await db.Runs
        .Include(r => r.Stops.OrderBy(s => s.Sequence))
        .Include(r => r.DropPoint)
        .FirstOrDefaultAsync(r => r.Id == id);
    if (run is null || (run.Status != "available" && run.Status != "below_threshold"))
        return Results.BadRequest(new { error = "Run not available" });
    if (run.ExpiresAt <= DateTime.UtcNow)
        return Results.BadRequest(new { error = "Run expired" });

    var runner = await db.RunnerProfiles.FirstOrDefaultAsync(rp => rp.ProfileId == profileId.Value);
    if (runner is null)
        return Results.BadRequest(new { error = "Not registered as runner" });
    if (runner.ApprovalStatus == "suspended")
        return Results.Json(new { error = "Your runner account is suspended. Contact hello@thegoodsort.org." }, statusCode: StatusCodes.Status403Forbidden);
    if (runner.ApprovalStatus != "approved")
        return Results.Json(new { error = "Your runner account is pending approval. Ops will activate you shortly." }, statusCode: StatusCodes.Status403Forbidden);

    // Re-price with runner's level bonus, enforce one active run per runner (preventing
    // run hoarding and mass stop-coordinate scraping), then atomically claim the transition
    // so two runners tapping Claim at once never both receive the stop list.
    var result = await pricing.CalculateRate(run, runner);

    return await StatusClaim.WithUserGateAsync(runner.Id, () => Atomic.RunAsync<IResult>(db, async () =>
    {
        var alreadyHasActiveRun = await db.Runs.AsNoTracking().AnyAsync(r =>
            r.RunnerId == runner.Id
            && (r.Status == "claimed" || r.Status == "in_progress" || r.Status == "delivering"));
        if (alreadyHasActiveRun)
            return Results.BadRequest(new { error = "Finish or release your current active run before claiming another." });

        var won = await StatusClaim.TryAssignRunnerToRun(
            db, run.Id, runner.Id, result.PerContainerCents, result.EstimatedPayoutCents, result.PricingTier);
        if (!won)
            return Results.BadRequest(new { error = "Run has already been claimed by another runner." });

        run.PerContainerCents = result.PerContainerCents;
        run.EstimatedPayoutCents = result.EstimatedPayoutCents;
        run.PricingTier = result.PricingTier;
        run.RunnerId = runner.Id;
        run.Status = "claimed";
        run.ClaimedAt ??= DateTime.UtcNow;

        // Notify households on this run whose bags are not yet marked on the kerb
        var claimedRunId = run.Id;
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = app.Services.CreateScope();
                var notif = scope.ServiceProvider.GetRequiredService<NotificationService>();
                await notif.SendRunClaimedBagOutAlert(claimedRunId);
            }
            catch (Exception ex) { app.Logger.LogError(ex, "Run-claimed bag-out email failed for run {RunId}", claimedRunId); }
        });

        // Return run with stops and drop point (now includes lat/lng for navigation)
        return Results.Ok(run);
    }), ctx.RequestAborted);
}).RequireAuthorization();

// ── Marketplace: Release a claimed run (before collection starts) ──
app.MapPost("/api/marketplace/runs/{id:guid}/release", async (HttpContext ctx, Guid id, GoodSortDbContext db, PricingService pricing, IConfiguration cfg) =>
{
    var run = await db.Runs
        .Include(r => r.Stops.OrderBy(s => s.Sequence))
        .Include(r => r.DropPoint)
        .FirstOrDefaultAsync(r => r.Id == id);
    if (run is null) return Results.NotFound();
    if (!await CallerOwnsRun(ctx, run, db)) return Results.Forbid();
    if (run.Status != "claimed")
        return Results.BadRequest(new { error = "Only a claimed run that has not started can be released." });

    run.RunnerId = null;
    run.ClaimedAt = null;
    run.LastBriefedAt = null;
    if (run.ExpiresAt <= DateTime.UtcNow.AddHours(2))
        run.ExpiresAt = DateTime.UtcNow.AddHours(6);

    var minPayoutCents = RunGenerationService.ResolveMinPayoutCents(cfg);
    var repriced = await pricing.CalculateRate(run);
    run.PerContainerCents = repriced.PerContainerCents;
    run.EstimatedPayoutCents = repriced.EstimatedPayoutCents;
    run.PricingTier = repriced.PricingTier;
    run.LastPricedAt = DateTime.UtcNow;
    run.Status = repriced.EstimatedPayoutCents >= minPayoutCents
        ? "available"
        : "below_threshold";

    await db.SaveChangesAsync();
    return Results.Ok(new { released = true, id = run.Id, status = run.Status });
}).RequireAuthorization();

// ── Marketplace: Start a run ──
app.MapPost("/api/marketplace/runs/{id:guid}/start", async (HttpContext ctx, Guid id, GoodSortDbContext db) =>
{
    var run = await db.Runs
        .Include(r => r.Stops.OrderBy(s => s.Sequence))
        .Include(r => r.DropPoint)
        .FirstOrDefaultAsync(r => r.Id == id);
    if (run is null || run.Status != "claimed") return Results.BadRequest();
    if (!await CallerOwnsRun(ctx, run, db)) return Results.Forbid();
    run.Status = "in_progress";
    run.StartedAt = DateTime.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(run);
}).RequireAuthorization();

// ── Marketplace: Arrive at stop ──
app.MapPost("/api/marketplace/runs/{runId:guid}/stops/{stopId:guid}/arrive",
    async (HttpContext ctx, Guid runId, Guid stopId, GoodSortDbContext db) =>
{
    var run = await db.Runs.FindAsync(runId);
    if (run is null) return Results.NotFound();
    if (!await CallerOwnsRun(ctx, run, db)) return Results.Forbid();
    if (run.Status != "in_progress") return Results.BadRequest(new { error = "Run is not in progress." });
    var stop = await db.RunStops.FirstOrDefaultAsync(s => s.RunId == runId && s.Id == stopId);
    if (stop is null) return Results.NotFound();
    if (stop.Status == "arrived") return Results.Ok(stop);
    if (stop.Status != "pending") return Results.BadRequest();
    stop.Status = "arrived";
    stop.ArrivedAt ??= DateTime.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(stop);
}).RequireAuthorization();

// ── Marketplace: Kerbside bag manifest for a stop (run's runner or admin) ──
app.MapGet("/api/marketplace/runs/{runId:guid}/stops/{stopId:guid}/manifest",
    async (HttpContext ctx, Guid runId, Guid stopId, GoodSortDbContext db) =>
{
    var run = await db.Runs.AsNoTracking().FirstOrDefaultAsync(r => r.Id == runId);
    if (run is null) return Results.NotFound();
    if (!await CallerOwnsRun(ctx, run, db)) return Results.Forbid();

    var stop = await db.RunStops.AsNoTracking().FirstOrDefaultAsync(s => s.RunId == runId && s.Id == stopId);
    if (stop is null) return Results.NotFound();

    var bin = await db.Bins.AsNoTracking().FirstOrDefaultAsync(b => b.Id == stop.BinId);
    if (bin?.HouseholdId is not Guid hhId)
    {
        return Results.Ok(new
        {
            stopId = stop.Id,
            scannedBagCount = stop.ScannedBagCount,
            bags = Array.Empty<object>(),
        });
    }

    var bags = await db.SortedBags.AsNoTracking()
        .Where(b => b.HouseholdId == hhId
                    && b.Status != "cancelled"
                    && (b.RunStopId == stopId || (b.RunId == null && b.Status != "verified")))
        .OrderByDescending(b => b.Status == "on_kerb")
        .ThenByDescending(b => b.CreatedAt)
        .Select(b => new
        {
            b.Id,
            b.Code,
            b.Stream,
            b.DeclaredContainers,
            b.LinkedScanCount,
            b.VerifiedContainers,
            b.ContaminationFlag,
            b.DiscrepancyCode,
            b.DiscrepancyNote,
            b.Status,
            b.KerbAt,
            b.PickedUpAt,
        })
        .ToListAsync();

    return Results.Ok(new
    {
        stopId = stop.Id,
        scannedBagCount = stop.ScannedBagCount,
        bags,
    });
}).RequireAuthorization();

// ── Marketplace: Runner scans & verifies a physical QR bag tag at kerbside ──
app.MapPost("/api/marketplace/runs/{runId:guid}/stops/{stopId:guid}/scan-bag",
    async (HttpContext ctx, Guid runId, Guid stopId, RunnerScanBagRequest req, GoodSortDbContext db) =>
{
    var run = await db.Runs.Include(r => r.Stops).FirstOrDefaultAsync(r => r.Id == runId);
    if (run is null || run.Status != "in_progress")
        return Results.BadRequest(new { error = "Run is not in progress." });
    if (!await CallerOwnsRun(ctx, run, db)) return Results.Forbid();

    var stop = run.Stops.FirstOrDefault(s => s.Id == stopId);
    if (stop is null || (stop.Status != "pending" && stop.Status != "arrived"))
        return Results.BadRequest(new { error = "Stop is not active." });

    var code = (req.BagCode ?? "").Trim().ToUpperInvariant();
    if (string.IsNullOrEmpty(code))
        return Results.BadRequest(new { error = "Bag code is required." });

    var bag = await db.SortedBags.FirstOrDefaultAsync(b => b.Code == code);
    if (bag is null)
        return Results.NotFound(new { error = $"Bag tag {code} not found." });
    if (bag.Status is "cancelled" or "verified")
        return Results.BadRequest(new { error = $"Bag {code} is already {bag.Status}." });
    if (bag.Status == "picked_up" && bag.RunStopId is Guid existingStopId && existingStopId != stop.Id)
        return Results.BadRequest(new { error = $"Bag {code} has already been picked up on another stop." });

    var bin = await db.Bins.AsNoTracking().FirstOrDefaultAsync(b => b.Id == stop.BinId);
    if (bin?.HouseholdId is Guid stopHhId && bag.HouseholdId != stopHhId)
        return Results.BadRequest(new { error = "Bag tag belongs to a different household stop." });

    var discrepancyCode = string.IsNullOrWhiteSpace(req.DiscrepancyCode)
        ? "none"
        : req.DiscrepancyCode.Trim().ToLowerInvariant();
    if (!CrpSettlement.ValidDiscrepancyCodes.Contains(discrepancyCode))
        return Results.BadRequest(new { error = "Invalid discrepancy code." });

    if (bag.Status != "picked_up")
        stop.ScannedBagCount += 1;

    bag.Status = "picked_up";
    bag.PickedUpAt ??= DateTime.UtcNow;
    bag.RunId = run.Id;
    bag.RunStopId = stop.Id;
    bag.PickedUpByRunnerId = run.RunnerId;
    bag.VerifiedContainers = req.VerifiedContainers.HasValue
        ? Math.Clamp(req.VerifiedContainers.Value, 0, maxContainersPerStop)
        : bag.DeclaredContainers;
    bag.ContaminationFlag = req.ContaminationFlag ?? false;
    bag.DiscrepancyCode = discrepancyCode;
    bag.DiscrepancyNote = string.IsNullOrWhiteSpace(req.DiscrepancyNote)
        ? null
        : req.DiscrepancyNote.Trim()[..Math.Min(280, req.DiscrepancyNote.Trim().Length)];

    if (stop.Status == "pending")
    {
        stop.Status = "arrived";
        stop.ArrivedAt ??= DateTime.UtcNow;
    }
    if (bag.ContaminationFlag) stop.ContaminationFlag = true;
    if (discrepancyCode != "none" && string.IsNullOrEmpty(stop.DiscrepancyCode))
        stop.DiscrepancyCode = discrepancyCode;

    await db.SaveChangesAsync();

    var stopVerifiedTotal = await db.SortedBags.AsNoTracking()
        .Where(b => b.RunStopId == stop.Id && b.Status == "picked_up")
        .SumAsync(b => b.VerifiedContainers ?? b.DeclaredContainers);

    return Results.Ok(new
    {
        bag = new
        {
            bag.Id,
            bag.Code,
            bag.Stream,
            bag.DeclaredContainers,
            bag.LinkedScanCount,
            bag.VerifiedContainers,
            bag.ContaminationFlag,
            bag.DiscrepancyCode,
            bag.DiscrepancyNote,
            bag.Status,
        },
        scannedBagCount = stop.ScannedBagCount,
        stopVerifiedTotal,
    });
}).RequireAuthorization();

// ── Marketplace: Complete pickup at stop (with photo & optional discrepancy manifest) ──
app.MapPost("/api/marketplace/runs/{runId:guid}/stops/{stopId:guid}/pickup",
    async (HttpContext ctx, Guid runId, Guid stopId, RunStopPickupRequest req, GoodSortDbContext db) =>
{
    var run = await db.Runs
        .Include(r => r.Stops.OrderBy(s => s.Sequence))
        .Include(r => r.DropPoint)
        .FirstOrDefaultAsync(r => r.Id == runId);
    if (run is null || run.Status != "in_progress") return Results.BadRequest();
    if (!await CallerOwnsRun(ctx, run, db)) return Results.Forbid();

    var stop = run.Stops.FirstOrDefault(s => s.Id == stopId);
    if (stop is null || (stop.Status != "pending" && stop.Status != "arrived")) return Results.BadRequest();

    if (!string.IsNullOrWhiteSpace(req.DiscrepancyCode))
    {
        var code = req.DiscrepancyCode.Trim().ToLowerInvariant();
        if (!CrpSettlement.ValidDiscrepancyCodes.Contains(code))
            return Results.BadRequest(new { error = "Invalid discrepancy code." });
        stop.DiscrepancyCode = code;
    }
    if (!string.IsNullOrWhiteSpace(req.DiscrepancyNote))
    {
        var note = req.DiscrepancyNote.Trim();
        stop.DiscrepancyNote = note[..Math.Min(280, note.Length)];
    }
    if (req.ContaminationFlag.HasValue)
        stop.ContaminationFlag = req.ContaminationFlag.Value;

    string? validatedPhotoUrl = null;
    if (!string.IsNullOrWhiteSpace(req.PhotoUrl))
    {
        var candidate = req.PhotoUrl.Trim();
        if (candidate.Length > 2_000_000 || candidate.Contains('<') || candidate.Contains('>'))
            return Results.BadRequest(new { error = "Invalid pickup photo URL." });
        var isSafeHttps = candidate.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
            && Uri.TryCreate(candidate, UriKind.Absolute, out var parsedUri)
            && parsedUri.Scheme == Uri.UriSchemeHttps;
        var isSafeDataImage = candidate.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase);
        if (!isSafeHttps && !isSafeDataImage)
            return Results.BadRequest(new { error = "Pickup photo must be an https:// URL or data:image/ payload." });
        validatedPhotoUrl = candidate;
    }

    stop.Status = "picked_up";
    stop.PickedUpAt = DateTime.UtcNow;
    stop.ActualContainers = Math.Clamp(req.ActualContainers, 0, maxContainersPerStop);
    if (validatedPhotoUrl is not null) stop.PhotoUrl = validatedPhotoUrl;

    await db.SaveChangesAsync();
    return Results.Ok(run);
}).RequireAuthorization();

// ── Marketplace: Skip a stop ──
app.MapPost("/api/marketplace/runs/{runId:guid}/stops/{stopId:guid}/skip",
    async (HttpContext ctx, Guid runId, Guid stopId, GoodSortDbContext db) =>
{
    var run = await db.Runs
        .Include(r => r.Stops.OrderBy(s => s.Sequence))
        .Include(r => r.DropPoint)
        .FirstOrDefaultAsync(r => r.Id == runId);
    if (run is null || run.Status != "in_progress") return Results.BadRequest();
    if (!await CallerOwnsRun(ctx, run, db)) return Results.Forbid();

    var stop = run.Stops.FirstOrDefault(s => s.Id == stopId);
    if (stop is null || (stop.Status != "pending" && stop.Status != "arrived")) return Results.BadRequest();

    stop.Status = "skipped";
    await db.SaveChangesAsync();
    return Results.Ok(run);
}).RequireAuthorization();

// ── Marketplace: Mark run as delivering (heading to drop point) ──
app.MapPost("/api/marketplace/runs/{id:guid}/deliver", async (HttpContext ctx, Guid id, GoodSortDbContext db) =>
{
    var run = await db.Runs
        .Include(r => r.Stops.OrderBy(s => s.Sequence))
        .Include(r => r.DropPoint)
        .FirstOrDefaultAsync(r => r.Id == id);
    if (run is null || run.Status != "in_progress") return Results.BadRequest();
    if (!await CallerOwnsRun(ctx, run, db)) return Results.Forbid();

    // Auto-check: all stops must be picked_up or skipped
    if (run.Stops.Any(s => s.Status == "pending" || s.Status == "arrived"))
        return Results.BadRequest("Not all stops completed");

    run.Status = "delivering";
    await db.SaveChangesAsync();
    return Results.Ok(run);
}).RequireAuthorization();

// ── Marketplace: Complete delivery at drop point (with optional CRP/depot docket verification) ──
app.MapPost("/api/marketplace/runs/{id:guid}/complete", async (HttpContext ctx, Guid id, GoodSortDbContext db) =>
{
    var run = await db.Runs
        .Include(r => r.Stops.OrderBy(s => s.Sequence))
        .Include(r => r.DropPoint)
        .FirstOrDefaultAsync(r => r.Id == id);
    if (run is null || run.Status != "delivering") return Results.BadRequest();
    if (!await CallerOwnsRun(ctx, run, db)) return Results.Forbid();

    CompleteRunRequest? req = null;
    if (ctx.Request.ContentLength is > 0 || (ctx.Request.ContentType?.Contains("json", StringComparison.OrdinalIgnoreCase) ?? false))
    {
        try { req = await ctx.Request.ReadFromJsonAsync<CompleteRunRequest>(); }
        catch { /* empty body is allowed for backwards compatibility */ }
    }

    var kerbsideSum = run.Stops.Where(s => s.Status == "picked_up").Sum(s => Math.Max(0, s.ActualContainers ?? s.EstimatedContainers));
    if (req?.DepotVerifiedContainers is int dvc && dvc >= 0)
    {
        // Non-admin runners cannot self-inflate DepotVerifiedContainers above kerbside/estimated volume.
        // Only an admin verifying the depot docket can override above kerbside volume.
        var maxCap = ctx.IsAdmin()
            ? Math.Max(maxContainersPerStop * Math.Max(1, run.Stops.Count), 10000)
            : Math.Max(0, Math.Max(kerbsideSum, run.EstimatedContainers));
        run.DepotVerifiedContainers = Math.Clamp(dvc, 0, maxCap);
    }
    if (!string.IsNullOrWhiteSpace(req?.CoexDocketRef))
    {
        var docket = req.CoexDocketRef.Trim();
        run.CoexDocketRef = docket[..Math.Min(64, docket.Length)];
    }

    run.Status = "completed";
    run.CompletedAt = DateTime.UtcNow;
    run.DeliveredAt = DateTime.UtcNow;
    run.ActualContainers = run.DepotVerifiedContainers ?? kerbsideSum;

    await db.SaveChangesAsync();
    return Results.Ok(run);
}).RequireAuthorization();

// ── Marketplace: Settle a completed run (Admin docket verification gate ONLY) ──
app.MapPost("/api/marketplace/runs/{id:guid}/settle", async (HttpContext ctx, Guid id, GoodSortDbContext db, RunnerService runnerService, IConfiguration cfg) =>
{
    // Hard admin gate: runners may NEVER self-settle ClearedCents without staff docket verification.
    if (!ctx.IsAdmin()) return Results.Forbid();

    var run = await db.Runs.Include(r => r.Stops).Include(r => r.DropPoint).FirstOrDefaultAsync(r => r.Id == id);
    if (run is null || run.Status != "completed") return Results.BadRequest();

    CompleteRunRequest? adminDocketOverride = null;
    if (ctx.Request.ContentLength is > 0 || (ctx.Request.ContentType?.Contains("json", StringComparison.OrdinalIgnoreCase) ?? false))
    {
        try { adminDocketOverride = await ctx.Request.ReadFromJsonAsync<CompleteRunRequest>(); }
        catch { /* empty body uses run's recorded DepotVerifiedContainers */ }
    }

    return await Atomic.RunAsync(db, async () =>
    {
    if (!await StatusClaim.TryClaimRun(db, run.Id, from: "completed", to: "settled"))
        return Results.BadRequest(new { error = "This run has already been settled." });

    var maxAdminCap = Math.Max(maxContainersPerStop * Math.Max(1, run.Stops.Count), 10000);
    if (adminDocketOverride?.DepotVerifiedContainers is int overrideDvc && overrideDvc >= 0)
    {
        run.DepotVerifiedContainers = Math.Clamp(overrideDvc, 0, maxAdminCap);
    }
    if (!string.IsNullOrWhiteSpace(adminDocketOverride?.CoexDocketRef))
    {
        var docket = adminDocketOverride.CoexDocketRef.Trim();
        run.CoexDocketRef = docket[..Math.Min(64, docket.Length)];
    }

    var crpActive = CrpSettlement.IsCrpActive(cfg);
    var householdRateCents = CrpSettlement.ActiveHouseholdRateCents(cfg);

    var pickedUpStops = run.Stops.Where(s => s.Status == "picked_up").OrderBy(s => s.Sequence).ThenBy(s => s.Id).ToList();
    var kerbsideSum = pickedUpStops.Sum(s => Math.Max(0, s.ActualContainers ?? s.EstimatedContainers));
    var verifiedRunTotal = Math.Max(0, run.DepotVerifiedContainers ?? run.ActualContainers);

    // Reconcile runner AND household/Mafia payouts strictly to depot-verified count:
    // if the depot rejected contaminated/empty bags (verifiedRunTotal < kerbsideSum),
    // scale each stop's payable container count proportionally via largest-remainder
    // integer allocation so total paid containers across all stops never exceeds verifiedRunTotal.
    run.ActualContainers = verifiedRunTotal;
    run.ActualPayoutCents = verifiedRunTotal * run.PerContainerCents;
    run.Status = "settled";
    run.SettledAt ??= DateTime.UtcNow;

    var payableByStopId = new Dictionary<Guid, int>(pickedUpStops.Count);
    if (kerbsideSum <= 0 || verifiedRunTotal <= 0)
    {
        foreach (var s in pickedUpStops) payableByStopId[s.Id] = 0;
    }
    else if (verifiedRunTotal >= kerbsideSum)
    {
        foreach (var s in pickedUpStops)
            payableByStopId[s.Id] = Math.Max(0, s.ActualContainers ?? s.EstimatedContainers);
    }
    else
    {
        var shares = pickedUpStops.Select(s =>
        {
            var raw = Math.Max(0, s.ActualContainers ?? s.EstimatedContainers);
            var numer = (long)raw * verifiedRunTotal;
            return new
            {
                s.Id,
                Floor = (int)(numer / kerbsideSum),
                Remainder = numer % kerbsideSum,
            };
        }).ToList();
        var remainderLeft = verifiedRunTotal - shares.Sum(x => x.Floor);
        foreach (var sh in shares) payableByStopId[sh.Id] = sh.Floor;
        foreach (var sh in shares.OrderByDescending(x => x.Remainder).ThenBy(x => x.Id).Take(Math.Max(0, remainderLeft)))
            payableByStopId[sh.Id]++;
    }

    // Generate rating
    var rating = await runnerService.GenerateRating(run);

    // Update runner stats (level, streak, badges, efficiency)
    await runnerService.UpdateRunnerStats(run);

    // Credit the runner's profile
    if (run.RunnerId.HasValue)
    {
        var runner = await db.RunnerProfiles.Include(rp => rp.Profile).FirstOrDefaultAsync(rp => rp.Id == run.RunnerId);
        if (runner?.Profile is not null)
            runner.Profile.ClearedCents += run.ActualPayoutCents;
    }

    var runBags = await db.SortedBags.Where(b => b.RunId == run.Id).ToListAsync();
    foreach (var bag in runBags)
    {
        bag.Status = "verified";
        bag.VerifiedAt ??= DateTime.UtcNow;
        bag.VerifiedContainers ??= bag.DeclaredContainers;
    }

    var creditedHouseholds = new List<Household>();
    var totalHouseholdPayoutCents = 0;
    var totalMafiaCents = 0;

    foreach (var stop in pickedUpStops)
    {
        var bin = await db.Bins.FindAsync(stop.BinId);
        if (bin is null) continue;

        var wasNeverCollected = bin.LastCollectedAt is null;

        var rawCollectedCount = Math.Max(0, stop.ActualContainers ?? stop.EstimatedContainers);
        var payableCount = payableByStopId.GetValueOrDefault(stop.Id, 0);

        bin.PendingContainers = Math.Max(0, bin.PendingContainers - rawCollectedCount);
        bin.PendingValueCents = bin.PendingContainers * householdRateCents;
        bin.LastCollectedAt = DateTime.UtcNow;
        if (bin.PendingContainers == 0) bin.Materials = new MaterialBreakdown();

        if (bin.HouseholdId.HasValue)
        {
            var hh = await db.Households.Include(h => h.Members).FirstOrDefaultAsync(h => h.Id == bin.HouseholdId);
            if (hh is null) continue;

            var isFirstHouseholdPickup = wasNeverCollected;

            var pendingScans = await db.Scans
                .Where(s => s.HouseholdId == hh.Id && s.Status == "pending")
                .ToListAsync();
            var payees = hh.Members.ToList();
            foreach (var scan in pendingScans)
            {
                if (payees.Any(m => m.Id == scan.UserId)) continue;
                var extra = await db.Profiles.FindAsync(scan.UserId);
                if (extra is not null) payees.Add(extra);
            }
            var clearedBefore = payees.Sum(m => m.ClearedCents);
            HouseholdCredit.ApplyPickup(payees, pendingScans, payableCount, householdRateCents);
            var clearedAfter = payees.Sum(m => m.ClearedCents);
            totalHouseholdPayoutCents += Math.Max(0, clearedAfter - clearedBefore);

            // Neighbour referrals earn Good Sort Points only (0¢ cash signup bonus, 0¢/can cash override).
            var referredMember = payees.FirstOrDefault(m => m.ReferrerId.HasValue && m.ReferrerId.Value != m.Id);
            if (referredMember?.ReferrerId is Guid referrerId && payableCount > 0)
            {
                var mafiaCommission = HouseholdCredit.ReferralCommissionForPickup(payableCount);
                if (mafiaCommission > 0)
                {
                    var referrer = await db.Profiles.FindAsync(referrerId);
                    if (referrer is not null)
                    {
                        referrer.ClearedCents += mafiaCommission;
                        totalMafiaCents += mafiaCommission;
                    }
                }
            }

            hh.PendingContainers = Math.Max(0, hh.PendingContainers - rawCollectedCount);
            hh.PendingValueCents = hh.PendingContainers * householdRateCents;
            hh.EstimatedBags = (int)Math.Ceiling(hh.PendingContainers / 150.0);
            hh.LastPickupAt = DateTime.UtcNow;
            if (hh.PendingContainers == 0) hh.Materials = new MaterialBreakdown();

            var hasRemainingKerbBags = await db.SortedBags.AnyAsync(b =>
                b.HouseholdId == hh.Id && b.Status == "on_kerb" && b.RunId != run.Id);
            if (!hasRemainingKerbBags
                && (hh.BinIsOutAt is null || stop.PickedUpAt is null || hh.BinIsOutAt <= stop.PickedUpAt))
            {
                hh.BinIsOut = false;
                hh.BinIsOutAt = null;
            }

            if (payableCount > 0)
                creditedHouseholds.Add(hh);
        }
    }

    var discrepancyStops = run.Stops.Count(s =>
        s.ContaminationFlag || (!string.IsNullOrEmpty(s.DiscrepancyCode) && s.DiscrepancyCode != "none"));

    var ledger = CrpSettlement.BuildLedger(
        runId: run.Id,
        areaName: run.AreaName,
        crpActive: crpActive,
        verifiedContainers: run.DepotVerifiedContainers ?? run.ActualContainers,
        bagsVerified: runBags.Count,
        discrepancyStops: discrepancyStops,
        householdPayoutCents: totalHouseholdPayoutCents,
        containerMafiaCents: totalMafiaCents,
        runnerPayoutCents: run.ActualPayoutCents,
        coexDocketRef: run.CoexDocketRef);

    db.RunSettlementLedgers.Add(ledger);

    await db.SaveChangesAsync();

    // Fire-and-forget post-pickup emails
    _ = Task.Run(async () =>
    {
        try
        {
            using var scope = app.Services.CreateScope();
            var notif = scope.ServiceProvider.GetRequiredService<NotificationService>();
            foreach (var hh in creditedHouseholds) await notif.SendPickupConfirmation(hh.Id);
        }
        catch (Exception ex) { app.Logger.LogError(ex, "Post-pickup email burst failed"); }
    });

    return Results.Ok(new
    {
        run.Id,
        run.ActualPayoutCents,
        run.ActualContainers,
        rating = rating.Stars,
        householdsCredited = creditedHouseholds.Count,
        settlementMode = ledger.SettlementMode,
        bagsVerified = ledger.BagsVerified,
        householdPayoutCents = ledger.HouseholdPayoutCents,
        containerMafiaCents = ledger.ContainerMafiaCents,
        grossRevenueDollars = CrpSettlement.BasisPointsToDollars(ledger.GrossRevenueBasisPoints),
        proFormaCoexGrossDollars = CrpSettlement.BasisPointsToDollars(ledger.ProFormaCoexGrossBasisPoints),
        netMarginDollars = CrpSettlement.BasisPointsToDollars(ledger.NetMarginBasisPoints),
    });
    });
}).RequireAuthorization();

// ── Runner: My runs ──
app.MapGet("/api/runner/runs/{profileId:guid}", async (HttpContext ctx, Guid profileId, string? status, GoodSortDbContext db) =>
{
    // Owner or admin only — Stops carry household pickup coordinates, and
    // profileId is the same GUID as the public ?r= referral parameter.
    if (!ctx.IsOwnerOrAdmin(profileId)) return Results.Forbid();
    var runner = await db.RunnerProfiles.FirstOrDefaultAsync(rp => rp.ProfileId == profileId);
    if (runner is null) return Results.NotFound();

    var q = db.Runs.Include(r => r.Stops).Where(r => r.RunnerId == runner.Id);
    if (!string.IsNullOrEmpty(status)) q = q.Where(r => r.Status == status);
    return Results.Ok(await q.OrderByDescending(r => r.CreatedAt).Take(50).ToListAsync());
}).RequireAuthorization();

// ── Runner: My active run ──
app.MapGet("/api/runner/active/{profileId:guid}", async (HttpContext ctx, Guid profileId, GoodSortDbContext db) =>
{
    // Owner or admin only — the active run exposes every stop's lat/lng.
    if (!ctx.IsOwnerOrAdmin(profileId)) return Results.Forbid();
    var runner = await db.RunnerProfiles.FirstOrDefaultAsync(rp => rp.ProfileId == profileId);
    if (runner is null) return Results.NotFound();

    var active = await db.Runs
        .Include(r => r.Stops.OrderBy(s => s.Sequence))
        .Include(r => r.DropPoint)
        .Where(r => r.RunnerId == runner.Id && (r.Status == "claimed" || r.Status == "in_progress" || r.Status == "delivering"))
        .FirstOrDefaultAsync();

    return active is not null ? Results.Ok(active) : Results.NotFound();
}).RequireAuthorization();

// ── Gamification: Earnings summary ──
app.MapGet("/api/runner/earnings/{profileId:guid}", async (HttpContext ctx, Guid profileId, GoodSortDbContext db) =>
{
    // Owner or admin only — earnings are personal financial data.
    if (!ctx.IsOwnerOrAdmin(profileId)) return Results.Forbid();
    var runner = await db.RunnerProfiles.FirstOrDefaultAsync(rp => rp.ProfileId == profileId);
    if (runner is null) return Results.NotFound();

    // Brisbane business day (UTC+10), not UTC midnight (which resets at 10:00 AM AEST).
    var todayStart = BrisbaneTime.StartOfTodayUtc();
    var weekStart = BrisbaneTime.StartOfWeekUtc();

    var todayEarnings = await db.Runs
        .Where(r => r.RunnerId == runner.Id && r.Status == "settled" && r.SettledAt >= todayStart)
        .SumAsync(r => r.ActualPayoutCents);

    var weekEarnings = await db.Runs
        .Where(r => r.RunnerId == runner.Id && r.Status == "settled" && r.SettledAt >= weekStart)
        .SumAsync(r => r.ActualPayoutCents);

    return Results.Ok(new
    {
        runner.LifetimeEarningsCents,
        todayEarnings,
        weekEarnings,
        runner.TotalRuns,
        runner.TotalContainersCollected,
        runner.Rating,
        runner.Level,
        runner.CurrentStreakDays,
        runner.LongestStreakDays,
        runner.EfficiencyScore,
        runner.Badges,
    });
}).RequireAuthorization();

// ── Gamification: Leaderboard ──
app.MapGet("/api/runner/leaderboard", async (string? period, int? limit, RunnerService runnerService) =>
    Results.Ok(await runnerService.GetLeaderboard(period ?? "all", limit ?? 20)));

// ── Admin: Pricing config ──
app.MapGet("/api/admin/pricing", async (PricingService pricing) =>
    Results.Ok(await pricing.GetActiveConfig())).RequireAuthorization(AuthHelpers.AdminPolicy);

app.MapPatch("/api/admin/pricing", async (PricingConfig update, GoodSortDbContext db) =>
{
    var config = await db.PricingConfigs.FirstOrDefaultAsync(pc => pc.IsActive);
    if (config is null) return Results.NotFound();

    // Sanity-check before writing. Admin-only is not the same as typo-free,
    // and this is the one setting that multiplies every driver payout — an
    // inverted floor and ceiling silently disables the ceiling rather than
    // erroring. See PricingBounds.
    if (PricingBounds.Reject(update) is string reason)
        return Results.BadRequest(new { error = reason });

    // Update all validated fields
    config.FloorCents = update.FloorCents;
    config.CeilingCents = update.CeilingCents;
    config.BaseCents = update.BaseCents;
    config.DistanceEfficiencyWeight = update.DistanceEfficiencyWeight;
    config.BinDensityWeight = update.BinDensityWeight;
    config.SupplyDemandWeight = update.SupplyDemandWeight;
    config.TimeOfDayWeight = update.TimeOfDayWeight;
    config.MaterialMixWeight = update.MaterialMixWeight;
    config.ScrapPriceWeight = update.ScrapPriceWeight;
    config.MorningSurge = update.MorningSurge;
    config.AfternoonNormal = update.AfternoonNormal;
    config.EveningSurge = update.EveningSurge;
    config.NightDiscount = update.NightDiscount;
    config.BronzeBonus = update.BronzeBonus;
    config.SilverBonus = update.SilverBonus;
    config.GoldBonus = update.GoldBonus;
    config.PlatinumBonus = update.PlatinumBonus;
    config.AluminiumSpotCents = update.AluminiumSpotCents;
    config.PetSpotCents = update.PetSpotCents;
    config.GlassSpotCents = update.GlassSpotCents;
    config.UpdatedAt = DateTime.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(config);
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Simulate pricing for a run ──
app.MapPost("/api/admin/pricing/simulate", async (PricingSimulateRequest req, PricingService pricing) =>
{
    if (req.Containers < 0 || req.Containers > 100_000)
        return Results.BadRequest(new { error = "Containers must be between 0 and 100,000." });
    if (!double.IsFinite(req.DistanceKm) || req.DistanceKm < 0 || req.DistanceKm > 1_000)
        return Results.BadRequest(new { error = "DistanceKm must be a finite number between 0 and 1,000." });
    if (req.StopCount < 0 || req.StopCount > 500)
        return Results.BadRequest(new { error = "StopCount must be between 0 and 500." });

    var simulatedRun = new Run
    {
        EstimatedContainers = req.Containers,
        EstimatedDistanceKm = req.DistanceKm,
        Materials = new MaterialBreakdown
        {
            Aluminium = (int)(req.Containers * 0.4),
            Pet = (int)(req.Containers * 0.3),
            Glass = (int)(req.Containers * 0.2),
            Other = (int)(req.Containers * 0.1),
        },
    };
    // Add fake stops for density calculation
    for (var i = 0; i < req.StopCount; i++)
        simulatedRun.Stops.Add(new RunStop());

    var result = await pricing.CalculateRate(simulatedRun);
    return Results.Ok(result);
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Re-price all open unclaimed runs immediately after pricing changes ──
app.MapPost("/api/admin/pricing/reprice", async (PricingService pricing, IConfiguration cfg) =>
{
    var minPayoutCents = RunGenerationService.ResolveMinPayoutCents(cfg);
    var repricedRuns = await pricing.RepriceAvailableRuns(minPayoutCents, allowDecrease: true);
    return Results.Ok(new { repricedRuns });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Runner fleet roster & status summary ──
app.MapGet("/api/admin/runners", async (string? q, string? status, int? limit, GoodSortDbContext db, IConfiguration cfg) =>
{
    var safeLimit = Math.Clamp(limit ?? 200, 1, 1000);
    var now = DateTime.UtcNow;
    var onlineCutoff = now - PricingService.OnlineRunnerFreshness;

    var allRunners = await db.RunnerProfiles
        .Include(rp => rp.Profile)
            .ThenInclude(p => p.Household)
        .AsNoTracking()
        .ToListAsync();

    var activeRunStatuses = new[] { "claimed", "in_progress", "delivering" };
    var activeRuns = await db.Runs
        .Include(r => r.Stops)
        .Where(r => activeRunStatuses.Contains(r.Status) && r.RunnerId != null)
        .AsNoTracking()
        .ToListAsync();
    var activeRunByRunnerId = activeRuns
        .GroupBy(r => r.RunnerId!.Value)
        .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.StartedAt ?? x.ClaimedAt ?? x.CreatedAt).First());

    var unclaimedRunsCount = await db.Runs.CountAsync(r => r.Status == "available" || r.Status == "below_threshold");
    var completedAwaitingSettleCount = await db.Runs.CountAsync(r => r.Status == "completed");

    var rows = allRunners.Select(rp =>
    {
        var p = rp.Profile;
        var approval = string.IsNullOrWhiteSpace(rp.ApprovalStatus) ? "approved" : rp.ApprovalStatus;
        var effectiveOnline = rp.IsOnline
            && approval == "approved"
            && rp.LastLocationAt.HasValue
            && rp.LastLocationAt.Value >= onlineCutoff;
        var hasPayoutDetails = !string.IsNullOrWhiteSpace(p.PayIdValue)
            || (!string.IsNullOrWhiteSpace(p.BankBsb) && !string.IsNullOrWhiteSpace(p.BankAccountNumber));
        activeRunByRunnerId.TryGetValue(rp.Id, out var activeRun);
        var activeAnchor = activeRun is null ? (DateTime?)null : (activeRun.StartedAt ?? activeRun.ClaimedAt ?? activeRun.CreatedAt);
        var stuckMinutes = activeAnchor.HasValue ? Math.Max(0, (int)Math.Floor((now - activeAnchor.Value).TotalMinutes)) : 0;

        return new
        {
            id = rp.Id,
            profileId = rp.ProfileId,
            name = p.Name,
            email = p.Email,
            suburb = BinDayService.CanonicalSuburb(p.Household?.Suburb) ?? p.Household?.Suburb,
            isAdmin = p.IsAdmin,
            approvalStatus = approval,
            approvedAt = rp.ApprovedAt,
            suspendedAt = rp.SuspendedAt,
            adminNote = rp.AdminNote,
            vehicleType = rp.VehicleType,
            vehicleMake = rp.VehicleMake,
            vehicleRego = rp.VehicleRego,
            capacityBags = rp.CapacityBags,
            serviceRadiusKm = rp.ServiceRadiusKm,
            coexSchemeId = rp.CoexSchemeId,
            isOnline = effectiveOnline,
            rawIsOnline = rp.IsOnline,
            lastLat = rp.LastLat,
            lastLng = rp.LastLng,
            lastLocationAt = rp.LastLocationAt,
            level = rp.Level,
            rating = Math.Round(rp.Rating, 2),
            totalRatings = rp.TotalRatings,
            totalRuns = rp.TotalRuns,
            totalContainersCollected = rp.TotalContainersCollected,
            lifetimeEarningsCents = rp.LifetimeEarningsCents,
            clearedCents = p.ClearedCents,
            hasPayoutDetails,
            preferredPayoutMethod = p.PreferredPayoutMethod,
            currentStreakDays = rp.CurrentStreakDays,
            efficiencyScore = Math.Round(rp.EfficiencyScore, 1),
            lastRunCompletedAt = rp.LastRunCompletedAt,
            createdAt = rp.CreatedAt,
            activeRun = activeRun is null ? null : new
            {
                id = activeRun.Id,
                areaName = activeRun.AreaName,
                status = activeRun.Status,
                estimatedContainers = activeRun.EstimatedContainers,
                stopCount = activeRun.Stops.Count,
                pickedUpStops = activeRun.Stops.Count(s => s.Status == "picked_up"),
                perContainerCents = activeRun.PerContainerCents,
                estimatedPayoutCents = activeRun.EstimatedPayoutCents,
                claimedAt = activeRun.ClaimedAt,
                startedAt = activeRun.StartedAt,
                stuckMinutes,
            },
        };
    }).ToList();

    var summary = new
    {
        totalRunners = rows.Count,
        approvedCount = rows.Count(r => r.approvalStatus == "approved"),
        pendingCount = rows.Count(r => r.approvalStatus == "pending"),
        suspendedCount = rows.Count(r => r.approvalStatus == "suspended"),
        onlineNowCount = rows.Count(r => r.isOnline),
        activeRunsCount = activeRuns.Count,
        unclaimedRunsCount,
        completedAwaitingSettleCount,
        requireApprovalGate = string.Equals(cfg["RUNNER_REQUIRE_APPROVAL"], "true", StringComparison.OrdinalIgnoreCase),
    };

    var needle = q?.Trim();
    var filterStatus = status?.Trim().ToLowerInvariant() ?? "all";
    var filtered = rows.Where(r =>
    {
        if (!string.IsNullOrWhiteSpace(needle))
        {
            var hit = (r.name?.Contains(needle, StringComparison.OrdinalIgnoreCase) ?? false)
                || (r.email?.Contains(needle, StringComparison.OrdinalIgnoreCase) ?? false)
                || (r.vehicleType?.Contains(needle, StringComparison.OrdinalIgnoreCase) ?? false)
                || (r.vehicleMake?.Contains(needle, StringComparison.OrdinalIgnoreCase) ?? false)
                || (r.vehicleRego?.Contains(needle, StringComparison.OrdinalIgnoreCase) ?? false)
                || (r.coexSchemeId?.Contains(needle, StringComparison.OrdinalIgnoreCase) ?? false)
                || (r.adminNote?.Contains(needle, StringComparison.OrdinalIgnoreCase) ?? false)
                || (r.suburb?.Contains(needle, StringComparison.OrdinalIgnoreCase) ?? false);
            if (!hit) return false;
        }
        return filterStatus switch
        {
            "approved" => r.approvalStatus == "approved",
            "pending" => r.approvalStatus == "pending",
            "suspended" => r.approvalStatus == "suspended",
            "online" => r.isOnline,
            "on_run" => r.activeRun is not null,
            _ => true,
        };
    })
    .OrderByDescending(r => r.activeRun is not null)
    .ThenByDescending(r => r.isOnline)
    .ThenByDescending(r => r.approvalStatus == "pending")
    .ThenByDescending(r => r.totalRuns)
    .ThenByDescending(r => r.createdAt)
    .Take(safeLimit)
    .ToList();

    return Results.Ok(new { summary, runners = filtered });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Approve, pause (pending), or suspend a runner (+ optional active run force-release) ──
app.MapPatch("/api/admin/runners/{id:guid}/status", async (Guid id, AdminRunnerStatusRequest req, GoodSortDbContext db, PricingService pricing, IConfiguration cfg) =>
{
    var normalizedStatus = req.Status?.Trim().ToLowerInvariant();
    if (normalizedStatus is not ("approved" or "pending" or "suspended"))
        return Results.BadRequest(new { error = "Status must be one of: approved, pending, suspended." });

    var runner = await db.RunnerProfiles
        .Include(rp => rp.Profile)
        .FirstOrDefaultAsync(rp => rp.Id == id || rp.ProfileId == id);
    if (runner is null) return Results.NotFound(new { error = "Runner not found." });

    Run? activeRun = null;
    if (req.ReleaseActiveRun == true && normalizedStatus == "suspended")
    {
        activeRun = await db.Runs
            .Include(r => r.Stops)
            .FirstOrDefaultAsync(r => r.RunnerId == runner.Id
                && (r.Status == "claimed" || r.Status == "in_progress" || r.Status == "delivering"));
        if (activeRun is not null)
        {
            var pickedUpStops = activeRun.Stops.Count(s => s.Status == "picked_up");
            if (pickedUpStops > 0 && req.ForceEvenIfPickedUp != true)
            {
                return Results.Conflict(new
                {
                    error = $"This runner has already marked {pickedUpStops} stop(s) as picked up on run {activeRun.AreaName}. Confirm force-release to reset those stops back to pending.",
                    requiresConfirmation = true,
                    pickedUpStops,
                    activeRunId = activeRun.Id,
                });
            }
        }
    }

    var now = DateTime.UtcNow;
    runner.ApprovalStatus = normalizedStatus;
    if (normalizedStatus == "approved")
    {
        runner.ApprovedAt = now;
        runner.SuspendedAt = null;
    }
    else if (normalizedStatus == "suspended")
    {
        runner.SuspendedAt = now;
        runner.IsOnline = false;
    }
    else
    {
        runner.IsOnline = false;
    }

    if (req.AdminNote is not null)
    {
        var cleaned = SanitizeSingleLine(req.AdminNote, 280);
        runner.AdminNote = cleaned.Length == 0 ? null : cleaned;
    }

    await db.SaveChangesAsync();

    Guid? releasedRunId = null;
    if (activeRun is not null)
    {
        var outcome = await ForceReleaseRunAsync(
            activeRun.Id,
            req.ForceEvenIfPickedUp == true,
            publishImmediately: false,
            db,
            pricing,
            cfg);
        if (outcome.Released) releasedRunId = activeRun.Id;
    }

    return Results.Ok(new
    {
        id = runner.Id,
        profileId = runner.ProfileId,
        approvalStatus = runner.ApprovalStatus,
        approvedAt = runner.ApprovedAt,
        suspendedAt = runner.SuspendedAt,
        isOnline = runner.IsOnline,
        adminNote = runner.AdminNote,
        releasedRunId,
    });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: All marketplace runs (projected with runner details & stuck duration) ──
app.MapGet("/api/admin/marketplace/runs", async (string? status, GoodSortDbContext db) =>
{
    var now = DateTime.UtcNow;
    var q = db.Runs
        .Include(r => r.Stops)
        .Include(r => r.DropPoint)
        .Include(r => r.Runner!)
            .ThenInclude(rp => rp.Profile)
        .AsNoTracking()
        .AsQueryable();

    if (!string.IsNullOrWhiteSpace(status))
    {
        var s = status.Trim().ToLowerInvariant();
        if (s == "active")
            q = q.Where(r => r.Status == "claimed" || r.Status == "in_progress" || r.Status == "delivering");
        else if (s == "open")
            q = q.Where(r => r.Status == "available" || r.Status == "below_threshold");
        else
            q = q.Where(r => r.Status == s);
    }
    else
    {
        q = q.Where(r => r.Status != "expired"); // show everything except expired
    }

    var runs = await q.OrderByDescending(r => r.CreatedAt).Take(100).ToListAsync();
    var projected = runs.Select(r =>
    {
        var isActive = r.Status is "claimed" or "in_progress" or "delivering";
        var anchor = r.StartedAt ?? r.ClaimedAt ?? r.CreatedAt;
        var stuckMinutes = isActive ? Math.Max(0, (int)Math.Floor((now - anchor).TotalMinutes)) : 0;
        var pickedUpStops = r.Stops.Count(s => s.Status == "picked_up");
        return new
        {
            id = r.Id,
            status = r.Status,
            areaName = r.AreaName,
            materialFocus = r.MaterialFocus,
            estimatedContainers = r.EstimatedContainers,
            actualContainers = r.ActualContainers,
            depotVerifiedContainers = r.DepotVerifiedContainers,
            coexDocketRef = r.CoexDocketRef,
            estimatedWeightKg = r.EstimatedWeightKg,
            perContainerCents = r.PerContainerCents,
            estimatedPayoutCents = r.EstimatedPayoutCents,
            actualPayoutCents = r.ActualPayoutCents,
            pricingTier = r.PricingTier,
            estimatedDistanceKm = r.EstimatedDistanceKm,
            estimatedDurationMin = r.EstimatedDurationMin,
            stopCount = r.Stops.Count,
            pickedUpStops,
            stuckMinutes,
            dropPointName = r.DropPoint?.Name,
            runnerId = r.RunnerId,
            runnerProfileId = r.Runner?.ProfileId,
            runnerName = r.Runner?.Profile?.Name,
            runnerEmail = r.Runner?.Profile?.Email,
            runnerVehicleType = r.Runner?.VehicleType,
            runnerVehicleRego = r.Runner?.VehicleRego,
            runnerApprovalStatus = r.Runner?.ApprovalStatus,
            claimedAt = r.ClaimedAt,
            startedAt = r.StartedAt,
            deliveredAt = r.DeliveredAt,
            completedAt = r.CompletedAt,
            settledAt = r.SettledAt,
            expiresAt = r.ExpiresAt,
            createdAt = r.CreatedAt,
        };
    }).ToList();

    return Results.Ok(projected);
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Force-release a stuck run (claimed, in_progress, or delivering) back to open dispatch ──
app.MapPost("/api/admin/marketplace/runs/{id:guid}/force-release", async (HttpContext ctx, Guid id, GoodSortDbContext db, PricingService pricing, IConfiguration cfg) =>
{
    AdminForceReleaseRunRequest req = new();
    if (ctx.Request.ContentLength is > 0 || (ctx.Request.ContentType?.Contains("json", StringComparison.OrdinalIgnoreCase) ?? false))
    {
        try
        {
            var parsed = await ctx.Request.ReadFromJsonAsync<AdminForceReleaseRunRequest>(ctx.RequestAborted);
            if (parsed is not null) req = parsed;
        }
        catch (JsonException)
        {
            return Results.BadRequest(new { error = "Invalid JSON body." });
        }
    }

    var outcome = await ForceReleaseRunAsync(
        id,
        req.ForceEvenIfPickedUp == true,
        req.PublishImmediately == true,
        db,
        pricing,
        cfg);

    if (outcome.NotFound) return Results.NotFound(new { error = "Run not found." });
    if (outcome.RequiresConfirmation)
    {
        return Results.Conflict(new
        {
            error = outcome.Error,
            requiresConfirmation = true,
            pickedUpStops = outcome.PickedUpStops,
        });
    }
    if (!outcome.Released)
        return Results.BadRequest(new { error = outcome.Error });

    return Results.Ok(new
    {
        released = true,
        id,
        previousStatus = outcome.PreviousStatus,
        previousRunnerId = outcome.PreviousRunnerId,
        resetStops = outcome.ResetStops,
        resetBags = outcome.ResetBags,
        status = outcome.NewStatus,
        perContainerCents = outcome.PerContainerCents,
        estimatedPayoutCents = outcome.EstimatedPayoutCents,
    });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Trigger marketplace run generation immediately (coordinates via SingletonLease) ──
app.MapPost("/api/admin/marketplace/runs/generate", async (RunGenerationService runGen, GoodSortDbContext db, CancellationToken ct) =>
{
    var (acquiredLease, availableRuns) = await runGen.TriggerNowAsync(ct, forcePilotCollecting: true);
    var pilotRuns = await db.Runs.CountAsync(r => r.Status == "below_threshold", ct);
    return Results.Ok(new { acquiredLease, availableRuns, pilotRuns });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Reset pre-launch database to clean startup baseline (fail-closed unless RESET_BASELINE_ENABLED=true) ──
app.MapPost("/api/admin/reset-baseline", async (HttpContext ctx, AdminResetBaselineRequest req, GoodSortDbContext db, IConfiguration cfg, ILogger<Program> log) =>
{
    if (!string.Equals(cfg["RESET_BASELINE_ENABLED"], "true", StringComparison.OrdinalIgnoreCase))
        return Results.NotFound();

    var forceDev = string.Equals(req.Confirm, "RESET_BASELINE_FORCE_DEV", StringComparison.Ordinal);
    if (!forceDev && !string.Equals(req.Confirm, "RESET_BASELINE", StringComparison.Ordinal))
        return Results.BadRequest(new { error = "Confirmation token RESET_BASELINE is required." });

    if (!forceDev)
    {
        var hasLedgers = await db.RunSettlementLedgers.AnyAsync();
        var hasActiveCashouts = await db.CashoutRequests.AnyAsync(c => c.Status == "pending" || c.Status == "processing");
        if (hasLedgers || hasActiveCashouts)
            return Results.Conflict(new { error = "Refusing reset while settled COEX ledgers or active cashouts exist." });
    }

    var callerId = ctx.GetCallerId();
    var seedEmail = AuthService.NormalizeValidEmail(cfg["ADMIN_SEED_EMAIL"]) ?? "hello@thegoodsort.org";

    return await Atomic.RunAsync(db, async () =>
    {
        db.RunSettlementLedgers.RemoveRange(await db.RunSettlementLedgers.ToListAsync());
        db.SortedBags.RemoveRange(await db.SortedBags.ToListAsync());
        db.RunStops.RemoveRange(await db.RunStops.ToListAsync());
        db.RunnerRatings.RemoveRange(await db.RunnerRatings.ToListAsync());
        db.Runs.RemoveRange(await db.Runs.ToListAsync());
        db.RunnerProfiles.RemoveRange(await db.RunnerProfiles.ToListAsync());

        db.RouteStops.RemoveRange(await db.RouteStops.ToListAsync());
        db.Collections.RemoveRange(await db.Collections.ToListAsync());
        db.Routes.RemoveRange(await db.Routes.ToListAsync());

        db.CashoutRequests.RemoveRange(await db.CashoutRequests.ToListAsync());
        db.Scans.RemoveRange(await db.Scans.ToListAsync());
        db.UsedScanTokens.RemoveRange(await db.UsedScanTokens.ToListAsync());
        db.VisionCalls.RemoveRange(await db.VisionCalls.ToListAsync());
        db.GrowthEvents.RemoveRange(await db.GrowthEvents.ToListAsync());
        db.OtpCodes.RemoveRange(await db.OtpCodes.ToListAsync());
        db.Bins.RemoveRange(await db.Bins.ToListAsync());
        db.BuildingSyndicateMessages.RemoveRange(await db.BuildingSyndicateMessages.ToListAsync());
        db.BuildingSyndicateMembers.RemoveRange(await db.BuildingSyndicateMembers.ToListAsync());
        db.BuildingSyndicates.RemoveRange(await db.BuildingSyndicates.ToListAsync());

        var allProfiles = await db.Profiles.ToListAsync();
        foreach (var p in allProfiles)
        {
            p.HouseholdId = null;
            p.ReferrerId = null;
        }
        await db.SaveChangesAsync();

        var keptProfiles = new List<Profile>();
        foreach (var p in allProfiles)
        {
            var isSeedOrCaller = (callerId.HasValue && p.Id == callerId.Value)
                || AuthService.AreEquivalentEmails(p.Email, seedEmail);
            if (isSeedOrCaller)
            {
                p.PendingCents = 0;
                p.ClearedCents = 0;
                p.TotalContainers = 0;
                p.TotalCo2SavedKg = 0;
                p.Badges = [];
                p.LastNudgedAt = null;
                p.PreferredPayoutMethod = null;
                p.PayIdType = null;
                p.PayIdValue = null;
                p.BankBsb = null;
                p.BankAccountNumber = null;
                p.BankAccountName = null;
                p.PayoutUpdatedAt = null;
                p.Role = "sorter";
                p.IsAdmin = true;
                keptProfiles.Add(p);
            }
            else
            {
                db.Profiles.Remove(p);
            }
        }
        await db.SaveChangesAsync();

        db.Households.RemoveRange(await db.Households.ToListAsync());
        await db.SaveChangesAsync();

        log.LogWarning("Database reset to startup baseline by {CallerId}; retained {RetainedCount} admin profile(s)", callerId, keptProfiles.Count);
        return Results.Ok(new
        {
            reset = true,
            retainedUsers = keptProfiles.Select(p => new { p.Id, p.Email, p.IsAdmin }),
        });
    });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

app.MapBuildingSyndicateEndpoints();

app.Run();

// Caller owns a marketplace run when their JWT profile id matches the run's
// assigned runner (run.RunnerId is a RunnerProfile.Id, not a profile id), or
// when they're an admin. Used to gate the run lifecycle so a runner can only
// drive/settle their own runs — settle credits cash-out-eligible balance.
static async Task<bool> CallerCanAccessHousehold(HttpContext ctx, Guid householdId, GoodSortDbContext db)
{
    if (ctx.IsAdmin()) return true;
    var callerId = ctx.GetCallerId();
    if (callerId is null) return false;
    return await db.Profiles.AnyAsync(p => p.Id == callerId && p.HouseholdId == householdId);
}

static async Task<bool> CallerOwnsRun(HttpContext ctx, Run run, GoodSortDbContext db)
{
    if (ctx.IsAdmin()) return true;
    var callerId = ctx.GetCallerId();
    if (callerId is null || run.RunnerId is null) return false;
    return await db.RunnerProfiles.AnyAsync(rp => rp.Id == run.RunnerId && rp.ProfileId == callerId.Value);
}

// ── Haversine helper ──
static double HaversineKm(double lat1, double lng1, double lat2, double lng2)
{
    const double R = 6371.0;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
            Math.Cos(lat1 * Math.PI / 180) * Math.Cos(lat2 * Math.PI / 180) *
            Math.Sin(dLng / 2) * Math.Sin(dLng / 2);
    return R * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
}

static async Task<ForceReleaseOutcome> ForceReleaseRunAsync(
    Guid runId,
    bool forceEvenIfPickedUp,
    bool publishImmediately,
    GoodSortDbContext db,
    PricingService pricing,
    IConfiguration cfg)
{
    return await Atomic.RunAsync(db, async () =>
    {
        var run = await db.Runs
            .Include(r => r.Stops)
            .FirstOrDefaultAsync(r => r.Id == runId);
        if (run is null)
            return ForceReleaseOutcome.FailNotFound();

        if (run.Status is not ("claimed" or "in_progress" or "delivering"))
            return ForceReleaseOutcome.FailBadRequest("Only claimed, in_progress, or delivering runs can be force-released.");

        var pickedUpStops = run.Stops.Count(s => s.Status == "picked_up");
        if (pickedUpStops > 0 && !forceEvenIfPickedUp)
        {
            return ForceReleaseOutcome.FailNeedsConfirmation(
                $"Run has {pickedUpStops} stop(s) already marked picked_up. Confirm force-release to reset those stops and kerb bags back to open dispatch.",
                pickedUpStops);
        }

        var previousStatus = run.Status;
        var previousRunnerId = run.RunnerId;
        var resetStops = 0;

        foreach (var stop in run.Stops)
        {
            if (stop.Status != "pending" || stop.ArrivedAt is not null || stop.PickedUpAt is not null)
            {
                stop.Status = "pending";
                stop.ArrivedAt = null;
                stop.PickedUpAt = null;
                stop.ActualContainers = null;
                stop.PhotoUrl = null;
                stop.ScannedBagCount = 0;
                stop.ContaminationFlag = false;
                stop.DiscrepancyCode = null;
                stop.DiscrepancyNote = null;
                resetStops++;
            }
        }

        var resetBags = 0;
        if (pickedUpStops > 0)
        {
            var linkedBags = await db.SortedBags.Where(b => b.RunId == run.Id).ToListAsync();
            foreach (var bag in linkedBags)
            {
                bag.RunId = null;
                bag.RunStopId = null;
                bag.PickedUpAt = null;
                bag.VerifiedAt = null;
                bag.VerifiedContainers = null;
                if (bag.Status is "picked_up" or "verified")
                    bag.Status = "on_kerb";
                resetBags++;
            }
        }

        run.RunnerId = null;
        run.ClaimedAt = null;
        run.StartedAt = null;
        run.DeliveredAt = null;
        run.LastBriefedAt = null;
        run.ActualContainers = 0;
        run.ActualPayoutCents = 0;
        if (run.ExpiresAt <= DateTime.UtcNow.AddHours(2))
            run.ExpiresAt = DateTime.UtcNow.AddHours(6);

        var minPayoutCents = RunGenerationService.ResolveMinPayoutCents(cfg);
        var repriced = await pricing.CalculateRate(run);
        run.PerContainerCents = repriced.PerContainerCents;
        run.EstimatedPayoutCents = repriced.EstimatedPayoutCents;
        run.PricingTier = repriced.PricingTier;
        run.LastPricedAt = DateTime.UtcNow;
        run.Status = publishImmediately || repriced.EstimatedPayoutCents >= minPayoutCents
            ? "available"
            : "below_threshold";

        await db.SaveChangesAsync();
        return ForceReleaseOutcome.Success(
            previousStatus,
            previousRunnerId,
            resetStops,
            resetBags,
            run.Status,
            run.PerContainerCents,
            run.EstimatedPayoutCents);
    });
}

record ProfileCreateRequest(string? Name);
record ProfileUpdateRequest(string? Name, Guid? HouseholdId);
record AdminCreateBinRequest(string? Code, string Name, string Address, double Lat, double Lng, string? HostedBy = null);
record PayoutDetailsUpdateRequest(string Method, string? PayIdType, string? PayIdValue, string? Bsb, string? AccountNumber, string AccountName, string? MemberName = null);
// NOTE: caller-supplied UserId fields are ignored; endpoints read the caller from the JWT.
// Kept on the record for frontend backwards compatibility — safe to remove once frontend stops sending them.
record CashoutRequestDto(Guid UserId, int AmountCents, string Bsb, string AccountNumber, string AccountName);
record PayIdCashoutRequestDto(int AmountCents, string PayIdType, string PayIdValue, string AccountName);
record CreateSortedBagRequest(string Stream, int? DeclaredContainers = null, bool? PutOnKerb = null);
record UpdateSortedBagStatusRequest(string Status);
record RunnerScanBagRequest(string BagCode, int? VerifiedContainers = null, bool? ContaminationFlag = null, string? DiscrepancyCode = null, string? DiscrepancyNote = null);
record CompleteRunRequest(int? DepotVerifiedContainers = null, string? CoexDocketRef = null);
record PhotoScanRequest(string Image, string? BinCode = null);
record PhotoScanPreviewRequest(string Image, string PreScanToken, string? BinCode = null);
record PhotoConfirmRequest(string ScanToken, Guid? UserId = null, List<PhotoConfirmItem>? Items = null, string? BinCode = null, double? Lat = null, double? Lng = null);
record PhotoConfirmItem(string Name, string Material, int Count, bool Eligible);
record SendOtpRequest(string? Email = null);
record VerifyOtpRequest(string? Email = null, string? Code = null, Guid? ReferrerId = null);
record ScanRequest(Guid UserId, string Barcode, string ContainerName, string Material);
record ClaimRequest(Guid DriverId);
record PickupRequest(int ActualCount);
record RunnerRegisterRequest(Guid ProfileId, string? VehicleType, string? VehicleMake, string? VehicleRego, int? CapacityBags, double? ServiceRadiusKm, string? CoexSchemeId = null);
record WaitlistEventRequest(string Name, string? Suburb, string? Path);
record UnitComplexWaitlistRequest(string BuildingName, string Address, double Lat, double Lng, string? Suburb = null);
record StreetPatchRequest(string? Address, double? Lat, double? Lng, string? Suburb, int? CouncilCollectionDay, string? CouncilArea, bool? AccessConsent);
record HouseholdCreateRequest(
    string? Name,
    string? Address,
    string? Suburb,
    string? Street,
    double Lat,
    double Lng,
    string? Type,
    int? CouncilCollectionDay,
    string? CouncilArea,
    bool AccessConsent,
    string? BuildingName,
    int? BinCapacityLitres);
record BinDayLookupRequest(double Lat, double Lng, string? Address);
record BinOutRequest(bool Out);
record BinStatusRequest(string Status);
record RunnerProfileUpdateRequest(string? VehicleType, int? CapacityBags, double? ServiceRadiusKm, string? CoexSchemeId = null);
record RunnerHeartbeatRequest(Guid ProfileId, double Lat, double Lng, bool IsOnline);
record MarketplaceClaimRequest(Guid ProfileId);
record RunStopPickupRequest(int ActualContainers, string? PhotoUrl = null, bool? ContaminationFlag = null, string? DiscrepancyCode = null, string? DiscrepancyNote = null);
record PricingSimulateRequest(int Containers, double DistanceKm, int StopCount);
record AdminRunnerStatusRequest(string Status, string? AdminNote = null, bool? ReleaseActiveRun = null, bool? ForceEvenIfPickedUp = null);
record AdminForceReleaseRunRequest(bool? ForceEvenIfPickedUp = null, bool? PublishImmediately = null);

sealed record ForceReleaseOutcome(
    bool Released,
    bool NotFound,
    bool RequiresConfirmation,
    int PickedUpStops,
    string? Error,
    string? PreviousStatus,
    Guid? PreviousRunnerId,
    int ResetStops,
    int ResetBags,
    string? NewStatus,
    int PerContainerCents,
    int EstimatedPayoutCents)
{
    public static ForceReleaseOutcome FailNotFound() => new(false, true, false, 0, "Run not found.", null, null, 0, 0, null, 0, 0);
    public static ForceReleaseOutcome FailBadRequest(string error) => new(false, false, false, 0, error, null, null, 0, 0, null, 0, 0);
    public static ForceReleaseOutcome FailNeedsConfirmation(string error, int pickedUpStops) => new(false, false, true, pickedUpStops, error, null, null, 0, 0, null, 0, 0);
    public static ForceReleaseOutcome Success(string previousStatus, Guid? previousRunnerId, int resetStops, int resetBags, string newStatus, int perContainerCents, int estimatedPayoutCents) =>
        new(true, false, false, 0, null, previousStatus, previousRunnerId, resetStops, resetBags, newStatus, perContainerCents, estimatedPayoutCents);
}

record AdminBootstrapRequest(string Email);
record AdminResetBaselineRequest(string Confirm);

/// <summary>
/// Exposed so the test project can boot the real application with
/// WebApplicationFactory. Every test before ActivationPathTests called services
/// directly, so routing, auth, model binding and DI were never exercised — all
/// 153 could pass with every endpoint broken.
/// </summary>
public partial class Program { }
