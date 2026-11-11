using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using GoodSort.Api.Tests.OpaqueBox;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace GoodSort.Api.Tests;

/// <summary>
/// Pins the Pass 7 QA &amp; hardening fixes (TailorAU/tailor-group#600):
/// 1. BinDayService.ParseAddress Australian unit/lettered/ranged/3-part comma support + Escape backslash safety.
/// 2. GET /api/routes &amp; /api/routes/{id} tenant isolation (only assigned driver or admin sees household addresses).
/// 3. 2-decimal (~1.1 km) centroid privacy rounding on availableRuns in /api/marketplace/overview and /api/marketplace/runs.
/// 4. Run lifecycle guards: /arrive requires in_progress, /scan-bag blocks cross-stop hijacking, /pickup validates PhotoUrl scheme.
/// 5. GDPR DELETE /api/profiles/{id} releases in_progress/delivering runs and returns unverified picked_up SortedBags to on_kerb.
/// 6. CashoutService MaxSingleCashoutCents ceiling, 64-bit ABA totalAmount, and concurrent InMemory double-spend gate.
/// </summary>
public class Pass7HardeningTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;

    public Pass7HardeningTests(OpaqueBoxHost host) => _host = host;

    [Theory]
    [InlineData("2/12 Beaudesert Road, Moorooka QLD 4105", "12", "BEAUDESERT RD", "MOOROOKA")]
    [InlineData("Unit 2/12 Beaudesert Road, Moorooka QLD 4105", "12", "BEAUDESERT RD", "MOOROOKA")]
    [InlineData("Unit 2 12 Beaudesert Road, Moorooka QLD 4105", "12", "BEAUDESERT RD", "MOOROOKA")]
    [InlineData("Unit 2, 12A Beaudesert Road, Moorooka QLD 4105, Australia", "12A", "BEAUDESERT RD", "MOOROOKA")]
    [InlineData("12-14 Beaudesert Ave, Moorooka 4105", "12", "BEAUDESERT AVE", "MOOROOKA")]
    [InlineData("The Oaks, 88 Ipswich Street, Annerley QLD 4103", "88", "IPSWICH ST", "ANNERLEY")]
    public void ParseAddress_handles_Australian_unit_lettered_ranged_and_three_part_addresses(
        string raw, string expectedNum, string expectedStreet, string expectedSuburb)
    {
        var parsed = BinDayService.ParseAddress(raw);
        Assert.NotNull(parsed);
        Assert.Equal(expectedNum, parsed!.HouseNumber);
        Assert.Equal(expectedStreet, parsed.Street);
        Assert.Equal(expectedSuburb, BinDayService.CanonicalSuburb(parsed.Suburb));
    }

    [Fact]
    public void BinDayService_Escape_escapes_backslashes_before_quotes()
    {
        Assert.Equal("A\\\\\\\"B", BinDayService.Escape("A\\\"B"));
    }

    [Fact]
    public async Task Collection_routes_do_not_expose_household_addresses_to_other_members()
    {
        var (driverClient, _, driverId) = await _host.SignInMemberAsync($"route-driver-{Guid.NewGuid():N}@example.test");
        var (otherClient, _, _) = await _host.SignInMemberAsync($"route-snooper-{Guid.NewGuid():N}@example.test");

        Guid routeId;
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var depot = new Depot { Name = "Depot", Address = "1 Depot Rd", Lat = -27.53, Lng = 153.01 };
            var hh = new Household { Name = "Private Home", Address = "42 Secret St, Moorooka", Suburb = "MOOROOKA" };
            var route = new CollectionRoute { Status = "claimed", DepotId = depot.Id, DriverId = driverId };
            var stop = new RouteStop
            {
                RouteId = route.Id,
                HouseholdId = hh.Id,
                HouseholdName = hh.Name,
                Address = hh.Address,
                Lat = -27.5356,
                Lng = 153.0212,
                ContainerCount = 120,
                Sequence = 1,
            };
            db.Depots.Add(depot);
            db.Households.Add(hh);
            db.Routes.Add(route);
            db.RouteStops.Add(stop);
            await db.SaveChangesAsync();
            routeId = route.Id;
        }

        // Unrelated member cannot read the route by ID or via list
        var snooperById = await otherClient.GetAsync($"/api/routes/{routeId}");
        Assert.Equal(HttpStatusCode.Forbidden, snooperById.StatusCode);

        var snooperList = await otherClient.GetFromJsonAsync<JsonElement>("/api/routes");
        Assert.DoesNotContain(snooperList.EnumerateArray(), r => r.GetProperty("id").GetGuid() == routeId);

        // Assigned driver CAN read their own route
        var driverById = await driverClient.GetAsync($"/api/routes/{routeId}");
        Assert.Equal(HttpStatusCode.OK, driverById.StatusCode);
    }

    [Fact]
    public async Task Marketplace_public_runs_round_centroids_to_2dp_and_enforce_stop_bag_photo_guards()
    {
        var (runnerClient, _, runnerProfileId) = await _host.SignInMemberAsync($"pass7-runner-{Guid.NewGuid():N}@example.test");
        var reg = await runnerClient.PostAsJsonAsync("/api/runner/register", new { vehicleType = "car", capacityBags = 12, serviceRadiusKm = 20.0 });
        Assert.Equal(HttpStatusCode.Created, reg.StatusCode);

        Guid runId, stop1Id, stop2Id;
        const string bagCode = "GS-P7BAG01";
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var depot = new Depot { Name = "Depot", Address = "1 Depot Rd", Lat = -27.53, Lng = 153.01 };
            var hh = new Household { Name = "Sorter", Address = "10 Test St, Moorooka", Suburb = "MOOROOKA", Lat = -27.5359, Lng = 153.0249 };
            var bin = new Bin { Code = $"GS-P7{Guid.NewGuid().ToString("N")[..5].ToUpperInvariant()}", HouseholdId = hh.Id, Lat = hh.Lat, Lng = hh.Lng, PendingContainers = 400 };
            var bag = new SortedBag
            {
                Code = bagCode,
                HouseholdId = hh.Id,
                CreatorProfileId = runnerProfileId,
                Stream = "aluminium",
                DeclaredContainers = 150,
                Status = "on_kerb",
            };
            var run = new Run
            {
                DropPointId = depot.Id,
                AreaName = "MOOROOKA",
                CentroidLat = -27.5359,
                CentroidLng = 153.0249,
                EstimatedContainers = 400,
                PerContainerCents = 4,
                EstimatedPayoutCents = 1600,
                Status = "available",
                ExpiresAt = DateTime.UtcNow.AddHours(6),
            };
            var s1 = new RunStop { RunId = run.Id, BinId = bin.Id, Lat = hh.Lat, Lng = hh.Lng, EstimatedContainers = 200, Sequence = 1 };
            var s2 = new RunStop { RunId = run.Id, BinId = bin.Id, Lat = hh.Lat, Lng = hh.Lng, EstimatedContainers = 200, Sequence = 2 };
            run.Stops.Add(s1);
            run.Stops.Add(s2);
            db.Depots.Add(depot);
            db.Households.Add(hh);
            db.Bins.Add(bin);
            db.SortedBags.Add(bag);
            db.Runs.Add(run);
            await db.SaveChangesAsync();
            runId = run.Id;
            stop1Id = s1.Id;
            stop2Id = s2.Id;
        }

        // Anonymous public endpoints round availableRuns centroids to 2 decimal places (-27.54, 153.02)
        var anon = _host.CreateClient();
        var overview = await anon.GetFromJsonAsync<JsonElement>("/api/marketplace/overview");
        var pubRun = overview.GetProperty("availableRuns").EnumerateArray().First(r => r.GetProperty("id").GetGuid() == runId);
        Assert.Equal(-27.54, pubRun.GetProperty("centroidLat").GetDouble());
        Assert.Equal(153.02, pubRun.GetProperty("centroidLng").GetDouble());

        var nearRuns = await anon.GetFromJsonAsync<JsonElement>("/api/marketplace/runs?lat=-27.536&lng=153.025&radiusKm=10");
        var nearRun = nearRuns.EnumerateArray().First(r => r.GetProperty("id").GetGuid() == runId);
        Assert.Equal(-27.54, nearRun.GetProperty("centroidLat").GetDouble());
        Assert.Equal(153.02, nearRun.GetProperty("centroidLng").GetDouble());

        // Claim run -> status is "claimed", so /arrive before /start MUST return 400 BadRequest
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{runId}/claim", new { })).StatusCode);
        var prematureArrive = await runnerClient.PostAsync($"/api/marketplace/runs/{runId}/stops/{stop1Id}/arrive", null);
        Assert.Equal(HttpStatusCode.BadRequest, prematureArrive.StatusCode);

        // Start run -> /arrive now succeeds
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsync($"/api/marketplace/runs/{runId}/start", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsync($"/api/marketplace/runs/{runId}/stops/{stop1Id}/arrive", null)).StatusCode);

        // Scan bag onto stop 1 -> succeeds; attempting to scan SAME picked_up bag onto stop 2 MUST fail with 400
        var scan1 = await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{runId}/stops/{stop1Id}/scan-bag", new { bagCode });
        Assert.Equal(HttpStatusCode.OK, scan1.StatusCode);
        var hijackScan = await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{runId}/stops/{stop2Id}/scan-bag", new { bagCode });
        Assert.Equal(HttpStatusCode.BadRequest, hijackScan.StatusCode);

        // Pickup rejects javascript: PhotoUrl, accepts data:image/jpeg;base64,...
        var xssPickup = await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{runId}/stops/{stop1Id}/pickup", new
        {
            actualContainers = 150,
            photoUrl = "javascript:alert(1)",
        });
        Assert.Equal(HttpStatusCode.BadRequest, xssPickup.StatusCode);

        var validPickup = await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{runId}/stops/{stop1Id}/pickup", new
        {
            actualContainers = 150,
            photoUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
        });
        Assert.Equal(HttpStatusCode.OK, validPickup.StatusCode);

        // GDPR DELETE on active runner mid-run releases run back to "available", resets stops to "pending", and restores bag to "on_kerb"
        var delRes = await runnerClient.DeleteAsync($"/api/profiles/{runnerProfileId}");
        Assert.Equal(HttpStatusCode.OK, delRes.StatusCode);

        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var releasedRun = await db.Runs.Include(r => r.Stops).AsNoTracking().FirstAsync(r => r.Id == runId);
            Assert.Equal("available", releasedRun.Status);
            Assert.Null(releasedRun.RunnerId);
            Assert.Null(releasedRun.StartedAt);
            Assert.All(releasedRun.Stops, s =>
            {
                Assert.Equal("pending", s.Status);
                Assert.Equal(0, s.ScannedBagCount);
            });

            var releasedBag = await db.SortedBags.AsNoTracking().FirstAsync(b => b.Code == bagCode);
            Assert.Equal("on_kerb", releasedBag.Status);
            Assert.Null(releasedBag.RunId);
            Assert.Null(releasedBag.RunStopId);
            Assert.Null(releasedBag.PickedUpByRunnerId);
        }
    }

    [Fact]
    public async Task CashoutService_enforces_max_single_payout_64bit_ABA_totals_and_concurrent_InMemory_gate()
    {
        var dbName = $"cashout-p7-{Guid.NewGuid():N}";
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ABA_PAYOUTS_ENABLED"] = "true",
                ["ABA_TRACE_BSB"] = "034001",
                ["ABA_TRACE_ACCOUNT"] = "98765432",
                ["ABA_USER_ID"] = "301500",
                ["PAYID_PAYOUTS_ENABLED"] = "true",
            })
            .Build();

        DbContextOptions<GoodSortDbContext> Options() =>
            new DbContextOptionsBuilder<GoodSortDbContext>().UseInMemoryDatabase(dbName).Options;

        var userId = Guid.NewGuid();
        await using (var seedDb = new GoodSortDbContext(Options()))
        {
            seedDb.Profiles.Add(new Profile
            {
                Id = userId,
                Email = "whale@example.test",
                Name = "Whale Sorter",
                ClearedCents = 2500, // $25.00 — enough for ONE $20 payout, NOT two!
            });
            await seedDb.SaveChangesAsync();
        }

        // 1. Over-ceiling single cashout rejected before touching DB
        await using (var checkDb = new GoodSortDbContext(Options()))
        {
            var svc = new CashoutService(checkDb, cfg);
            var overAba = await svc.RequestCashout(userId, CashoutService.MaxSingleCashoutCents + 1, "034-001", "12345678", "Whale Sorter");
            Assert.False(overAba.Success);
            var overPayId = await svc.RequestPayIdCashout(userId, CashoutService.MaxSingleCashoutCents + 1, "email", "whale@example.test", "Whale Sorter");
            Assert.False(overPayId.Success);
        }

        // 2. Concurrent InMemory PayID cashouts against $25 balance: exactly ONE succeeds!
        var tasks = Enumerable.Range(0, 6).Select(async _ =>
        {
            await using var db = new GoodSortDbContext(Options());
            var svc = new CashoutService(db, cfg);
            return await svc.RequestPayIdCashout(userId, 2000, "email", "whale@example.test", "Whale Sorter");
        });
        var results = await Task.WhenAll(tasks);
        Assert.Equal(1, results.Count(r => r.Success));

        await using (var verifyDb = new GoodSortDbContext(Options()))
        {
            var p = await verifyDb.Profiles.FindAsync(userId);
            Assert.Equal(500, p!.ClearedCents);
        }

        // 3. Large multi-row ABA export summing > int.MaxValue (3 x $900,000.00 = $2,700,000.00 = 270,000,000 cents;
        //    or 25 x $900,000.00 = 2,250,000,000 cents > int.MaxValue!) never overflows to a negative File Total!
        await using (var abaDb = new GoodSortDbContext(Options()))
        {
            for (var i = 0; i < 25; i++)
            {
                abaDb.CashoutRequests.Add(new CashoutRequest
                {
                    UserId = userId,
                    PayoutMethod = "aba",
                    AmountCents = 90_000_000, // $900,000.00 each -> 25 * 90,000,000 = 2,250,000,000 (> int.MaxValue)
                    Bsb = "034001",
                    AccountNumber = "12345678",
                    AccountName = "Whale Sorter",
                    Status = "pending",
                });
            }
            await abaDb.SaveChangesAsync();

            var svc = new CashoutService(abaDb, cfg);
            var abaText = await svc.GenerateAbaFile();
            var lines = abaText.Split(["\r\n", "\n"], StringSplitOptions.RemoveEmptyEntries);
            Assert.Equal(27, lines.Length); // Record 0 + 25x Record 1 + Record 7
            Assert.All(lines, line => Assert.Equal(120, line.Length));
            var record7 = lines[^1];
            Assert.StartsWith("7999-999            22500000002250000000", record7);
        }
    }

    [Fact]
    public async Task VisionService_gracefully_handles_missing_or_malformed_AzureOpenAI_endpoint_without_UriFormatException()
    {
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["TAILOR_VISION_API_KEY"] = "",
                ["AZURE_OPENAI_KEY"] = "non-empty-key-without-valid-endpoint",
                ["AZURE_OPENAI_ENDPOINT"] = "",
            })
            .Build();

        await using var db = new GoodSortDbContext(
            new DbContextOptionsBuilder<GoodSortDbContext>()
                .UseInMemoryDatabase($"vision-p7-{Guid.NewGuid():N}")
                .Options);
        var httpFactory = _host.Services.GetRequiredService<IHttpClientFactory>();
        var logger = _host.Services.GetRequiredService<Microsoft.Extensions.Logging.ILogger<VisionService>>();

        var svc = new VisionService(cfg, logger, httpFactory, db);
        var res = await svc.IdentifyContainers("dGVzdA==");
        Assert.Empty(res.Containers);
        Assert.Contains("temporarily unavailable", res.Message, StringComparison.OrdinalIgnoreCase);
    }
}
