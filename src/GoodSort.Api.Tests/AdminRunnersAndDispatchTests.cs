using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace GoodSort.Api.Tests;

public class AdminRunnersAndDispatchTests : IDisposable
{
    private readonly WebApplicationFactory<Program> _factory;
    private readonly string _dbName = $"admin-runners-{Guid.NewGuid():N}";

    public AdminRunnersAndDispatchTests()
    {
        _factory = CreateFactory(_dbName, requireApproval: false);
    }

    private static WebApplicationFactory<Program> CreateFactory(string dbName, bool requireApproval)
    {
        return new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
            if (requireApproval)
                builder.UseSetting("RUNNER_REQUIRE_APPROVAL", "true");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                services.RemoveAll<GoodSortDbContext>();
                services.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(dbName));
                services.RemoveAll<IHostedService>();
            });
        });
    }

    public void Dispose() => _factory.Dispose();

    private static HttpClient ClientFor(WebApplicationFactory<Program> factory, Profile p)
    {
        using var scope = factory.Services.CreateScope();
        var auth = scope.ServiceProvider.GetRequiredService<AuthService>();
        var token = auth.GenerateJwt(p);
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task<(Profile Admin, Profile RunnerUser, RunnerProfile Runner, Profile OtherRunnerUser, RunnerProfile OtherRunner, Run Run, RunStop Stop, SortedBag Bag)> SeedFleetAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();

        var depot = new Depot
        {
            Name = "RECAN Yeerongpilly",
            Address = "993 Fairfield Rd, Yeerongpilly QLD 4105",
            Lat = -27.531,
            Lng = 153.013,
        };
        var hh = new Household
        {
            Name = "Moorooka House",
            Address = "10 Beaudesert Rd, Moorooka QLD 4105",
            Suburb = "MOOROOKA",
            Lat = -27.533,
            Lng = 153.025,
            PendingContainers = 1000,
            PendingValueCents = 10000,
            BinStatus = "collecting",
            BinIsOut = true,
        };
        var bin = new Bin
        {
            Code = $"HH-{Guid.NewGuid():N}"[..10],
            Name = "Moorooka House",
            Address = hh.Address,
            Lat = hh.Lat,
            Lng = hh.Lng,
            HouseholdId = hh.Id,
            PendingContainers = 1000,
        };
        var admin = new Profile
        {
            Name = "Ops Admin",
            Email = "hello@thegoodsort.org",
            IsAdmin = true,
            Role = "sorter",
        };
        var runnerUser = new Profile
        {
            Name = "Dave Driver",
            Email = "dave@example.test",
            Role = "both",
            HouseholdId = hh.Id,
            PreferredPayoutMethod = "payid",
            PayIdType = "email",
            PayIdValue = "dave@example.test",
        };
        var runner = new RunnerProfile
        {
            ProfileId = runnerUser.Id,
            VehicleType = "van",
            VehicleMake = "Toyota HiAce",
            VehicleRego = "123ABC",
            CapacityBags = 20,
            ServiceRadiusKm = 15,
            CoexSchemeId = "C10001234",
            ApprovalStatus = "approved",
            ApprovedAt = DateTime.UtcNow.AddDays(-2),
            IsOnline = true,
            LastLat = -27.53,
            LastLng = 153.02,
            LastLocationAt = DateTime.UtcNow,
            TotalRuns = 4,
            TotalContainersCollected = 3200,
            LifetimeEarningsCents = 9600,
        };
        var otherUser = new Profile
        {
            Name = "Sam Backup",
            Email = "sam@example.test",
            Role = "both",
        };
        var otherRunner = new RunnerProfile
        {
            ProfileId = otherUser.Id,
            VehicleType = "ute",
            VehicleMake = "Ford Ranger",
            VehicleRego = "999XYZ",
            CapacityBags = 18,
            ServiceRadiusKm = 20,
            ApprovalStatus = "approved",
            ApprovedAt = DateTime.UtcNow.AddDays(-1),
            TotalRuns = 1,
            TotalContainersCollected = 900,
        };
        var run = new Run
        {
            Status = "available",
            DropPointId = depot.Id,
            AreaName = "Moorooka",
            CentroidLat = hh.Lat,
            CentroidLng = hh.Lng,
            EstimatedContainers = 1000,
            EstimatedDistanceKm = 6.0,
            EstimatedDurationMin = 45,
            PerContainerCents = 3,
            EstimatedPayoutCents = 3000,
            PricingTier = 1,
            ExpiresAt = DateTime.UtcNow.AddHours(6),
            Materials = new MaterialBreakdown { Aluminium = 500, Pet = 300, Glass = 200 },
        };
        var stop = new RunStop
        {
            RunId = run.Id,
            BinId = bin.Id,
            Lat = hh.Lat,
            Lng = hh.Lng,
            EstimatedContainers = 1000,
            Sequence = 1,
            Status = "pending",
        };
        var bag = new SortedBag
        {
            HouseholdId = hh.Id,
            CreatorProfileId = runnerUser.Id,
            Code = "GSB-ALU-FLT001",
            Stream = "aluminium",
            DeclaredContainers = 250,
            LinkedScanCount = 250,
            Status = "on_kerb",
        };

        db.Depots.Add(depot);
        db.Households.Add(hh);
        db.Bins.Add(bin);
        db.Profiles.AddRange(admin, runnerUser, otherUser);
        db.RunnerProfiles.AddRange(runner, otherRunner);
        db.Runs.Add(run);
        db.RunStops.Add(stop);
        db.SortedBags.Add(bag);
        if (!await db.PricingConfigs.AnyAsync())
            db.PricingConfigs.Add(new PricingConfig { IsActive = true });
        await db.SaveChangesAsync();

        return (admin, runnerUser, runner, otherUser, otherRunner, run, stop, bag);
    }

    [Fact]
    public async Task Admin_runner_and_dispatch_routes_enforce_admin_policy()
    {
        var (_, runnerUser, runner, _, _, run, _, _) = await SeedFleetAsync();
        using var anon = _factory.CreateClient();
        using var nonAdmin = ClientFor(_factory, runnerUser);

        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/api/admin/runners")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.PatchAsJsonAsync($"/api/admin/runners/{runner.Id}/status", new { status = "suspended" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.PostAsync($"/api/admin/marketplace/runs/{run.Id}/force-release", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.PostAsync("/api/admin/pricing/reprice", null)).StatusCode);

        Assert.Equal(HttpStatusCode.Forbidden, (await nonAdmin.GetAsync("/api/admin/runners")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await nonAdmin.PatchAsJsonAsync($"/api/admin/runners/{runner.Id}/status", new { status = "suspended" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await nonAdmin.PostAsync($"/api/admin/marketplace/runs/{run.Id}/force-release", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await nonAdmin.PostAsync("/api/admin/pricing/reprice", null)).StatusCode);
    }

    [Fact]
    public async Task Suspending_runner_blocks_heartbeat_claim_and_leaderboard_until_reinstated()
    {
        var (admin, runnerUser, runner, _, _, run, _, _) = await SeedFleetAsync();
        using var adminClient = ClientFor(_factory, admin);
        using var runnerClient = ClientFor(_factory, runnerUser);
        using var anon = _factory.CreateClient();

        // Fleet listing shows approved online runner
        var fleetRes = await adminClient.GetAsync("/api/admin/runners");
        Assert.Equal(HttpStatusCode.OK, fleetRes.StatusCode);
        var fleetJson = await fleetRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, fleetJson.GetProperty("summary").GetProperty("totalRunners").GetInt32());
        Assert.Equal(1, fleetJson.GetProperty("summary").GetProperty("onlineNowCount").GetInt32());

        // Admin suspends Dave with an ops note
        var suspendRes = await adminClient.PatchAsJsonAsync($"/api/admin/runners/{runner.Id}/status", new
        {
            status = "suspended",
            adminNote = "Uber XL van — paused pending ABN check",
        });
        Assert.Equal(HttpStatusCode.OK, suspendRes.StatusCode);
        var suspendedBody = await suspendRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("suspended", suspendedBody.GetProperty("approvalStatus").GetString());
        Assert.False(suspendedBody.GetProperty("isOnline").GetBoolean());
        Assert.Equal("Uber XL van — paused pending ABN check", suspendedBody.GetProperty("adminNote").GetString());

        // Suspended runner cannot send heartbeat or claim runs
        var hbRes = await runnerClient.PostAsJsonAsync("/api/runner/heartbeat", new { profileId = runnerUser.Id, lat = -27.53, lng = 153.02, isOnline = true });
        Assert.Equal(HttpStatusCode.Forbidden, hbRes.StatusCode);

        var claimRes = await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{run.Id}/claim", new { profileId = runnerUser.Id });
        Assert.Equal(HttpStatusCode.Forbidden, claimRes.StatusCode);

        // Leaderboard excludes suspended runner
        var lb = await anon.GetFromJsonAsync<JsonElement>("/api/runner/leaderboard");
        var lbIds = lb.EnumerateArray().Select(x => x.GetProperty("runnerId").GetGuid()).ToList();
        Assert.DoesNotContain(runner.Id, lbIds);

        // Admin reinstates Dave → heartbeat & claim work again
        var approveRes = await adminClient.PatchAsJsonAsync($"/api/admin/runners/{runner.Id}/status", new { status = "approved" });
        Assert.Equal(HttpStatusCode.OK, approveRes.StatusCode);

        var hbOk = await runnerClient.PostAsJsonAsync("/api/runner/heartbeat", new { profileId = runnerUser.Id, lat = -27.53, lng = 153.02, isOnline = true });
        Assert.Equal(HttpStatusCode.OK, hbOk.StatusCode);

        var claimOk = await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{run.Id}/claim", new { profileId = runnerUser.Id });
        Assert.Equal(HttpStatusCode.OK, claimOk.StatusCode);
    }

    [Fact]
    public async Task RequireApproval_gate_starts_new_signups_pending_until_admin_approves()
    {
        using var gatedFactory = CreateFactory($"gated-{Guid.NewGuid():N}", requireApproval: true);
        Profile admin;
        Profile applicant;
        Run run;

        using (var scope = gatedFactory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var depot = new Depot { Name = "Depot", Address = "Brisbane", Lat = -27.5, Lng = 153.0 };
            admin = new Profile { Name = "Admin", Email = "hello@thegoodsort.org", IsAdmin = true };
            applicant = new Profile { Name = "New Van Driver", Email = "van@example.test" };
            run = new Run
            {
                Status = "available",
                DropPointId = depot.Id,
                AreaName = "Annerley",
                CentroidLat = -27.51,
                CentroidLng = 153.03,
                EstimatedContainers = 1000,
                PerContainerCents = 3,
                EstimatedPayoutCents = 3000,
                ExpiresAt = DateTime.UtcNow.AddHours(6),
            };
            db.Depots.Add(depot);
            db.Profiles.AddRange(admin, applicant);
            db.Runs.Add(run);
            if (!await db.PricingConfigs.AnyAsync()) db.PricingConfigs.Add(new PricingConfig { IsActive = true });
            await db.SaveChangesAsync();
        }

        using var applicantClient = ClientFor(gatedFactory, applicant);
        using var adminClient = ClientFor(gatedFactory, admin);

        var regRes = await applicantClient.PostAsJsonAsync("/api/runner/register", new
        {
            profileId = applicant.Id,
            vehicleType = "van",
            vehicleMake = "LDV G10",
            vehicleRego = "VAN101",
            capacityBags = 25,
            serviceRadiusKm = 15.0,
        });
        Assert.Equal(HttpStatusCode.Created, regRes.StatusCode);
        var regJson = await regRes.Content.ReadFromJsonAsync<JsonElement>();
        var runnerId = regJson.GetProperty("id").GetGuid();
        Assert.Equal("pending", regJson.GetProperty("approvalStatus").GetString());

        // Pending runner is blocked from claiming until approved
        Assert.Equal(HttpStatusCode.Forbidden, (await applicantClient.PostAsJsonAsync($"/api/marketplace/runs/{run.Id}/claim", new { profileId = applicant.Id })).StatusCode);

        // Admin approves runner → claim succeeds
        Assert.Equal(HttpStatusCode.OK, (await adminClient.PatchAsJsonAsync($"/api/admin/runners/{runnerId}/status", new { status = "approved" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await applicantClient.PostAsJsonAsync($"/api/marketplace/runs/{run.Id}/claim", new { profileId = applicant.Id })).StatusCode);
    }

    [Fact]
    public async Task Force_release_recovers_in_progress_run_requires_confirm_for_picked_up_stops_and_resets_bags()
    {
        var (admin, runnerUser, _, otherUser, _, run, stop, bag) = await SeedFleetAsync();
        using var adminClient = ClientFor(_factory, admin);
        using var runnerClient = ClientFor(_factory, runnerUser);
        using var otherClient = ClientFor(_factory, otherUser);

        // Cannot force-release an already available run
        Assert.Equal(HttpStatusCode.BadRequest, (await adminClient.PostAsync($"/api/admin/marketplace/runs/{run.Id}/force-release", null)).StatusCode);

        // Runner claims, starts, and arrives (not picked up yet)
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{run.Id}/claim", new { profileId = runnerUser.Id })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsync($"/api/marketplace/runs/{run.Id}/start", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsync($"/api/marketplace/runs/{run.Id}/stops/{stop.Id}/arrive", null)).StatusCode);

        // Admin force-releases in_progress run with empty body (no picked-up stops yet)
        var rel1 = await adminClient.PostAsync($"/api/admin/marketplace/runs/{run.Id}/force-release", null);
        Assert.Equal(HttpStatusCode.OK, rel1.StatusCode);
        var rel1Json = await rel1.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("in_progress", rel1Json.GetProperty("previousStatus").GetString());
        Assert.Equal("available", rel1Json.GetProperty("status").GetString());
        Assert.Equal(1, rel1Json.GetProperty("resetStops").GetInt32());

        // Runner claims again, starts, and picks up stop + attaches bag
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{run.Id}/claim", new { profileId = runnerUser.Id })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsync($"/api/marketplace/runs/{run.Id}/start", null)).StatusCode);
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var dbStop = await db.RunStops.FindAsync(stop.Id);
            dbStop!.Status = "picked_up";
            dbStop.PickedUpAt = DateTime.UtcNow;
            dbStop.ActualContainers = 250;
            var dbBag = await db.SortedBags.FindAsync(bag.Id);
            dbBag!.RunId = run.Id;
            dbBag.RunStopId = stop.Id;
            dbBag.Status = "picked_up";
            dbBag.PickedUpAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }

        // Without confirmation, force-release returns 409 Conflict with requiresConfirmation=true
        var conflict = await adminClient.PostAsync($"/api/admin/marketplace/runs/{run.Id}/force-release", null);
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        var conflictJson = await conflict.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(conflictJson.GetProperty("requiresConfirmation").GetBoolean());
        Assert.Equal(1, conflictJson.GetProperty("pickedUpStops").GetInt32());

        // With forceEvenIfPickedUp=true, resets stop + kerb bag and lets another runner claim the run
        var confirmed = await adminClient.PostAsJsonAsync($"/api/admin/marketplace/runs/{run.Id}/force-release", new
        {
            forceEvenIfPickedUp = true,
            publishImmediately = true,
        });
        Assert.Equal(HttpStatusCode.OK, confirmed.StatusCode);
        var confirmedJson = await confirmed.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, confirmedJson.GetProperty("resetStops").GetInt32());
        Assert.Equal(1, confirmedJson.GetProperty("resetBags").GetInt32());

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var dbBag = await db.SortedBags.FindAsync(bag.Id);
            Assert.Equal("on_kerb", dbBag!.Status);
            Assert.Null(dbBag.RunId);
        }

        // Backup runner can now claim the recovered run
        var otherClaim = await otherClient.PostAsJsonAsync($"/api/marketplace/runs/{run.Id}/claim", new { profileId = otherUser.Id });
        Assert.Equal(HttpStatusCode.OK, otherClaim.StatusCode);
    }

    [Fact]
    public async Task Suspend_with_releaseActiveRun_suspends_and_frees_claimed_run_together()
    {
        var (admin, runnerUser, runner, _, _, run, _, _) = await SeedFleetAsync();
        using var adminClient = ClientFor(_factory, admin);
        using var runnerClient = ClientFor(_factory, runnerUser);

        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{run.Id}/claim", new { profileId = runnerUser.Id })).StatusCode);

        var res = await adminClient.PatchAsJsonAsync($"/api/admin/runners/{runner.Id}/status", new
        {
            status = "suspended",
            adminNote = "No-show",
            releaseActiveRun = true,
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("suspended", json.GetProperty("approvalStatus").GetString());
        Assert.Equal(run.Id, json.GetProperty("releasedRunId").GetGuid());

        var runsRes = await adminClient.GetFromJsonAsync<JsonElement>("/api/admin/marketplace/runs");
        var listed = runsRes.EnumerateArray().First(r => r.GetProperty("id").GetGuid() == run.Id);
        Assert.Equal("available", listed.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, listed.GetProperty("runnerId").ValueKind);
    }

    [Fact]
    public async Task Admin_pricing_patch_and_reprice_immediately_syncs_open_runs_up_and_down()
    {
        var (admin, _, _, _, _, run, _, _) = await SeedFleetAsync();
        using var adminClient = ClientFor(_factory, admin);

        // Inverted bounds still rejected
        var current = await adminClient.GetFromJsonAsync<PricingConfig>("/api/admin/pricing");
        Assert.NotNull(current);
        current!.FloorCents = 6;
        current.CeilingCents = 2;
        Assert.Equal(HttpStatusCode.BadRequest, (await adminClient.PatchAsJsonAsync("/api/admin/pricing", current)).StatusCode);

        // Raise band to 4c flat and re-price immediately
        current.FloorCents = 4;
        current.BaseCents = 4;
        current.CeilingCents = 4;
        Assert.Equal(HttpStatusCode.OK, (await adminClient.PatchAsJsonAsync("/api/admin/pricing", current)).StatusCode);

        var upRes = await adminClient.PostAsync("/api/admin/pricing/reprice", null);
        Assert.Equal(HttpStatusCode.OK, upRes.StatusCode);
        var upJson = await upRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(upJson.GetProperty("repricedRuns").GetInt32() >= 1);

        var runsAfterUp = await adminClient.GetFromJsonAsync<JsonElement>("/api/admin/marketplace/runs");
        var runAfterUp = runsAfterUp.EnumerateArray().First(r => r.GetProperty("id").GetGuid() == run.Id);
        Assert.Equal(4, runAfterUp.GetProperty("perContainerCents").GetInt32());
        Assert.Equal(4000, runAfterUp.GetProperty("estimatedPayoutCents").GetInt32());

        // Lower band to 2c flat and re-price immediately (admin explicit re-sync allows decrease)
        current.FloorCents = 2;
        current.BaseCents = 2;
        current.CeilingCents = 2;
        Assert.Equal(HttpStatusCode.OK, (await adminClient.PatchAsJsonAsync("/api/admin/pricing", current)).StatusCode);

        var downRes = await adminClient.PostAsync("/api/admin/pricing/reprice", null);
        Assert.Equal(HttpStatusCode.OK, downRes.StatusCode);

        var runsAfterDown = await adminClient.GetFromJsonAsync<JsonElement>("/api/admin/marketplace/runs");
        var runAfterDown = runsAfterDown.EnumerateArray().First(r => r.GetProperty("id").GetGuid() == run.Id);
        Assert.Equal(2, runAfterDown.GetProperty("perContainerCents").GetInt32());
        Assert.Equal(2000, runAfterDown.GetProperty("estimatedPayoutCents").GetInt32());
    }
}
