using System.Text;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();
builder.AddSqlServerDbContext<GoodSortDbContext>("goodsortdb");
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<VisionService>();
builder.Services.AddScoped<CashoutService>();
builder.Services.AddScoped<PricingService>();
builder.Services.AddScoped<RunnerService>();
builder.Services.AddScoped<BinDayService>();
builder.Services.AddHostedService<RunGenerationService>();
builder.Services.AddHostedService<PickupReminderService>();
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

// CORS — restrict to actual domains
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(
            "https://www.thegoodsort.org",
            "https://thegoodsort.org",
            "https://kind-mushroom-0fe89a200.2.azurestaticapps.net"
        )
        .AllowAnyHeader()
        .AllowAnyMethod();
    });
});

// JWT Authentication
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
builder.Services.AddAuthorization();

var app = builder.Build();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapDefaultEndpoints();

// Auto-migrate on startup with retry (SQL may not be ready yet)
for (var i = 0; i < 10; i++)
{
    try
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
        await db.Database.MigrateAsync();
        app.Logger.LogInformation("Database migration completed successfully");

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

// ── Auth (Azure Communication Services Email OTP) ──
app.MapPost("/api/auth/send-otp", async (SendOtpRequest req, AuthService auth) =>
{
    var email = req.Email.Trim().ToLower();
    if (!email.Contains('@')) return Results.BadRequest(new { error = "Invalid email" });
    var (success, error) = await auth.SendOtp(email);
    return success ? Results.Ok(new { sent = true }) : Results.BadRequest(new { error = error ?? "Failed to send code" });
});

app.MapPost("/api/auth/verify-otp", async (VerifyOtpRequest req, AuthService auth) =>
{
    var email = req.Email.Trim().ToLower();
    var (token, profile) = await auth.VerifyOtp(email, req.Code, req.ReferrerId);
    if (token == null) return Results.Unauthorized();
    return Results.Ok(new { token, profile });
});

// ── Bins (QR-coded drop points) ──
app.MapGet("/api/bins", async (GoodSortDbContext db) =>
    Results.Ok(await db.Bins.Where(b => b.Status != "disabled").OrderByDescending(b => b.PendingContainers).ToListAsync()));

app.MapGet("/api/bins/{id:guid}", async (Guid id, GoodSortDbContext db) =>
    await db.Bins.FindAsync(id) is { } b ? Results.Ok(b) : Results.NotFound());

app.MapGet("/api/bins/code/{code}", async (string code, GoodSortDbContext db) =>
    await db.Bins.FirstOrDefaultAsync(b => b.Code == code) is { } b ? Results.Ok(b) : Results.NotFound());

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
});

app.MapGet("/api/bins/{id:guid}/qr", (Guid id, GoodSortDbContext db) =>
{
    var bin = db.Bins.Find(id);
    if (bin is null) return Results.NotFound();

    var url = $"https://www.thegoodsort.org/scan?bin={bin.Code}";
    var svg = $@"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 380'>
        <rect width='300' height='380' fill='white' rx='16'/>
        <rect x='20' y='20' width='260' height='260' fill='#f1f5f9' rx='12'/>
        <text x='150' y='160' text-anchor='middle' font-family='system-ui' font-size='48' font-weight='800' fill='#16a34a'>{bin.Code}</text>
        <text x='150' y='200' text-anchor='middle' font-family='system-ui' font-size='14' fill='#64748b'>Scan to recycle</text>
        <text x='150' y='310' text-anchor='middle' font-family='system-ui' font-size='13' font-weight='700' fill='#0f172a'>{bin.Name}</text>
        <text x='150' y='335' text-anchor='middle' font-family='system-ui' font-size='11' fill='#94a3b8'>{url}</text>
        <text x='150' y='365' text-anchor='middle' font-family='system-ui' font-size='10' fill='#16a34a'>thegoodsort.org</text>
    </svg>";

    return Results.Text(svg, "image/svg+xml");
});

// ── Photo Scan (Azure OpenAI Vision) ──
app.MapPost("/api/scan/photo", async (PhotoScanRequest req, VisionService vision, GoodSortDbContext db, IConfiguration cfg) =>
{
    if (string.IsNullOrEmpty(req.Image))
        return Results.BadRequest(new { error = "No image provided" });

    // Cost guardrail — cap daily vision API calls (default 2000/day).
    var dailyCap = int.TryParse(cfg["VISION_DAILY_CAP"], out var c) ? c : 2000;
    var since = DateTime.UtcNow.AddHours(-24);
    var callsToday = await db.VisionCalls.CountAsync(v => v.CreatedAt >= since);
    if (callsToday >= dailyCap)
        return Results.StatusCode(429);

    // Strip data URL prefix if present
    var base64 = req.Image;
    if (base64.Contains(",")) base64 = base64.Split(',')[1];

    var result = await vision.IdentifyContainers(base64);
    var totalItems = result.Containers.Sum(c => c.Count);
    var totalCents = result.Containers.Where(c => c.Eligible).Sum(c => c.Count * 5);

    return Results.Ok(new
    {
        containers = result.Containers,
        totalItems,
        totalCents,
        message = result.Message,
        summary = totalItems > 0
            ? $"{totalItems} container{(totalItems != 1 ? "s" : "")} found — ${totalCents / 100.0:F2} pending"
            : result.Message,
    });
});

// Confirm photo scan — actually creates the scan records
app.MapPost("/api/scan/photo/confirm", async (PhotoConfirmRequest req, GoodSortDbContext db) =>
{
    var profile = await db.Profiles.FindAsync(req.UserId);
    if (profile is null) return Results.NotFound("User not found");
    var household = await db.Households.FindAsync(profile.HouseholdId);
    if (household is null) return Results.BadRequest("No household");

    var totalCents = 0;
    var totalContainers = 0;

    foreach (var item in req.Items)
    {
        if (!item.Eligible) continue;
        for (var i = 0; i < item.Count; i++)
        {
            var scan = new Scan
            {
                UserId = profile.Id,
                HouseholdId = household.Id,
                Barcode = "PHOTO",
                ContainerName = item.Name,
                Material = item.Material,
                RefundCents = 5,
                Status = "pending",
            };
            db.Scans.Add(scan);
            totalContainers++;
            totalCents += 10;
        }
    }

    profile.PendingCents += totalCents;
    profile.TotalContainers += totalContainers;
    profile.TotalCo2SavedKg += totalContainers * 0.035;

    household.PendingContainers += totalContainers;
    household.PendingValueCents += totalCents;
    household.EstimatedWeightKg = household.PendingContainers * 0.020;
    household.EstimatedBags = (int)Math.Ceiling(household.PendingContainers / 150.0);
    household.LastScanAt = DateTime.UtcNow;

    // Update materials
    household.Materials ??= new MaterialBreakdown();
    foreach (var item in req.Items.Where(i => i.Eligible))
    {
        for (var i = 0; i < item.Count; i++)
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

    await db.SaveChangesAsync();
    return Results.Ok(new { totalContainers, totalCents, pendingCents = profile.PendingCents });
});

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
    Results.Ok(await db.Households.OrderByDescending(h => h.PendingContainers).ToListAsync()));

app.MapGet("/api/households/{id:guid}", async (Guid id, GoodSortDbContext db) =>
    await db.Households.FindAsync(id) is { } h ? Results.Ok(h) : Results.NotFound());

app.MapPost("/api/households", async (Household household, GoodSortDbContext db) =>
{
    db.Households.Add(household);
    await db.SaveChangesAsync();

    // Residential households get an implicit "yellow bin" — a Bin that represents
    // the user's kerbside council bin. The RunGenerationService clusters these
    // for pickup on the day before the council truck arrives.
    if (household.Type == "residential")
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
        await db.SaveChangesAsync();
    }
    return Results.Created($"/api/households/{household.Id}", household);
});

// ── Bin-day lookup — auto-fills the yellow bin collection day from an address ──
app.MapPost("/api/households/lookup-bin-day", async (BinDayLookupRequest req, BinDayService svc) =>
{
    var result = await svc.Lookup(req.Lat, req.Lng, req.Address);
    if (result is null) return Results.Ok(new { found = false });
    return Results.Ok(new { found = true, dayOfWeek = result.DayOfWeek, councilArea = result.CouncilArea, source = result.Source });
});

// ── Next pickup — tells the household exactly when we're coming for their bin ──
app.MapGet("/api/households/{id:guid}/next-pickup", async (Guid id, GoodSortDbContext db) =>
{
    var h = await db.Households.FindAsync(id);
    if (h is null) return Results.NotFound();
    if (h.Type != "residential" || h.CouncilCollectionDay is null)
        return Results.Ok(new { nextPickup = (DateTime?)null, reason = "Not a residential household with a council collection day set." });

    // We collect the night/day BEFORE council pickup. So runner day = (councilDay - 1) mod 7.
    var today = DateTime.UtcNow.Date;
    var runnerDay = ((h.CouncilCollectionDay.Value + 6) % 7); // day before council, 0=Sun..6=Sat
    var daysAhead = ((int)runnerDay - (int)today.DayOfWeek + 7) % 7;
    if (daysAhead == 0) daysAhead = 7; // if today is runner day but already past, target next week
    var next = today.AddDays(daysAhead);
    return Results.Ok(new
    {
        nextPickup = next,
        councilDay = h.CouncilCollectionDay,
        councilArea = h.CouncilArea,
        usesDivider = h.UsesDivider,
    });
});

// ── Waitlist for unit_complex customers (phase 2) ──
app.MapPost("/api/waitlist/unit-complex", async (UnitComplexWaitlistRequest req, GoodSortDbContext db) =>
{
    var placeholder = new Household
    {
        Type = "unit_complex",
        Name = req.BuildingName,
        Address = req.Address,
        Lat = req.Lat,
        Lng = req.Lng,
        BuildingName = req.BuildingName,
    };
    db.Households.Add(placeholder);
    await db.SaveChangesAsync();
    return Results.Ok(new { waitlisted = true, id = placeholder.Id });
});

// ── Profiles ──
app.MapGet("/api/profiles/{id:guid}", async (Guid id, GoodSortDbContext db) =>
    await db.Profiles.Include(p => p.Household).FirstOrDefaultAsync(p => p.Id == id)
    is { } p ? Results.Ok(p) : Results.NotFound());

app.MapPost("/api/profiles", async (Profile profile, GoodSortDbContext db) =>
{
    db.Profiles.Add(profile);
    await db.SaveChangesAsync();
    return Results.Created($"/api/profiles/{profile.Id}", profile);
});

// ── Scans ──
app.MapPost("/api/scans", async (ScanRequest req, GoodSortDbContext db) =>
{
    var profile = await db.Profiles.FindAsync(req.UserId);
    if (profile is null) return Results.NotFound("User not found");

    var scan = new Scan
    {
        UserId = profile.Id,
        HouseholdId = profile.HouseholdId, // nullable — works without household
        Barcode = req.Barcode, ContainerName = req.ContainerName,
        Material = req.Material, RefundCents = 5, Status = "pending",
    };
    db.Scans.Add(scan);

    profile.PendingCents += 5;
    profile.TotalContainers += 1;
    profile.TotalCo2SavedKg += 0.035;

    // Update household stats if assigned
    var household = profile.HouseholdId.HasValue
        ? await db.Households.FindAsync(profile.HouseholdId)
        : null;
    if (household is not null)
    {
        household.PendingContainers += 1;
        household.PendingValueCents += 5;
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
    }

    await db.SaveChangesAsync();
    return Results.Ok(new { scan.Id, profile.PendingCents, profile.TotalContainers });
});

app.MapGet("/api/scans", async (Guid userId, int? limit, GoodSortDbContext db) =>
    Results.Ok(await db.Scans.Where(s => s.UserId == userId)
        .OrderByDescending(s => s.CreatedAt).Take(limit ?? 20).ToListAsync()));

// ── Routes ──
app.MapGet("/api/routes", async (string? status, GoodSortDbContext db) =>
{
    var q = db.Routes.Include(r => r.Stops).AsQueryable();
    if (!string.IsNullOrEmpty(status)) q = q.Where(r => r.Status == status);
    return Results.Ok(await q.OrderByDescending(r => r.CreatedAt).ToListAsync());
});

app.MapGet("/api/routes/{id:guid}", async (Guid id, GoodSortDbContext db) =>
    await db.Routes.Include(r => r.Stops.OrderBy(s => s.Sequence)).Include(r => r.Depot)
        .FirstOrDefaultAsync(r => r.Id == id) is { } r ? Results.Ok(r) : Results.NotFound());

app.MapPost("/api/routes/{id:guid}/claim", async (Guid id, ClaimRequest req, GoodSortDbContext db) =>
{
    var route = await db.Routes.FindAsync(id);
    if (route is null || route.Status != "pending") return Results.BadRequest("Not available");
    route.Status = "claimed"; route.DriverId = req.DriverId; route.ClaimedAt = DateTime.UtcNow;
    var profile = await db.Profiles.FindAsync(req.DriverId);
    if (profile is not null) profile.Role = "both";
    await db.SaveChangesAsync();
    return Results.Ok(route);
});

app.MapPost("/api/routes/{id:guid}/start", async (Guid id, GoodSortDbContext db) =>
{
    var route = await db.Routes.FindAsync(id);
    if (route is null || route.Status != "claimed") return Results.BadRequest();
    route.Status = "in_progress"; route.StartedAt = DateTime.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(route);
});

app.MapPost("/api/routes/{routeId:guid}/stops/{stopId:guid}/pickup",
    async (Guid routeId, Guid stopId, PickupRequest req, GoodSortDbContext db) =>
{
    var route = await db.Routes.Include(r => r.Stops).FirstOrDefaultAsync(r => r.Id == routeId);
    if (route is null || route.Status != "in_progress") return Results.BadRequest();
    var stop = route.Stops.FirstOrDefault(s => s.Id == stopId);
    if (stop is null || stop.Status != "pending") return Results.BadRequest();
    stop.Status = "picked_up"; stop.PickedUpAt = DateTime.UtcNow; stop.ActualContainerCount = req.ActualCount;
    if (route.Stops.All(s => s.Status != "pending")) route.Status = "at_depot";
    await db.SaveChangesAsync();
    return Results.Ok(route);
});

app.MapPost("/api/routes/{routeId:guid}/stops/{stopId:guid}/skip",
    async (Guid routeId, Guid stopId, GoodSortDbContext db) =>
{
    var route = await db.Routes.Include(r => r.Stops).FirstOrDefaultAsync(r => r.Id == routeId);
    if (route is null || route.Status != "in_progress") return Results.BadRequest();
    var stop = route.Stops.FirstOrDefault(s => s.Id == stopId);
    if (stop is null || stop.Status != "pending") return Results.BadRequest();
    stop.Status = "skipped";
    if (route.Stops.All(s => s.Status != "pending")) route.Status = "at_depot";
    await db.SaveChangesAsync();
    return Results.Ok(route);
});

app.MapPost("/api/routes/{id:guid}/settle", async (Guid id, GoodSortDbContext db) =>
{
    var route = await db.Routes.Include(r => r.Stops).Include(r => r.Depot)
        .FirstOrDefaultAsync(r => r.Id == id);
    if (route is null || route.Status != "at_depot") return Results.BadRequest();

    var pickedUp = route.Stops.Where(s => s.Status == "picked_up").ToList();
    var totalCollected = pickedUp.Sum(s => s.ActualContainerCount ?? s.ContainerCount);
    var driverPayout = totalCollected * 5; // 5c per container, no base

    route.DriverPayoutCents = driverPayout;
    route.Status = "settled"; route.SettledAt = DateTime.UtcNow;

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

// ── Depots ──
app.MapGet("/api/depots", async (GoodSortDbContext db) =>
    Results.Ok(await db.Depots.ToListAsync()));

// ── Route Optimization (Google Directions API) ──
app.MapPost("/api/routes/{id:guid}/optimize", async (Guid id, GoodSortDbContext db, IConfiguration config, IHttpClientFactory httpFactory) =>
{
    var route = await db.Routes.Include(r => r.Stops).Include(r => r.Depot).FirstOrDefaultAsync(r => r.Id == id);
    if (route is null) return Results.NotFound();

    var mapsKey = config["GOOGLE_MAPS_SERVER_KEY"] ?? config["NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"] ?? "";
    if (string.IsNullOrEmpty(mapsKey)) return Results.Ok(new { optimized = false, reason = "No API key" });

    var stops = route.Stops.OrderBy(s => s.Sequence).ToList();
    if (stops.Count < 2) return Results.Ok(new { optimized = false, reason = "Too few stops" });

    // Build waypoints for Directions API
    var origin = $"{stops[0].Lat},{stops[0].Lng}";
    var destination = $"{route.Depot.Lat},{route.Depot.Lng}";
    var waypoints = string.Join("|", stops.Skip(1).Select(s => $"{s.Lat},{s.Lng}"));

    var client = httpFactory.CreateClient();
    var url = $"https://maps.googleapis.com/maps/api/directions/json?origin={origin}&destination={destination}&waypoints=optimize:true|{waypoints}&key={mapsKey}";
    var res = await client.GetAsync(url);
    if (!res.IsSuccessStatusCode) return Results.Ok(new { optimized = false, reason = "API call failed" });

    var json = await res.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
    if (json.GetProperty("status").GetString() != "OK") return Results.Ok(new { optimized = false, reason = json.GetProperty("status").GetString() });

    var leg = json.GetProperty("routes")[0].GetProperty("legs");
    var totalDuration = 0;
    var totalDistance = 0;
    for (int i = 0; i < leg.GetArrayLength(); i++)
    {
        totalDuration += leg[i].GetProperty("duration").GetProperty("value").GetInt32();
        totalDistance += leg[i].GetProperty("distance").GetProperty("value").GetInt32();
    }

    // Update route with real values
    route.EstimatedDurationMin = totalDuration / 60;
    route.EstimatedDistanceKm = Math.Round(totalDistance / 1000.0, 1);

    // Reorder stops based on optimized waypoint order
    var order = json.GetProperty("routes")[0].GetProperty("waypoint_order");
    for (int i = 0; i < order.GetArrayLength(); i++)
    {
        var originalIdx = order[i].GetInt32() + 1; // +1 because origin is stop[0]
        if (originalIdx < stops.Count)
            stops[originalIdx].Sequence = i + 1;
    }
    stops[0].Sequence = 0; // Origin stays first

    await db.SaveChangesAsync();
    return Results.Ok(new { optimized = true, durationMin = route.EstimatedDurationMin, distanceKm = route.EstimatedDistanceKm });
});

// ── Cash-out ──
app.MapPost("/api/cashout", async (CashoutRequestDto req, CashoutService cashout) =>
{
    var (success, error) = await cashout.RequestCashout(req.UserId, req.AmountCents, req.Bsb, req.AccountNumber, req.AccountName);
    return success ? Results.Ok(new { success = true }) : Results.BadRequest(new { error });
});

// ── Admin: Generate ABA file (auth required) ──
app.MapGet("/api/admin/aba-export", async (CashoutService cashout) =>
{
    var aba = await cashout.GenerateAbaFile();
    if (string.IsNullOrEmpty(aba)) return Results.Ok(new { message = "No pending cashouts" });
    return Results.Text(aba, "text/plain");
}).RequireAuthorization();

// ── Admin: Dashboard stats (auth required) ──
app.MapGet("/api/admin/stats", async (GoodSortDbContext db) =>
{
    var users = await db.Profiles.CountAsync();
    var bins = await db.Bins.CountAsync();
    var scans = await db.Scans.CountAsync();
    var routes = await db.Routes.CountAsync();
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
}).RequireAuthorization();

// ── Admin: List all users (auth required) ──
app.MapGet("/api/admin/users", async (GoodSortDbContext db) =>
    Results.Ok(await db.Profiles.Include(p => p.Household).OrderByDescending(p => p.CreatedAt).Take(100).ToListAsync()))
    .RequireAuthorization();

// ── Admin: List all cashout requests (auth required) ──
app.MapGet("/api/admin/cashouts", async (GoodSortDbContext db) =>
    Results.Ok(await db.Set<GoodSort.Api.Services.CashoutRequest>().Include(c => c.User).OrderByDescending(c => c.CreatedAt).Take(100).ToListAsync()))
    .RequireAuthorization();

// ── Profile PATCH (update name + household) ──
app.MapPatch("/api/profiles/{id:guid}", async (Guid id, ProfileUpdateRequest req, GoodSortDbContext db) =>
{
    var profile = await db.Profiles.FindAsync(id);
    if (profile is null) return Results.NotFound();
    if (req.Name is not null) profile.Name = req.Name;
    if (req.HouseholdId is not null) profile.HouseholdId = req.HouseholdId;
    await db.SaveChangesAsync();
    return Results.Ok(profile);
});

// ── Profile DELETE — full account wipe (GDPR / privacy-policy right-to-erasure) ──
app.MapDelete("/api/profiles/{id:guid}", async (Guid id, GoodSortDbContext db) =>
{
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
app.MapPost("/api/runner/register", async (RunnerRegisterRequest req, GoodSortDbContext db) =>
{
    var profile = await db.Profiles.FindAsync(req.ProfileId);
    if (profile is null) return Results.NotFound("Profile not found");

    var existing = await db.RunnerProfiles.FirstOrDefaultAsync(rp => rp.ProfileId == req.ProfileId);
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
});

// ── Runner: Get my profile ──
app.MapGet("/api/runner/profile/{profileId:guid}", async (Guid profileId, GoodSortDbContext db) =>
    await db.RunnerProfiles.Include(rp => rp.Profile).FirstOrDefaultAsync(rp => rp.ProfileId == profileId)
    is { } rp ? Results.Ok(rp) : Results.NotFound());

// ── Runner: Update profile ──
app.MapPatch("/api/runner/profile/{profileId:guid}", async (Guid profileId, RunnerProfileUpdateRequest req, GoodSortDbContext db) =>
{
    var runner = await db.RunnerProfiles.FirstOrDefaultAsync(rp => rp.ProfileId == profileId);
    if (runner is null) return Results.NotFound();
    if (req.VehicleType is not null) runner.VehicleType = req.VehicleType;
    if (req.CapacityBags.HasValue) runner.CapacityBags = req.CapacityBags.Value;
    if (req.ServiceRadiusKm.HasValue) runner.ServiceRadiusKm = req.ServiceRadiusKm.Value;
    await db.SaveChangesAsync();
    return Results.Ok(runner);
});

// ── Runner: Location heartbeat ──
app.MapPost("/api/runner/heartbeat", async (RunnerHeartbeatRequest req, GoodSortDbContext db) =>
{
    var runner = await db.RunnerProfiles.FirstOrDefaultAsync(rp => rp.ProfileId == req.ProfileId);
    if (runner is null) return Results.NotFound();
    runner.IsOnline = req.IsOnline;
    runner.LastLat = req.Lat;
    runner.LastLng = req.Lng;
    runner.LastLocationAt = DateTime.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(new { online = runner.IsOnline });
});

// ── Marketplace: Get available runs near location ──
app.MapGet("/api/marketplace/runs", async (double lat, double lng, double? radiusKm, GoodSortDbContext db) =>
{
    var radius = radiusKm ?? 15.0;
    var runs = await db.Runs
        .Include(r => r.Stops)
        .Where(r => r.Status == "available" && r.ExpiresAt > DateTime.UtcNow)
        .ToListAsync();

    // Filter by distance from runner (haversine)
    var nearby = runs
        .Select(r => new
        {
            Run = r,
            DistanceKm = HaversineKm(lat, lng, r.CentroidLat, r.CentroidLng)
        })
        .Where(x => x.DistanceKm <= radius)
        .OrderBy(x => x.DistanceKm)
        .Select(x => new
        {
            x.Run.Id,
            x.Run.Status,
            x.Run.AreaName,
            x.Run.CentroidLat,
            x.Run.CentroidLng,
            x.Run.EstimatedContainers,
            x.Run.PerContainerCents,
            x.Run.EstimatedPayoutCents,
            x.Run.PricingTier,
            x.Run.EstimatedDistanceKm,
            x.Run.EstimatedDurationMin,
            StopCount = x.Run.Stops.Count,
            x.DistanceKm,
            x.Run.ExpiresAt,
            x.Run.Materials,
        })
        .ToList();

    return Results.Ok(nearby);
});

// ── Marketplace: Claim a run ──
app.MapPost("/api/marketplace/runs/{id:guid}/claim", async (Guid id, MarketplaceClaimRequest req, GoodSortDbContext db, PricingService pricing) =>
{
    var run = await db.Runs.Include(r => r.Stops).FirstOrDefaultAsync(r => r.Id == id);
    if (run is null || run.Status != "available") return Results.BadRequest("Run not available");
    if (run.ExpiresAt <= DateTime.UtcNow) return Results.BadRequest("Run expired");

    var runner = await db.RunnerProfiles.FirstOrDefaultAsync(rp => rp.ProfileId == req.ProfileId);
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
});

// ── Marketplace: Start a run ──
app.MapPost("/api/marketplace/runs/{id:guid}/start", async (Guid id, GoodSortDbContext db) =>
{
    var run = await db.Runs.FindAsync(id);
    if (run is null || run.Status != "claimed") return Results.BadRequest();
    run.Status = "in_progress";
    run.StartedAt = DateTime.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(run);
});

// ── Marketplace: Arrive at stop ──
app.MapPost("/api/marketplace/runs/{runId:guid}/stops/{stopId:guid}/arrive",
    async (Guid runId, Guid stopId, GoodSortDbContext db) =>
{
    var stop = await db.RunStops.FirstOrDefaultAsync(s => s.RunId == runId && s.Id == stopId);
    if (stop is null || stop.Status != "pending") return Results.BadRequest();
    stop.Status = "arrived";
    stop.ArrivedAt = DateTime.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(stop);
});

// ── Marketplace: Complete pickup at stop (with photo) ──
app.MapPost("/api/marketplace/runs/{runId:guid}/stops/{stopId:guid}/pickup",
    async (Guid runId, Guid stopId, RunStopPickupRequest req, GoodSortDbContext db) =>
{
    var run = await db.Runs.Include(r => r.Stops).FirstOrDefaultAsync(r => r.Id == runId);
    if (run is null || run.Status != "in_progress") return Results.BadRequest();

    var stop = run.Stops.FirstOrDefault(s => s.Id == stopId);
    if (stop is null || (stop.Status != "pending" && stop.Status != "arrived")) return Results.BadRequest();

    stop.Status = "picked_up";
    stop.PickedUpAt = DateTime.UtcNow;
    stop.ActualContainers = req.ActualContainers;
    if (req.PhotoUrl is not null) stop.PhotoUrl = req.PhotoUrl;

    await db.SaveChangesAsync();
    return Results.Ok(run);
});

// ── Marketplace: Skip a stop ──
app.MapPost("/api/marketplace/runs/{runId:guid}/stops/{stopId:guid}/skip",
    async (Guid runId, Guid stopId, GoodSortDbContext db) =>
{
    var run = await db.Runs.Include(r => r.Stops).FirstOrDefaultAsync(r => r.Id == runId);
    if (run is null || run.Status != "in_progress") return Results.BadRequest();

    var stop = run.Stops.FirstOrDefault(s => s.Id == stopId);
    if (stop is null || (stop.Status != "pending" && stop.Status != "arrived")) return Results.BadRequest();

    stop.Status = "skipped";
    await db.SaveChangesAsync();
    return Results.Ok(run);
});

// ── Marketplace: Mark run as delivering (heading to drop point) ──
app.MapPost("/api/marketplace/runs/{id:guid}/deliver", async (Guid id, GoodSortDbContext db) =>
{
    var run = await db.Runs.Include(r => r.Stops).FirstOrDefaultAsync(r => r.Id == id);
    if (run is null || run.Status != "in_progress") return Results.BadRequest();

    // Auto-check: all stops must be picked_up or skipped
    if (run.Stops.Any(s => s.Status == "pending" || s.Status == "arrived"))
        return Results.BadRequest("Not all stops completed");

    run.Status = "delivering";
    await db.SaveChangesAsync();
    return Results.Ok(run);
});

// ── Marketplace: Complete delivery at drop point ──
app.MapPost("/api/marketplace/runs/{id:guid}/complete", async (Guid id, GoodSortDbContext db) =>
{
    var run = await db.Runs.Include(r => r.Stops).FirstOrDefaultAsync(r => r.Id == id);
    if (run is null || run.Status != "delivering") return Results.BadRequest();

    run.Status = "completed";
    run.CompletedAt = DateTime.UtcNow;
    run.DeliveredAt = DateTime.UtcNow;
    run.ActualContainers = run.Stops.Where(s => s.Status == "picked_up").Sum(s => s.ActualContainers ?? s.EstimatedContainers);

    await db.SaveChangesAsync();
    return Results.Ok(run);
});

// ── Marketplace: Settle a completed run (admin) ──
app.MapPost("/api/marketplace/runs/{id:guid}/settle", async (Guid id, GoodSortDbContext db, RunnerService runnerService) =>
{
    var run = await db.Runs.Include(r => r.Stops).Include(r => r.DropPoint).FirstOrDefaultAsync(r => r.Id == id);
    if (run is null || run.Status != "completed") return Results.BadRequest();

    // Calculate actual payout
    run.ActualPayoutCents = run.ActualContainers * run.PerContainerCents;
    run.Status = "settled";
    run.SettledAt = DateTime.UtcNow;

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

    // Clear bin pending counts for picked-up stops
    foreach (var stop in run.Stops.Where(s => s.Status == "picked_up"))
    {
        var bin = await db.Bins.FindAsync(stop.BinId);
        if (bin is not null)
        {
            var count = stop.ActualContainers ?? stop.EstimatedContainers;
            bin.PendingContainers = Math.Max(0, bin.PendingContainers - count);
            bin.PendingValueCents = bin.PendingContainers * 5;
            bin.LastCollectedAt = DateTime.UtcNow;
            if (bin.PendingContainers == 0) bin.Materials = new MaterialBreakdown();
        }
    }

    await db.SaveChangesAsync();
    return Results.Ok(new { run.Id, run.ActualPayoutCents, run.ActualContainers, rating = rating.Stars });
}).RequireAuthorization();

// ── Runner: My runs ──
app.MapGet("/api/runner/runs/{profileId:guid}", async (Guid profileId, string? status, GoodSortDbContext db) =>
{
    var runner = await db.RunnerProfiles.FirstOrDefaultAsync(rp => rp.ProfileId == profileId);
    if (runner is null) return Results.NotFound();

    var q = db.Runs.Include(r => r.Stops).Where(r => r.RunnerId == runner.Id);
    if (!string.IsNullOrEmpty(status)) q = q.Where(r => r.Status == status);
    return Results.Ok(await q.OrderByDescending(r => r.CreatedAt).Take(50).ToListAsync());
});

// ── Runner: My active run ──
app.MapGet("/api/runner/active/{profileId:guid}", async (Guid profileId, GoodSortDbContext db) =>
{
    var runner = await db.RunnerProfiles.FirstOrDefaultAsync(rp => rp.ProfileId == profileId);
    if (runner is null) return Results.NotFound();

    var active = await db.Runs
        .Include(r => r.Stops.OrderBy(s => s.Sequence))
        .Include(r => r.DropPoint)
        .Where(r => r.RunnerId == runner.Id && (r.Status == "claimed" || r.Status == "in_progress" || r.Status == "delivering"))
        .FirstOrDefaultAsync();

    return active is not null ? Results.Ok(active) : Results.NotFound();
});

// ── Gamification: Earnings summary ──
app.MapGet("/api/runner/earnings/{profileId:guid}", async (Guid profileId, GoodSortDbContext db) =>
{
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
});

// ── Gamification: Leaderboard ──
app.MapGet("/api/runner/leaderboard", async (string? period, int? limit, RunnerService runnerService) =>
    Results.Ok(await runnerService.GetLeaderboard(period ?? "all", limit ?? 20)));

// ── Admin: Pricing config ──
app.MapGet("/api/admin/pricing", async (PricingService pricing) =>
    Results.Ok(await pricing.GetActiveConfig())).RequireAuthorization();

app.MapPatch("/api/admin/pricing", async (PricingConfig update, GoodSortDbContext db) =>
{
    var config = await db.PricingConfigs.FirstOrDefaultAsync(pc => pc.IsActive);
    if (config is null) return Results.NotFound();
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
}).RequireAuthorization();

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
}).RequireAuthorization();

// ── Admin: All marketplace runs ──
app.MapGet("/api/admin/marketplace/runs", async (string? status, GoodSortDbContext db) =>
{
    var q = db.Runs.Include(r => r.Stops).Include(r => r.Runner).AsQueryable();
    if (!string.IsNullOrEmpty(status)) q = q.Where(r => r.Status == status);
    return Results.Ok(await q.OrderByDescending(r => r.CreatedAt).Take(100).ToListAsync());
}).RequireAuthorization();

app.Run();

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
record CashoutRequestDto(Guid UserId, int AmountCents, string Bsb, string AccountNumber, string AccountName);
record PhotoScanRequest(string Image, string? BinCode = null);
record PhotoConfirmRequest(Guid UserId, List<PhotoConfirmItem> Items, string? BinCode = null);
record PhotoConfirmItem(string Name, string Material, int Count, bool Eligible);
record SendOtpRequest(string Email);
record VerifyOtpRequest(string Email, string Code, Guid? ReferrerId = null);
record ScanRequest(Guid UserId, string Barcode, string ContainerName, string Material);
record ClaimRequest(Guid DriverId);
record PickupRequest(int ActualCount);
record RunnerRegisterRequest(Guid ProfileId, string? VehicleType, string? VehicleMake, string? VehicleRego, int? CapacityBags, double? ServiceRadiusKm);
record UnitComplexWaitlistRequest(string BuildingName, string Address, double Lat, double Lng);
record BinDayLookupRequest(double Lat, double Lng, string? Address);
record RunnerProfileUpdateRequest(string? VehicleType, int? CapacityBags, double? ServiceRadiusKm);
record RunnerHeartbeatRequest(Guid ProfileId, double Lat, double Lng, bool IsOnline);
record MarketplaceClaimRequest(Guid ProfileId);
record RunStopPickupRequest(int ActualContainers, string? PhotoUrl);
record PricingSimulateRequest(int Containers, double DistanceKm, int StopCount);
