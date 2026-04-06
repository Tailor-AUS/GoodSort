using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();
builder.AddSqlServerDbContext<GoodSortDbContext>("goodsortdb");
builder.Services.AddScoped<AuthService>();

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

// ── Auth (Azure Communication Services SMS OTP) ──
app.MapPost("/api/auth/send-otp", async (SendOtpRequest req, AuthService auth) =>
{
    var phone = req.Phone.Trim();
    if (!phone.StartsWith("+")) phone = "+61" + phone.TrimStart('0');
    var sent = await auth.SendOtp(phone);
    return sent ? Results.Ok(new { sent = true }) : Results.BadRequest(new { error = "Failed to send OTP" });
});

app.MapPost("/api/auth/verify-otp", async (VerifyOtpRequest req, AuthService auth) =>
{
    var phone = req.Phone.Trim();
    if (!phone.StartsWith("+")) phone = "+61" + phone.TrimStart('0');
    var (token, profile) = await auth.VerifyOtp(phone, req.Code);
    if (token == null) return Results.Unauthorized();
    return Results.Ok(new { token, profile });
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

app.Run();

record SendOtpRequest(string Phone);
record VerifyOtpRequest(string Phone, string Code);
record ScanRequest(Guid UserId, string Barcode, string ContainerName, string Material);
record ClaimRequest(Guid DriverId);
record PickupRequest(int ActualCount);
