using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();
builder.AddSqlServerDbContext<GoodSortDbContext>("goodsortdb");
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<VisionService>();
builder.Services.AddScoped<CashoutService>();
builder.Services.AddHttpClient();

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
    });
});

var app = builder.Build();

app.UseCors();
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
    var sent = await auth.SendOtp(email);
    return sent ? Results.Ok(new { sent = true }) : Results.BadRequest(new { error = "Failed to send code" });
});

app.MapPost("/api/auth/verify-otp", async (VerifyOtpRequest req, AuthService auth) =>
{
    var email = req.Email.Trim().ToLower();
    var (token, profile) = await auth.VerifyOtp(email, req.Code);
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
app.MapPost("/api/scan/photo", async (PhotoScanRequest req, VisionService vision, GoodSortDbContext db) =>
{
    if (string.IsNullOrEmpty(req.Image))
        return Results.BadRequest(new { error = "No image provided" });

    // Strip data URL prefix if present
    var base64 = req.Image;
    if (base64.Contains(",")) base64 = base64.Split(',')[1];

    var containers = await vision.IdentifyContainers(base64);
    var totalItems = containers.Sum(c => c.Count);
    var totalCents = containers.Where(c => c.Eligible).Sum(c => c.Count * 10);

    return Results.Ok(new
    {
        containers,
        totalItems,
        totalCents,
        summary = $"{totalItems} container{(totalItems != 1 ? "s" : "")} found — ${totalCents / 100.0:F2} pending"
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
                RefundCents = 10,
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
    return Results.Created($"/api/households/{household.Id}", household);
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
    var household = await db.Households.FindAsync(profile.HouseholdId);
    if (household is null) return Results.BadRequest("No household");

    var scan = new Scan
    {
        UserId = profile.Id, HouseholdId = household.Id,
        Barcode = req.Barcode, ContainerName = req.ContainerName,
        Material = req.Material, RefundCents = 10, Status = "pending",
    };
    db.Scans.Add(scan);

    profile.PendingCents += 10;
    profile.TotalContainers += 1;
    profile.TotalCo2SavedKg += 0.035;

    household.PendingContainers += 1;
    household.PendingValueCents += 10;
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
    var driverPayout = 2000 + totalCollected * 2;

    route.DriverPayoutCents = driverPayout;
    route.Status = "settled"; route.SettledAt = DateTime.UtcNow;

    foreach (var stop in pickedUp)
    {
        var hh = await db.Households.FindAsync(stop.HouseholdId);
        if (hh is null) continue;
        var count = stop.ActualContainerCount ?? stop.ContainerCount;
        hh.PendingContainers = Math.Max(0, hh.PendingContainers - count);
        hh.PendingValueCents = hh.PendingContainers * 10;
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

// ── Admin: Generate ABA file ──
app.MapGet("/api/admin/aba-export", async (CashoutService cashout) =>
{
    var aba = await cashout.GenerateAbaFile();
    if (string.IsNullOrEmpty(aba)) return Results.Ok(new { message = "No pending cashouts" });
    return Results.Text(aba, "text/plain");
});

// ── Admin: Dashboard stats ──
app.MapGet("/api/admin/stats", async (GoodSortDbContext db) =>
{
    var users = await db.Profiles.CountAsync();
    var households = await db.Households.CountAsync();
    var scans = await db.Scans.CountAsync();
    var routes = await db.Routes.CountAsync();
    var totalContainers = await db.Profiles.SumAsync(p => p.TotalContainers);
    var totalPending = await db.Profiles.SumAsync(p => p.PendingCents);
    var totalCleared = await db.Profiles.SumAsync(p => p.ClearedCents);
    return Results.Ok(new { users, households, scans, routes, totalContainers, totalPending, totalCleared });
});

// ── Admin: List all users ──
app.MapGet("/api/admin/users", async (GoodSortDbContext db) =>
    Results.Ok(await db.Profiles.Include(p => p.Household).OrderByDescending(p => p.CreatedAt).Take(100).ToListAsync()));

// ── Admin: List all cashout requests ──
app.MapGet("/api/admin/cashouts", async (GoodSortDbContext db) =>
    Results.Ok(await db.Set<GoodSort.Api.Services.CashoutRequest>().Include(c => c.User).OrderByDescending(c => c.CreatedAt).Take(100).ToListAsync()));

app.Run();

record CashoutRequestDto(Guid UserId, int AmountCents, string Bsb, string AccountNumber, string AccountName);
record PhotoScanRequest(string Image, string? BinCode = null);
record PhotoConfirmRequest(Guid UserId, List<PhotoConfirmItem> Items, string? BinCode = null);
record PhotoConfirmItem(string Name, string Material, int Count, bool Eligible);
record SendOtpRequest(string Email);
record VerifyOtpRequest(string Email, string Code);
record ScanRequest(Guid UserId, string Barcode, string ContainerName, string Material);
record ClaimRequest(Guid DriverId);
record PickupRequest(int ActualCount);
