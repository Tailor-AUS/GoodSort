using System.Text;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();
var sqlCs = builder.Configuration.GetConnectionString("goodsortdb");
var useMemory = builder.Environment.IsDevelopment() && string.IsNullOrWhiteSpace(sqlCs);
if (useMemory)
    builder.Services.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase("goodsort-dev"));
else
    builder.AddSqlServerDbContext<GoodSortDbContext>("goodsortdb");
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<VisionService>();
builder.Services.AddScoped<CashoutService>();
builder.Services.AddScoped<PricingService>();
builder.Services.AddScoped<RunnerService>();
builder.Services.AddScoped<BinDayService>();
builder.Services.AddScoped<NotificationService>();
builder.Services.AddHostedService<RunGenerationService>();
builder.Services.AddScoped<PickupReminderService>();
builder.Services.AddHostedService<PickupReminderHost>();
builder.Services.AddHostedService<GrowthEventRetentionHost>();
builder.Services.AddSingleton<ScanTokenService>();
builder.Services.AddHttpClient();

// Tailor Vision (TV) — api.tailor.au/api/vision/classify
// GoodSort dogfoods Tailor Vision, billed via BAINK (baink.tailor.au)
builder.Services.AddHttpClient("TailorVision", client =>
{
    var url = builder.Configuration["TAILOR_VISION_API_URL"] ?? "https://api.tailor.au";
    var key = builder.Configuration["TAILOR_VISION_API_KEY"] ?? "";
    client.BaseAddress = new Uri(url);
    if (!string.IsNullOrEmpty(key))
        client.DefaultRequestHeaders.Add("X-Api-Key", key);
    client.Timeout = TimeSpan.FromSeconds(8); // Fast fail — fallback to Azure OpenAI if Tailor Vision is slow
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
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("growth-events", ctx =>
        System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions
            {
                // Generous for a real member — a scan session emits a handful —
                // but a hard ceiling on a scripted loop.
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
// upper bound prevents both memory pressure and runaway BAINK spend if a
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
        else
        {
            await db.Database.MigrateAsync();
            app.Logger.LogInformation("Database migration completed successfully");
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
app.MapPost("/api/auth/send-otp", async (SendOtpRequest req, AuthService auth) =>
{
    var email = req.Email.Trim().ToLower();
    if (!email.Contains('@')) return Results.BadRequest(new { error = "Invalid email" });
    var (success, error, devCode) = await auth.SendOtp(email);
    if (!success) return Results.BadRequest(new { error = error ?? "Failed to send code" });
    return Results.Ok(new { sent = true, devCode = app.Environment.IsDevelopment() ? devCode : null });
});

app.MapPost("/api/auth/verify-otp", async (VerifyOtpRequest req, AuthService auth) =>
{
    var email = req.Email.Trim().ToLower();
    var (token, profile) = await auth.VerifyOtp(email, req.Code, req.ReferrerId);
    if (token == null) return Results.Unauthorized();
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

    var q = db.Bins.Where(b => b.Status != "disabled");
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
    if (b is null) return Results.NotFound();
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
    if (b is null) return Results.NotFound();

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

app.MapPost("/api/bins", async (Bin bin, GoodSortDbContext db) =>
{
    if (string.IsNullOrEmpty(bin.Code))
    {
        var count = await db.Bins.CountAsync() + 1;
        bin.Code = $"GS-{count:D4}";
    }
    db.Bins.Add(bin);
    await db.SaveChangesAsync();
    return Results.Created($"/api/bins/{bin.Id}", bin);
}).RequireAuthorization();

app.MapGet("/api/bins/{id:guid}/qr", (Guid id, GoodSortDbContext db) =>
{
    var bin = db.Bins.Find(id);
    if (bin is null) return Results.NotFound();

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
    var url = $"https://thegoodsort.org/scan?bin={bin.Code}";
    var svg = $@"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 380'>
        <rect width='300' height='380' fill='white' rx='16'/>
        <rect x='20' y='20' width='260' height='260' fill='#f1f5f9' rx='12'/>
        <text x='150' y='160' text-anchor='middle' font-family='system-ui' font-size='48' font-weight='800' fill='#16a34a'>{bin.Code}</text>
        <text x='150' y='200' text-anchor='middle' font-family='system-ui' font-size='14' fill='#64748b'>Optional count</text>
        <text x='150' y='310' text-anchor='middle' font-family='system-ui' font-size='13' font-weight='700' fill='#0f172a'>{label}</text>
        <text x='150' y='335' text-anchor='middle' font-family='system-ui' font-size='11' fill='#94a3b8'>{url}</text>
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

    // Hard size cap before we round-trip to Tailor Vision and burn BAINK credit.
    // base64 inflates by ~33%, so 2_000_000 base64 chars ≈ 1.5 MB raw image.
    if (base64.Length > 2_000_000)
        return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);

    // Cost guardrails — per-user AND global. Per-user is the critical one:
    // without it, one client can drain the whole day's BAINK budget.
    var since = DateTime.UtcNow.AddHours(-24);
    var perUserCap = int.TryParse(cfg["VISION_PER_USER_DAILY_CAP"], out var pu) ? pu : 100;
    var globalCap = int.TryParse(cfg["VISION_DAILY_CAP"], out var g) ? g : 2000;
    var userCallsToday = await db.VisionCalls.CountAsync(v => v.CreatedAt >= since && v.UserId == userId);
    if (userCallsToday >= perUserCap) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
    var globalCallsToday = await db.VisionCalls.CountAsync(v => v.CreatedAt >= since);
    if (globalCallsToday >= globalCap) return Results.StatusCode(StatusCodes.Status429TooManyRequests);

    var result = await vision.IdentifyContainers(base64, userId);
    var totalItems = result.Containers.Sum(c => c.Count);
    // Preview must quote what /confirm will actually credit, launch bonus included.
    var previewProfile = await db.Profiles.FindAsync(userId.Value);
    var eligibleCount = result.Containers.Where(c => c.Eligible).Sum(c => Math.Clamp(c.Count, 0, 100));
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
        Items = result.Containers.Select(c => new ScanTokenItem
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
        containers = result.Containers,
        totalItems,
        totalCents,
        message = result.Message,
        scanToken,
        summary = totalItems > 0
            ? $"{totalItems} container{(totalItems != 1 ? "s" : "")} found — ${totalCents / 100.0:F2} pending"
            : result.Message,
    });
}).RequireAuthorization();

// Confirm photo scan — creates scan records + credits the user.
// MUST use server-side items from the signed scanToken; otherwise a client
// can post {items: [{eligible: true, count: 99999, ...}]} and grant itself
// unlimited credit. The token also pins userId, so cross-user spoofing is
// blocked even if /confirm is hit with the wrong token.
app.MapPost("/api/scan/photo/confirm", async (HttpContext ctx, PhotoConfirmRequest req,
    GoodSortDbContext db, ScanTokenService tokens, IConfiguration cfg, NotificationService notif,
    ILogger<Program> log) =>
{
    var userId = ctx.GetCallerId();
    if (userId is null) return Results.Unauthorized();

    var payload = tokens.Verify(req.ScanToken);
    if (payload is null) return Results.BadRequest(new { error = "Invalid or expired scan token. Re-take the photo." });
    if (payload.Uid != userId.Value) return Results.Forbid();

    var profile = await db.Profiles.FindAsync(userId.Value);
    if (profile is null) return Results.NotFound("User not found");
    var household = profile.HouseholdId.HasValue
        ? await db.Households.FindAsync(profile.HouseholdId.Value)
        : null;

    // ── Unattended-deposit geofence (anti-fraud) ──
    // When the token is bound to a physical bin, the member must actually be at
    // that bin to claim credit — otherwise anyone could farm 5¢ deposits from
    // their couch. Distance is computed from the bin location committed in the
    // signed token (not client-supplied) to the device location at confirm.
    // Tunable radius; absent device location is treated as out-of-fence when a
    // bin is bound. Non-bin scans (household/runner) skip this entirely.
    var geofenceRadiusM = double.TryParse(cfg["DEPOSIT_GEOFENCE_RADIUS_M"], out var gr) ? gr : 150.0;
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
    return await Atomic.RunAsync(db, async () =>
    {
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

    foreach (var item in payload.Items)
    {
        if (!item.Eligible) continue;
        // Cap per-scan count to a sane upper bound — defends against a
        // poisoned vision response too (defence in depth, not just client trust).
        var safeCount = Math.Clamp(item.Count, 0, 100);
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
                ContainerName = item.Name,
                Material = item.Material,
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
        }
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
        foreach (var item in payload.Items.Where(i => i.Eligible))
        {
            var safeCount = Math.Clamp(item.Count, 0, 100);
            for (var i = 0; i < safeCount; i++)
            {
                _ = item.Material switch
                {
                    "aluminium" => household.Materials.Aluminium++,
                    "pet" => household.Materials.Pet++,
                    "glass" => household.Materials.Glass++,
                    _ => household.Materials.Other++,
                };
            }
        }

        // Mirror onto the bin, per material, so the bin's breakdown matches the
        // household's. Dispatch reads the BIN's counter — see BinCounter.
        var bin = await db.Bins.FirstOrDefaultAsync(b => b.HouseholdId == household.Id);
        foreach (var item in payload.Items.Where(i => i.Eligible))
        {
            var safeCount = Math.Clamp(item.Count, 0, 100);
            BinCounter.AddScan(bin, safeCount, safeCount * HouseholdCredit.CentsPerContainer, item.Material);
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
    });
}).RequireAuthorization();

// ── Barcode Lookup (Open Food Facts proxy) ──
app.MapGet("/api/barcode/{barcode}", async (string barcode, IHttpClientFactory httpFactory) =>
{
    // Validate barcode format
    if (barcode.Length < 8 || barcode.Length > 13 || !barcode.All(char.IsDigit))
        return Results.BadRequest(new { error = "Invalid barcode format" });

    try
    {
        var client = httpFactory.CreateClient();
        client.DefaultRequestHeaders.Add("User-Agent", "TheGoodSort/1.0 (noreply@thegoodsort.org)");
        var res = await client.GetAsync($"https://world.openfoodfacts.org/api/v2/product/{barcode}.json");
        if (!res.IsSuccessStatusCode) return Results.Ok(new { found = false, barcode });

        var json = await res.Content.ReadAsStringAsync();
        return Results.Ok(new { found = true, barcode, data = System.Text.Json.JsonSerializer.Deserialize<object>(json) });
    }
    catch
    {
        return Results.Ok(new { found = false, barcode });
    }
});

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
    var household = new Household
    {
        Name = req.Name ?? "",
        Address = req.Address ?? "",
        Suburb = req.Suburb,
        Street = req.Street,
        Lat = req.Lat,
        Lng = req.Lng,
        Type = req.Type ?? "residential",
        CouncilCollectionDay = req.CouncilCollectionDay,
        CouncilArea = req.CouncilArea,
        AccessConsent = req.AccessConsent,
        BuildingName = req.BuildingName,
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

    db.Households.Add(household);
    await db.SaveChangesAsync();

    // Placeholder bin for the household. RunGeneration skips waitlisted/allocated
    // households until ops marks the area collecting.
    if (household.Type != "unit_complex")
    {
        var code = $"GS-H{Math.Abs(household.Id.GetHashCode()) % 100000:D5}";
        db.Bins.Add(new Bin
        {
            Code = code,
            Name = household.Name,
            Address = household.Address,
            Lat = household.Lat,
            Lng = household.Lng,
            HouseholdId = household.Id,
            HostedBy = null,
        });
    }

    // First household for a referred profile credits the neighbour $1 pending.
    // The growth loop is scan volume → suburb trip, not house-count density.
    var callerId = ctx.GetCallerId();
    if (callerId is Guid uid)
    {
        var me = await db.Profiles.FindAsync(uid);
        if (me is not null)
        {
            if (me.ReferrerId is Guid rid && rid != uid && me.HouseholdId is null)
            {
                var referrer = await db.Profiles.FindAsync(rid);
                if (referrer is not null) referrer.PendingCents += 100;
            }
            var isFirstHousehold = me.HouseholdId is null;
            me.HouseholdId ??= household.Id;

            // Scan-first: containers this member scanned before they had an
            // address are attached now, so the credit can settle and the
            // containers they are holding count toward their suburb.
            if (isFirstHousehold)
            {
                var orphans = await db.Scans
                    .Where(sc => sc.UserId == me.Id && sc.HouseholdId == null && sc.Status == "pending")
                    .ToListAsync();
                // The bin is created for this household a few lines above; pass
                // it so backfilled scans reach the counter dispatch reads.
                var backfillBin = await db.Bins.FirstOrDefaultAsync(b => b.HouseholdId == household.Id);
                ScanBackfill.AttachTo(household, orphans, backfillBin);
            }
        }
    }

    await db.SaveChangesAsync();

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

    if (!string.IsNullOrWhiteSpace(req.Address))
    {
        h.Address = req.Address.Trim();
        var parsed = BinDayService.ParseAddress(h.Address);
        if (parsed is not null)
        {
            h.Street = parsed.Street;
            h.Suburb ??= BinDayService.CanonicalSuburb(parsed.Suburb);
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
        h.CouncilArea = req.CouncilArea;
    if (req.AccessConsent == true)
    {
        h.AccessConsent = true;
        h.AccessConsentAt ??= DateTime.UtcNow;
    }
    h.UsesDivider = true;
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
    "waitlist_cta",
    "scan_camera_opened", "scan_captured", "scan_credited", "first_scan_credited",
    "otp_sent", "otp_verified", "household_joined",
    "invite_whatsapp", "invite_sms", "invite_share", "invite_landed", "suburb_picked",
    "bin_day_looked_up",
};
app.MapPost("/api/growth/events", async (WaitlistEventRequest req, GoodSortDbContext db, ILoggerFactory logFactory) =>
{
    var name = req.Name?.Trim();
    if (string.IsNullOrWhiteSpace(name) || !waitlistEvents.Contains(name))
        return Results.BadRequest();
    var key = name.ToLowerInvariant();

    // Canonicalise on WRITE, not just on the log line. CanonicalSuburb also
    // drops city-wide labels to null, so the stored row stays coarse.
    var suburb = BinDayService.CanonicalSuburb(req.Suburb);

    // Path only, and only if it looks like a path. The client sends
    // location.pathname rather than href precisely so that ?r={profileId}
    // never arrives here; refuse anything carrying a query anyway.
    var path = req.Path is { Length: > 0 } p && p.StartsWith('/') && !p.Contains('?')
        ? (p.Length > 256 ? p[..256] : p)
        : null;

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

// Durable now. The old version counted into an in-process dictionary, so every
// push to main rolled the image and reset the board, and each replica held its
// own partial view. `days` defaults to 30 to match the retention sweep.
app.MapGet("/api/admin/funnel", async (int? days, GoodSortDbContext db) =>
{
    var window = Math.Clamp(days ?? 30, 1, GrowthEventRetention.RetentionDays);
    var since = DateTime.UtcNow.AddDays(-window);

    var counts = await db.GrowthEvents
        .Where(e => e.CreatedAt >= since)
        .GroupBy(e => e.Name)
        .Select(g => new { Name = g.Key, Count = g.LongCount() })
        .ToListAsync();
    var byName = counts.ToDictionary(c => c.Name, c => c.Count, StringComparer.OrdinalIgnoreCase);

    // Zero-fill so a step that never fired is visibly 0 rather than absent —
    // an absent step reads as "not instrumented", which is what we just fixed.
    return Results.Ok(new
    {
        since,
        windowDays = window,
        note = $"Counts over the last {window} days. Durable across restarts and deploys.",
        events = waitlistEvents.OrderBy(n => n)
            .ToDictionary(n => n, n => byName.TryGetValue(n, out var c) ? c : 0L),
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
    var result = await svc.Lookup(req.Lat, req.Lng, req.Address);
    if (result is null) return Results.Ok(new { found = false });
    return Results.Ok(new { found = true, dayOfWeek = result.DayOfWeek, councilArea = result.CouncilArea, source = result.Source });
});

// ── Next collection night — households sort today; we tell them this date.
// confirmed=false until we are actively collecting. ──
app.MapGet("/api/households/{id:guid}/next-pickup", async (HttpContext ctx, Guid id, GoodSortDbContext db) =>
{
    var h = await db.Households.FindAsync(id);
    if (h is null) return Results.NotFound();
    if (!await CallerCanAccessHousehold(ctx, id, db)) return Results.Forbid();
    if (h.Type == "unit_complex" || h.CouncilCollectionDay is null)
        return Results.Ok(new { nextPickup = (string?)null, confirmed = false, binStatus = h.BinStatus, reason = "Not a residential household with a council collection day set." });

    var next = KerbsideNight.NextRunnerLocalDate(h.CouncilCollectionDay, DateTime.UtcNow);
    var confirmed = BinStatuses.IsServiceable(h.BinStatus);
    return Results.Ok(new
    {
        nextPickup = next?.ToString("yyyy-MM-dd"),
        confirmed,
        councilDay = h.CouncilCollectionDay,
        runnerDay = (h.CouncilCollectionDay.Value + 6) % 7,
        councilArea = h.CouncilArea,
        usesDivider = h.UsesDivider,
        binStatus = h.BinStatus,
        reason = confirmed
            ? "Bag out your sorted containers on the kerb. We take them to a refund point or depot."
            : "Scan eligible containers for 5¢. A volume run unlocks when your suburb hits about 1,000 scanned containers.",
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
    var parsed = BinDayService.ParseAddress(req.Address);
    var placeholder = new Household
    {
        Type = "unit_complex",
        Name = req.BuildingName,
        Address = req.Address,
        Lat = req.Lat,
        Lng = req.Lng,
        BuildingName = req.BuildingName,
        Suburb = UnitWaitlist.ResolveSuburb(req.Suburb, parsed?.Suburb),
        Street = parsed?.Street,
        BinStatus = BinStatuses.Waitlisted,
        WaitlistedAt = DateTime.UtcNow,
        AccessConsent = true,
        AccessConsentAt = DateTime.UtcNow,
    };
    db.Households.Add(placeholder);
    var callerId = ctx.GetCallerId();
    Profile? caller = null;
    if (callerId is Guid uid)
    {
        caller = await db.Profiles.FindAsync(uid);
        if (caller is not null)
        {
            if (caller.ReferrerId is Guid rid && rid != uid && caller.HouseholdId is null)
            {
                var referrer = await db.Profiles.FindAsync(rid);
                if (referrer is not null) referrer.PendingCents += 100;
            }
            var isFirstHousehold = caller.HouseholdId is null;
            caller.HouseholdId ??= placeholder.Id;

            // Same scan-first backfill as the residential path: a member who
            // scanned before joining must not have their credit stranded.
            if (isFirstHousehold)
            {
                var orphans = await db.Scans
                    .Where(sc => sc.UserId == caller.Id && sc.HouseholdId == null && sc.Status == "pending")
                    .ToListAsync();
                ScanBackfill.AttachTo(placeholder, orphans);
            }
        }
    }
    await db.SaveChangesAsync();
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

app.MapPost("/api/profiles", async (HttpContext ctx, Profile profile, GoodSortDbContext db) =>
{
    // Self-create only — profile creation should normally happen via /verify-otp.
    // Force IsAdmin=false; admin flag is set out-of-band only.
    // Refuse rather than fall back to the body. `?? profile.Id` meant "if I
    // cannot identify you, trust the id you sent" — and the next line does
    // FindAsync on it, returning that profile. A token without a usable caller
    // claim would have read someone else's record back.
    //
    // Not reachable today: every JWT this service mints carries the claim. But
    // it was the only GetCallerId() ?? fallback in the codebase — every sibling,
    // /api/runner/register included, returns Unauthorized instead — and
    // "trust the client when the server is unsure" is the shape behind most of
    // what this week turned up.
    var callerId = ctx.GetCallerId();
    if (callerId is null) return Results.Unauthorized();
    profile.Id = callerId.Value;
    profile.IsAdmin = false;
    // Idempotent: the authenticated caller almost always already has a profile
    // (minted at verify-otp), so a naive Add would throw a primary-key conflict.
    var existing = await db.Profiles.FindAsync(profile.Id);
    if (existing is not null) return Results.Ok(existing);
    db.Profiles.Add(profile);
    await db.SaveChangesAsync();
    return Results.Created($"/api/profiles/{profile.Id}", profile);
}).RequireAuthorization();

// ── Scans ──
app.MapPost("/api/scans", async (HttpContext ctx, ScanRequest req, GoodSortDbContext db, IConfiguration cfg) =>
{
    var userId = ctx.GetCallerId();
    if (userId is null) return Results.Unauthorized();
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
        Barcode = req.Barcode, ContainerName = req.ContainerName,
        Material = req.Material, RefundCents = cents, Status = "pending",
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
        _ = req.Material switch
        {
            "aluminium" => household.Materials.Aluminium++,
            "pet" => household.Materials.Pet++,
            "glass" => household.Materials.Glass++,
            _ => household.Materials.Other++,
        };

        // Mirror onto the bin. Dispatch reads the BIN's counter, not the
        // household's — see BinCounter. Without this the scan never reaches
        // the number that decides whether a driver is sent.
        var bin = await db.Bins.FirstOrDefaultAsync(b => b.HouseholdId == household.Id);
        BinCounter.AddScan(bin, 1, cents, req.Material);
    }

    await db.SaveChangesAsync();
    return Results.Ok(new
    {
        scan.Id,
        profile.PendingCents,
        profile.TotalContainers,
        creditedCents = cents,
        bonusApplied = cents > HouseholdCredit.CentsPerContainer,
        bonusRemaining = Math.Max(0, LaunchBonus.CapFrom(cfg) - profile.TotalContainers),
    });
}).RequireAuthorization().RequireRateLimiting("scans");

app.MapGet("/api/scans", async (HttpContext ctx, Guid userId, int? limit, GoodSortDbContext db) =>
{
    // Owner or admin only — scans contain barcode + container history.
    if (!ctx.IsOwnerOrAdmin(userId)) return Results.Forbid();
    return Results.Ok(await db.Scans.Where(s => s.UserId == userId)
        .OrderByDescending(s => s.CreatedAt).Take(limit ?? 20).ToListAsync());
}).RequireAuthorization();

// ── Routes ──
// RouteStop carries HouseholdName, the full street Address and exact Lat/Lng
// for every collection — and, with a pickup time attached, that is a schedule
// of which houses have bags at the kerb and when. This was anonymous. It
// returned nothing only because no run has been generated yet; the first real
// collection would have published every participating address to the internet.
app.MapGet("/api/routes", async (string? status, GoodSortDbContext db) =>
{
    var q = db.Routes.Include(r => r.Stops).AsQueryable();
    if (!string.IsNullOrEmpty(status)) q = q.Where(r => r.Status == status);
    return Results.Ok(await q.OrderByDescending(r => r.CreatedAt).ToListAsync());
}).RequireAuthorization();

// Same payload as the list above, for one route. Same reason.
app.MapGet("/api/routes/{id:guid}", async (Guid id, GoodSortDbContext db) =>
    await db.Routes.Include(r => r.Stops.OrderBy(s => s.Sequence)).Include(r => r.Depot)
        .FirstOrDefaultAsync(r => r.Id == id) is { } r ? Results.Ok(r) : Results.NotFound())
    .RequireAuthorization();

app.MapPost("/api/routes/{id:guid}/claim", async (HttpContext ctx, Guid id, ClaimRequest req, GoodSortDbContext db) =>
{
    // Body DriverId is ignored — the claimer is the authenticated caller.
    // Trusting the body would let anyone assign a route to another user.
    var callerId = ctx.GetCallerId();
    if (callerId is null) return Results.Unauthorized();
    var route = await db.Routes.FindAsync(id);
    if (route is null || route.Status != "pending") return Results.BadRequest("Not available");
    route.Status = "claimed"; route.DriverId = callerId.Value; route.ClaimedAt = DateTime.UtcNow;
    var profile = await db.Profiles.FindAsync(callerId.Value);
    if (profile is not null) profile.Role = "both";
    await db.SaveChangesAsync();
    return Results.Ok(route);
}).RequireAuthorization();

app.MapPost("/api/routes/{id:guid}/start", async (HttpContext ctx, Guid id, GoodSortDbContext db) =>
{
    var route = await db.Routes.FindAsync(id);
    if (route is null || route.Status != "claimed") return Results.BadRequest();
    if (route.DriverId != ctx.GetCallerId() && !ctx.IsAdmin()) return Results.Forbid();
    route.Status = "in_progress"; route.StartedAt = DateTime.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(route);
}).RequireAuthorization();

app.MapPost("/api/routes/{routeId:guid}/stops/{stopId:guid}/pickup",
    async (HttpContext ctx, Guid routeId, Guid stopId, PickupRequest req, GoodSortDbContext db) =>
{
    var route = await db.Routes.Include(r => r.Stops).FirstOrDefaultAsync(r => r.Id == routeId);
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

app.MapPost("/api/routes/{routeId:guid}/stops/{stopId:guid}/skip",
    async (HttpContext ctx, Guid routeId, Guid stopId, GoodSortDbContext db) =>
{
    var route = await db.Routes.Include(r => r.Stops).FirstOrDefaultAsync(r => r.Id == routeId);
    if (route is null || route.Status != "in_progress") return Results.BadRequest();
    if (route.DriverId != ctx.GetCallerId() && !ctx.IsAdmin()) return Results.Forbid();
    var stop = route.Stops.FirstOrDefault(s => s.Id == stopId);
    if (stop is null || stop.Status != "pending") return Results.BadRequest();
    stop.Status = "skipped";
    if (route.Stops.All(s => s.Status != "pending")) route.Status = "at_depot";
    await db.SaveChangesAsync();
    return Results.Ok(route);
}).RequireAuthorization();

app.MapPost("/api/routes/{id:guid}/settle", async (HttpContext ctx, Guid id, GoodSortDbContext db) =>
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

    var pickedUp = route.Stops.Where(s => s.Status == "picked_up").ToList();
    var totalCollected = pickedUp.Sum(s => s.ActualContainerCount ?? s.ContainerCount);
    var driverPayout = totalCollected * 5; // 5c per container, no base

    route.DriverPayoutCents = driverPayout;
    // Status and SettledAt were written by the claim above; mirror them onto
    // the tracked entity so the response body matches what is stored.
    route.Status = "settled"; route.SettledAt ??= DateTime.UtcNow;

    foreach (var stop in pickedUp)
    {
        var hh = await db.Households.FindAsync(stop.HouseholdId);
        if (hh is null) continue;
        var count = stop.ActualContainerCount ?? stop.ContainerCount;
        hh.PendingContainers = Math.Max(0, hh.PendingContainers - count);
        hh.PendingValueCents = hh.PendingContainers * 5;
        hh.EstimatedBags = (int)Math.Ceiling(hh.PendingContainers / 150.0);
        if (hh.PendingContainers == 0) hh.Materials = new MaterialBreakdown();
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
    return Results.Ok(new { route.Id, driverPayout, totalCollected });
    });
}).RequireAuthorization();

// ── Depots ──
app.MapGet("/api/depots", async (GoodSortDbContext db) =>
    Results.Ok(await db.Depots.ToListAsync()));

// ── Route Optimization (OSRM trip service — open source, no API key) ──
app.MapPost("/api/routes/{id:guid}/optimize", async (HttpContext ctx, Guid id, GoodSortDbContext db, IConfiguration config, IHttpClientFactory httpFactory) =>
{
    var route = await db.Routes.Include(r => r.Stops).Include(r => r.Depot).FirstOrDefaultAsync(r => r.Id == id);
    if (route is null) return Results.NotFound();
    if (route.DriverId != ctx.GetCallerId() && !ctx.IsAdmin()) return Results.Forbid();

    var stops = route.Stops.OrderBy(s => s.Sequence).ToList();
    if (stops.Count < 2) return Results.Ok(new { optimized = false, reason = "Too few stops" });

    // OSRM /trip/ solves the TSP across waypoints. We pin the first stop as
    // the source and the depot as the destination so the runner ends at the
    // dropoff. Public demo endpoint — fine for pilot scale; swap to a
    // self-hosted instance once volume grows.
    // Coordinates are lng,lat (OSRM convention).
    var coords = new List<string> { $"{stops[0].Lng:F6},{stops[0].Lat:F6}" };
    coords.AddRange(stops.Skip(1).Select(s => $"{s.Lng:F6},{s.Lat:F6}"));
    coords.Add($"{route.Depot.Lng:F6},{route.Depot.Lat:F6}");

    var osrmBase = config["OSRM_URL"] ?? "https://router.project-osrm.org";
    var url = $"{osrmBase}/trip/v1/driving/{string.Join(';', coords)}?source=first&destination=last&roundtrip=false&overview=false";

    var client = httpFactory.CreateClient();
    System.Text.Json.JsonElement json;
    try
    {
        var res = await client.GetAsync(url);
        if (!res.IsSuccessStatusCode) return Results.Ok(new { optimized = false, reason = "OSRM call failed" });
        json = await res.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
    }
    catch (Exception ex)
    {
        return Results.Ok(new { optimized = false, reason = $"OSRM error: {ex.Message}" });
    }

    if (json.GetProperty("code").GetString() != "Ok") return Results.Ok(new { optimized = false, reason = json.GetProperty("code").GetString() });

    var trips = json.GetProperty("trips");
    if (trips.GetArrayLength() == 0) return Results.Ok(new { optimized = false, reason = "No trip returned" });
    var trip = trips[0];
    route.EstimatedDurationMin = (int)Math.Round(trip.GetProperty("duration").GetDouble() / 60);
    route.EstimatedDistanceKm = Math.Round(trip.GetProperty("distance").GetDouble() / 1000.0, 1);

    // waypoint_index gives each input coordinate's position in the optimized
    // trip. Input order was [stops[0], stops[1..n-1], depot]; we reorder only
    // the household stops (depot's optimized position is fixed by source/destination).
    var waypoints = json.GetProperty("waypoints");
    for (int i = 0; i < stops.Count && i < waypoints.GetArrayLength(); i++)
    {
        var optimizedIdx = waypoints[i].GetProperty("waypoint_index").GetInt32();
        stops[i].Sequence = optimizedIdx;
    }

    await db.SaveChangesAsync();
    return Results.Ok(new { optimized = true, durationMin = route.EstimatedDurationMin, distanceKm = route.EstimatedDistanceKm });
}).RequireAuthorization();

// ── Cash-out ──
app.MapGet("/api/cashout/status", (CashoutService cashout) =>
    Results.Ok(new
    {
        open = cashout.PayoutsOpen(),
        minCents = 2000,
        message = cashout.PayoutsOpen()
            ? "Bank transfers run weekly once you hit $20."
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

// ── Admin: Generate ABA file (admin only — file contains every payee's BSB+account) ──
app.MapGet("/api/admin/aba-export", async (CashoutService cashout) =>
{
    if (!cashout.PayoutsOpen()) return Results.Ok(new { message = "Payouts are not enabled. Set ABA_PAYOUTS_ENABLED plus a real remitter BSB/account/user id." });
    var aba = await cashout.GenerateAbaFile();
    if (string.IsNullOrEmpty(aba)) return Results.Ok(new { message = "No pending cashouts" });
    return Results.Text(aba, "text/plain");
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Dashboard stats (auth required) ──
app.MapGet("/api/admin/stats", async (GoodSortDbContext db) =>
{
    var users = await db.Profiles.CountAsync();
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

    // Vision API call counter — for Tailor Vision cost tracking
    var since30d = DateTime.UtcNow.AddDays(-30);
    var since7d = DateTime.UtcNow.AddDays(-7);
    var visionTotal = await db.VisionCalls.CountAsync();
    var visionLast30d = await db.VisionCalls.CountAsync(v => v.CreatedAt >= since30d);
    var visionLast7d = await db.VisionCalls.CountAsync(v => v.CreatedAt >= since7d);
    var visionTailor = await db.VisionCalls.CountAsync(v => v.Provider == "tailor" && v.Success);
    var visionOpenAi = await db.VisionCalls.CountAsync(v => v.Provider == "openai" && v.Success);
    var visionFailed = await db.VisionCalls.CountAsync(v => !v.Success);

    // Retention / activation
    var activatedUsers = await db.Profiles.CountAsync(p => p.TotalContainers > 0);
    var householdsWithAddress = await db.Households.CountAsync(h => h.Lat != 0 && h.Lng != 0);
    var runnersRegistered = await db.RunnerProfiles.CountAsync();

    return Results.Ok(new
    {
        users, bins, scans, routes, totalContainers, totalPending, totalCleared,
        runs, runsAvailable, runsInFlight, runsSettled,
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
            openai = visionOpenAi,
            failed = visionFailed,
        },
    });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Tailor Vision (BAINK) health ──
// We can't query BAINK directly from here (it's the upstream billing system at
// baink.tailor.au) but we surface enough side-channel signal to know if Tailor
// Vision is healthy and being billed:
//   - last successful tailor call timestamp (proves end-to-end is working)
//   - tailor success rate over the last hour and day
//   - count of OpenAI fallbacks (each fallback = a Tailor Vision miss = we
//     should NOT be billed for, but worth watching the ratio)
//   - last failure with truncated error (so a 401 = revoked BAINK key is
//     obvious without trawling logs)
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
        .Where(v => v.Provider == "tailor" && v.Success)
        .OrderByDescending(v => v.CreatedAt)
        .Select(v => (DateTime?)v.CreatedAt)
        .FirstOrDefaultAsync();

    var lastTailorFail = await db.VisionCalls
        .Where(v => v.Provider == "tailor" && !v.Success)
        .OrderByDescending(v => v.CreatedAt)
        .Select(v => new { v.CreatedAt, v.ErrorSummary })
        .FirstOrDefaultAsync();

    var tailorOkDurations = hourCalls
        .Where(v => v.Provider == "tailor" && v.Success)
        .Select(v => v.DurationMs)
        .ToList();
    var avgDurationMs = tailorOkDurations.Count > 0
        ? (int)tailorOkDurations.Average()
        : 0;

    int Cnt(string provider, bool success) =>
        dayTotals.Where(t => t.Provider == provider && t.Success == success).Sum(t => t.Count);

    var tailorOk24h = Cnt("tailor", true);
    var tailorFail24h = Cnt("tailor", false);
    var openaiOk24h = Cnt("openai", true);
    var sovrgnOk24h = Cnt("sovrgn", true);
    // Denominator covers ALL provider attempts in last 24h to avoid NaN when
    // every call failed.
    var totalAttempts24h = tailorOk24h + tailorFail24h + openaiOk24h + sovrgnOk24h;
    var fallbackPct24h = totalAttempts24h > 0
        ? Math.Round(100.0 * (openaiOk24h + sovrgnOk24h) / totalAttempts24h, 1)
        : 0;

    var keyConfigured = !string.IsNullOrEmpty(cfg["TAILOR_VISION_API_KEY"]);

    // Coarse health verdict: green if we've had a tailor success in the last hour,
    // amber if the key is configured but no recent success, red if no key.
    var verdict = !keyConfigured
        ? "red:no-key"
        : (lastTailorOk.HasValue && lastTailorOk.Value >= sinceHour)
            ? "green"
            : (lastTailorOk.HasValue ? "amber:stale" : "amber:never-succeeded");

    return Results.Ok(new
    {
        verdict,
        keyConfigured,
        lastTailorSuccess = lastTailorOk,
        lastTailorFailure = lastTailorFail,
        last24h = new
        {
            tailorOk = tailorOk24h,
            tailorFailed = tailorFail24h,
            openaiFallback = openaiOk24h,
            sovrgnFallback = sovrgnOk24h,
            fallbackPct = fallbackPct24h,
        },
        lastHour = new
        {
            calls = hourCalls.Count,
            tailorSuccess = hourCalls.Count(v => v.Provider == "tailor" && v.Success),
            tailorFailure = hourCalls.Count(v => v.Provider == "tailor" && !v.Success),
            avgTailorDurationMs = avgDurationMs,
        },
    });
}).RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: List all users (admin only — PII) ──
app.MapGet("/api/admin/users", async (GoodSortDbContext db) =>
    Results.Ok(await db.Profiles.Include(p => p.Household).OrderByDescending(p => p.CreatedAt).Take(100).ToListAsync()))
    .RequireAuthorization(AuthHelpers.AdminPolicy);

// ── Admin: Tomorrow's pickups + runner status ──
app.MapGet("/api/admin/pickups/tomorrow", async (GoodSortDbContext db) =>
{
    var brisbane = DateTime.UtcNow.AddHours(10);
    var tomorrowDow = (int)brisbane.AddDays(1).DayOfWeek;

    var households = await db.Households
        .Include(h => h.Members)
        .Where(h => h.Type != "unit_complex"
                    && h.CouncilCollectionDay == tomorrowDow
                    && BinStatuses.Serviceable.Contains(h.BinStatus))
        .ToListAsync();

    var hhIds = households.Select(h => h.Id).ToHashSet();
    var bins = await db.Bins.Where(b => b.HouseholdId != null && hhIds.Contains(b.HouseholdId.Value)).ToListAsync();
    var binIds = bins.Select(b => b.Id).ToHashSet();

    var claimingRuns = await db.Runs
        .Include(r => r.Runner).ThenInclude(rp => rp!.Profile)
        .Include(r => r.Stops)
        .Where(r => (r.Status == "available" || r.Status == "claimed" || r.Status == "in_progress")
                    && r.Stops.Any(s => binIds.Contains(s.BinId)))
        .ToListAsync();

    return Results.Ok(new
    {
        tomorrowDayOfWeek = tomorrowDow,
        totalHouseholds = households.Count,
        householdsWithBinOut = households.Count(h => h.BinIsOut),
        runsCovering = claimingRuns.Count,
        runsClaimed = claimingRuns.Count(r => r.Status != "available"),
        householdsUncovered = households.Count(h => !claimingRuns.Any(r => r.Stops.Any(s => bins.Any(b => b.Id == s.BinId && b.HouseholdId == h.Id)))),
        households = households.Select(h => new {
            h.Id, h.Name, h.Address, h.PendingContainers, h.UsesDivider, h.BinIsOut, h.BinStatus,
            memberEmails = h.Members.Select(m => m.Email).Where(e => e != null),
        }),
        runs = claimingRuns.Select(r => new {
            r.Id, r.Status, r.AreaName, r.EstimatedContainers, r.PerContainerCents,
            runnerName = r.Runner != null ? r.Runner.Profile!.Name : null,
            runnerEmail = r.Runner != null ? r.Runner.Profile!.Email : null,
            stops = r.Stops.Count,
        }),
    });
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
    var key = BinDayService.CanonicalSuburb(suburb)!;
    var inSuburb = db.Households
        .Where(h => h.Type != "unit_complex" && h.Suburb != null && h.Suburb.ToUpper() == key);
    var containers = await inSuburb.SumAsync(h => h.PendingContainers);
    var households = await inSuburb.CountAsync();
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

app.MapPost("/api/admin/areas/{suburb}/advance", async (string suburb, int? day, string to, GoodSortDbContext db, NotificationService notif, ILogger<Program> log) =>
{
    if (!WaitlistDensity.CanAllocateSuburb(suburb))
        return Results.BadRequest(new { error = "Not a residential suburb cluster." });
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
    if (req.Name is not null) profile.Name = req.Name;
    if (req.HouseholdId is not null) profile.HouseholdId = req.HouseholdId;
    await db.SaveChangesAsync();
    return Results.Ok(profile);
}).RequireAuthorization();

// ── Profile DELETE — full account wipe (GDPR / privacy-policy right-to-erasure) ──
app.MapDelete("/api/profiles/{id:guid}", async (HttpContext ctx, Guid id, GoodSortDbContext db) =>
{
    if (!ctx.IsOwnerOrAdmin(id)) return Results.Forbid();
    var profile = await db.Profiles.Include(p => p.Scans).Include(p => p.Collections).FirstOrDefaultAsync(p => p.Id == id);
    if (profile is null) return Results.NotFound();

    db.Scans.RemoveRange(profile.Scans);
    db.Collections.RemoveRange(profile.Collections);

    // Null out runner claims so runs aren't orphaned
    var claimedRoutes = await db.Routes.Where(r => r.DriverId == id).ToListAsync();
    foreach (var r in claimedRoutes) r.DriverId = null;

    var runnerProfile = await db.RunnerProfiles.FirstOrDefaultAsync(rp => rp.ProfileId == id);
    if (runnerProfile != null) db.RunnerProfiles.Remove(runnerProfile);

    // Expire OTPs
    var otps = await db.OtpCodes.Where(o => o.Email == profile.Email).ToListAsync();
    db.OtpCodes.RemoveRange(otps);

    db.Profiles.Remove(profile);
    await db.SaveChangesAsync();
    return Results.Ok(new { deleted = true });
}).RequireAuthorization();


// ══════════════════════════════════════════════════════════════════════
// ── RUNNER MARKETPLACE ──
// ══════════════════════════════════════════════════════════════════════

// ── Runner: Register as runner ──
app.MapPost("/api/runner/register", async (HttpContext ctx, RunnerRegisterRequest req, GoodSortDbContext db) =>
{
    var profileId = ctx.GetCallerId();
    if (profileId is null) return Results.Unauthorized();
    var profile = await db.Profiles.FindAsync(profileId.Value);
    if (profile is null) return Results.NotFound("Profile not found");

    var existing = await db.RunnerProfiles.FirstOrDefaultAsync(rp => rp.ProfileId == profileId.Value);
    if (existing is not null) return Results.Ok(existing);

    var runner = new RunnerProfile
    {
        ProfileId = profile.Id,
        VehicleType = req.VehicleType ?? "car",
        VehicleMake = req.VehicleMake ?? "",
        VehicleRego = req.VehicleRego ?? "",
        CapacityBags = req.CapacityBags ?? 10,
        ServiceRadiusKm = req.ServiceRadiusKm ?? 10.0,
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
    var runner = await db.RunnerProfiles.FirstOrDefaultAsync(rp => rp.ProfileId == profileId);
    if (runner is null) return Results.NotFound();
    if (req.VehicleType is not null) runner.VehicleType = req.VehicleType;
    if (req.CapacityBags.HasValue) runner.CapacityBags = req.CapacityBags.Value;
    if (req.ServiceRadiusKm.HasValue) runner.ServiceRadiusKm = req.ServiceRadiusKm.Value;
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
    var runner = await db.RunnerProfiles.FirstOrDefaultAsync(rp => rp.ProfileId == profileId.Value);
    if (runner is null) return Results.NotFound();
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
    var radius = radiusKm ?? 15.0;
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
                x.Run.CentroidLat,
                x.Run.CentroidLng,
                x.Run.MaterialFocus,
                x.Run.EstimatedContainers,
                x.Run.EstimatedWeightKg,
                x.Run.PerContainerCents,
                x.Run.EstimatedPayoutCents,
                x.Run.PricingTier,
                x.Run.EstimatedDistanceKm,
                x.Run.EstimatedDurationMin,
                StopCount = x.Run.Stops.Count,
                x.DistanceKm,
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
    var run = await db.Runs.Include(r => r.Stops).FirstOrDefaultAsync(r => r.Id == id);
    if (run is null || (run.Status != "available" && run.Status != "below_threshold"))
        return Results.BadRequest("Run not available");
    if (run.ExpiresAt <= DateTime.UtcNow) return Results.BadRequest("Run expired");

    var runner = await db.RunnerProfiles.FirstOrDefaultAsync(rp => rp.ProfileId == profileId.Value);
    if (runner is null) return Results.BadRequest("Not registered as runner");

    // Re-price with runner's level bonus
    var result = await pricing.CalculateRate(run, runner);
    run.PerContainerCents = result.PerContainerCents;
    run.EstimatedPayoutCents = result.EstimatedPayoutCents;
    run.PricingTier = result.PricingTier;

    run.RunnerId = runner.Id;
    run.Status = "claimed";
    run.ClaimedAt = DateTime.UtcNow;

    await db.SaveChangesAsync();

    // Return run with stops (now includes lat/lng for navigation)
    return Results.Ok(run);
}).RequireAuthorization();

// ── Marketplace: Start a run ──
app.MapPost("/api/marketplace/runs/{id:guid}/start", async (HttpContext ctx, Guid id, GoodSortDbContext db) =>
{
    var run = await db.Runs.FindAsync(id);
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
    var stop = await db.RunStops.FirstOrDefaultAsync(s => s.RunId == runId && s.Id == stopId);
    if (stop is null || stop.Status != "pending") return Results.BadRequest();
    stop.Status = "arrived";
    stop.ArrivedAt = DateTime.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(stop);
}).RequireAuthorization();

// ── Marketplace: Complete pickup at stop (with photo) ──
app.MapPost("/api/marketplace/runs/{runId:guid}/stops/{stopId:guid}/pickup",
    async (HttpContext ctx, Guid runId, Guid stopId, RunStopPickupRequest req, GoodSortDbContext db) =>
{
    var run = await db.Runs.Include(r => r.Stops).FirstOrDefaultAsync(r => r.Id == runId);
    if (run is null || run.Status != "in_progress") return Results.BadRequest();
    if (!await CallerOwnsRun(ctx, run, db)) return Results.Forbid();

    var stop = run.Stops.FirstOrDefault(s => s.Id == stopId);
    if (stop is null || (stop.Status != "pending" && stop.Status != "arrived")) return Results.BadRequest();

    stop.Status = "picked_up";
    stop.PickedUpAt = DateTime.UtcNow;
    stop.ActualContainers = Math.Clamp(req.ActualContainers, 0, maxContainersPerStop);
    if (req.PhotoUrl is not null) stop.PhotoUrl = req.PhotoUrl;

    await db.SaveChangesAsync();
    return Results.Ok(run);
}).RequireAuthorization();

// ── Marketplace: Skip a stop ──
app.MapPost("/api/marketplace/runs/{runId:guid}/stops/{stopId:guid}/skip",
    async (HttpContext ctx, Guid runId, Guid stopId, GoodSortDbContext db) =>
{
    var run = await db.Runs.Include(r => r.Stops).FirstOrDefaultAsync(r => r.Id == runId);
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
    var run = await db.Runs.Include(r => r.Stops).FirstOrDefaultAsync(r => r.Id == id);
    if (run is null || run.Status != "in_progress") return Results.BadRequest();
    if (!await CallerOwnsRun(ctx, run, db)) return Results.Forbid();

    // Auto-check: all stops must be picked_up or skipped
    if (run.Stops.Any(s => s.Status == "pending" || s.Status == "arrived"))
        return Results.BadRequest("Not all stops completed");

    run.Status = "delivering";
    await db.SaveChangesAsync();
    return Results.Ok(run);
}).RequireAuthorization();

// ── Marketplace: Complete delivery at drop point ──
app.MapPost("/api/marketplace/runs/{id:guid}/complete", async (HttpContext ctx, Guid id, GoodSortDbContext db) =>
{
    var run = await db.Runs.Include(r => r.Stops).FirstOrDefaultAsync(r => r.Id == id);
    if (run is null || run.Status != "delivering") return Results.BadRequest();
    if (!await CallerOwnsRun(ctx, run, db)) return Results.Forbid();

    run.Status = "completed";
    run.CompletedAt = DateTime.UtcNow;
    run.DeliveredAt = DateTime.UtcNow;
    run.ActualContainers = run.Stops.Where(s => s.Status == "picked_up").Sum(s => s.ActualContainers ?? s.EstimatedContainers);

    await db.SaveChangesAsync();
    return Results.Ok(run);
}).RequireAuthorization();

// ── Marketplace: Settle a completed run (run's runner or admin) ──
app.MapPost("/api/marketplace/runs/{id:guid}/settle", async (HttpContext ctx, Guid id, GoodSortDbContext db, RunnerService runnerService) =>
{
    var run = await db.Runs.Include(r => r.Stops).Include(r => r.DropPoint).FirstOrDefaultAsync(r => r.Id == id);
    if (run is null || run.Status != "completed") return Results.BadRequest();
    if (!await CallerOwnsRun(ctx, run, db)) return Results.Forbid();

    // Same reasoning as /api/routes/{id}/settle: claim the transition first,
    // because everything below credits ClearedCents and moves household credit
    // from pending to cleared. Doing that twice mints cash-out-eligible money.
    // Claim and crediting in one transaction — see the route settle above and
    // Atomic. GenerateRating and UpdateRunnerStats both run between the claim
    // and the final save, so a throw in either used to strand the run: settled,
    // nobody paid, and no way to retry.
    return await Atomic.RunAsync(db, async () =>
    {
    if (!await StatusClaim.TryClaimRun(db, run.Id, from: "completed", to: "settled"))
        return Results.BadRequest(new { error = "This run has already been settled." });

    // Calculate actual payout
    run.ActualPayoutCents = run.ActualContainers * run.PerContainerCents;
    run.Status = "settled";
    run.SettledAt ??= DateTime.UtcNow;

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

    // For each picked-up stop: clear the bin counts AND move user/household credit
    // from "pending" (scanned but not yet collected) to "cleared" (cashout-eligible).
    var creditedHouseholds = new List<Household>();
    foreach (var stop in run.Stops.Where(s => s.Status == "picked_up"))
    {
        var bin = await db.Bins.FindAsync(stop.BinId);
        if (bin is null) continue;

        var count = stop.ActualContainers ?? stop.EstimatedContainers;
        bin.PendingContainers = Math.Max(0, bin.PendingContainers - count);
        bin.PendingValueCents = bin.PendingContainers * 5;
        bin.LastCollectedAt = DateTime.UtcNow;
        if (bin.PendingContainers == 0) bin.Materials = new MaterialBreakdown();

        // Household credit is the runner count (5¢), not Vision scans.
        if (bin.HouseholdId.HasValue)
        {
            var hh = await db.Households.Include(h => h.Members).FirstOrDefaultAsync(h => h.Id == bin.HouseholdId);
            if (hh is null) continue;

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
            HouseholdCredit.ApplyPickup(payees, pendingScans, count);

            hh.PendingContainers = Math.Max(0, hh.PendingContainers - count);
            hh.PendingValueCents = hh.PendingContainers * HouseholdCredit.CentsPerContainer;
            hh.EstimatedBags = (int)Math.Ceiling(hh.PendingContainers / 150.0);
            hh.LastPickupAt = DateTime.UtcNow;
            if (hh.PendingContainers == 0) hh.Materials = new MaterialBreakdown();
            creditedHouseholds.Add(hh);
        }
    }

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

    return Results.Ok(new { run.Id, run.ActualPayoutCents, run.ActualContainers, rating = rating.Stars, householdsCredited = creditedHouseholds.Count });
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

    var todayStart = DateTime.UtcNow.Date;
    var weekStart = todayStart.AddDays(-(int)todayStart.DayOfWeek);

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

    // Update individual fields
    config.FloorCents = update.FloorCents;
    config.CeilingCents = update.CeilingCents;
    config.BaseCents = update.BaseCents;
    config.MorningSurge = update.MorningSurge;
    config.NightDiscount = update.NightDiscount;
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

// ── Admin: All marketplace runs ──
app.MapGet("/api/admin/marketplace/runs", async (string? status, GoodSortDbContext db) =>
{
    var q = db.Runs.Include(r => r.Stops).Include(r => r.Runner).AsQueryable();
    if (!string.IsNullOrEmpty(status))
        q = q.Where(r => r.Status == status);
    else
        q = q.Where(r => r.Status != "expired"); // show everything except expired
    return Results.Ok(await q.OrderByDescending(r => r.CreatedAt).Take(100).ToListAsync());
}).RequireAuthorization(AuthHelpers.AdminPolicy);

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

record ProfileUpdateRequest(string? Name, Guid? HouseholdId);
// NOTE: caller-supplied UserId fields are ignored; endpoints read the caller from the JWT.
// Kept on the record for frontend backwards compatibility — safe to remove once frontend stops sending them.
record CashoutRequestDto(Guid UserId, int AmountCents, string Bsb, string AccountNumber, string AccountName);
record PhotoScanRequest(string Image, string? BinCode = null);
record PhotoConfirmRequest(string ScanToken, Guid? UserId = null, List<PhotoConfirmItem>? Items = null, string? BinCode = null, double? Lat = null, double? Lng = null);
record PhotoConfirmItem(string Name, string Material, int Count, bool Eligible);
record SendOtpRequest(string Email);
record VerifyOtpRequest(string Email, string Code, Guid? ReferrerId = null);
record ScanRequest(Guid UserId, string Barcode, string ContainerName, string Material);
record ClaimRequest(Guid DriverId);
record PickupRequest(int ActualCount);
record RunnerRegisterRequest(Guid ProfileId, string? VehicleType, string? VehicleMake, string? VehicleRego, int? CapacityBags, double? ServiceRadiusKm);
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
record RunnerProfileUpdateRequest(string? VehicleType, int? CapacityBags, double? ServiceRadiusKm);
record RunnerHeartbeatRequest(Guid ProfileId, double Lat, double Lng, bool IsOnline);
record MarketplaceClaimRequest(Guid ProfileId);
record RunStopPickupRequest(int ActualContainers, string? PhotoUrl);
record PricingSimulateRequest(int Containers, double DistanceKm, int StopCount);
record AdminBootstrapRequest(string Email);

/// <summary>
/// Exposed so the test project can boot the real application with
/// WebApplicationFactory. Every test before ActivationPathTests called services
/// directly, so routing, auth, model binding and DI were never exercised — all
/// 153 could pass with every endpoint broken.
/// </summary>
public partial class Program { }
