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
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace GoodSort.Api.Tests;

/// <summary>
/// Scan -> 5c credit -> suburb aluminium accumulation -> honest readiness.
///
/// The readiness a household sees must come from operator configuration. With
/// none set it must say so ("pending_operator_configuration") and carry no
/// threshold — the 1,000 LiveThreshold is an all-material estimate, not an
/// approved aluminium trigger, and must never leak in as one.
/// </summary>
public class CollectionReadinessTests
{
    // ── Pure rules ────────────────────────────────────────────────────────

    private static IConfiguration Cfg(params (string Key, string? Value)[] pairs) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(pairs.Select(p => new KeyValuePair<string, string?>(p.Key, p.Value)))
            .Build();

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("0")]
    [InlineData("-5")]
    [InlineData("lots")]
    public void Missing_or_invalid_threshold_is_pending_never_a_default(string? raw)
    {
        var config = CollectionReadiness.ConfigFrom(Cfg(("COLLECTION_ALUMINIUM_THRESHOLD_CONTAINERS", raw)));
        Assert.False(config.Configured);
        Assert.Null(config.AluminiumThreshold);
        Assert.Equal("none", config.Source);

        var r = CollectionReadiness.ForSuburb(config, aluminiumContainers: 5000, committed: false);
        Assert.Equal(CollectionReadiness.PendingOperatorConfiguration, r.Status);
        Assert.Null(r.AluminiumThreshold);
        Assert.Null(r.AluminiumNeeded);
        Assert.Equal(5000, r.AluminiumContainers);
    }

    [Fact]
    public void Configured_threshold_reports_accumulating_then_reached_awaiting_ops()
    {
        var config = CollectionReadiness.ConfigFrom(Cfg(("COLLECTION_ALUMINIUM_THRESHOLD_CONTAINERS", "40")));
        Assert.Equal("operator_config", config.Source);
        Assert.Null(config.FixtureLabel);

        var below = CollectionReadiness.ForSuburb(config, 39, committed: false);
        Assert.Equal(CollectionReadiness.Accumulating, below.Status);
        Assert.Equal(1, below.AluminiumNeeded);

        var at = CollectionReadiness.ForSuburb(config, 40, committed: false);
        // Reaching volume is not a collection — ops still decide.
        Assert.Equal(CollectionReadiness.VolumeReachedAwaitingOps, at.Status);
        Assert.Equal(0, at.AluminiumNeeded);
    }

    [Fact]
    public void Only_ops_commitment_reports_committed_even_when_pending_config()
    {
        var r = CollectionReadiness.ForSuburb(CollectionReadinessConfig.Pending, 0, committed: true);
        Assert.Equal(CollectionReadiness.OpsCommitted, r.Status);
    }

    [Fact]
    public void Fixture_label_marks_source_as_local_fixture()
    {
        var config = CollectionReadiness.ConfigFrom(Cfg(
            ("COLLECTION_ALUMINIUM_THRESHOLD_CONTAINERS", "40"),
            ("COLLECTION_READINESS_FIXTURE_LABEL", "  LOCAL TEST FIXTURE  ")));
        Assert.Equal("local_fixture", config.Source);
        Assert.Equal("LOCAL TEST FIXTURE", config.FixtureLabel);
    }

    [Fact]
    public void Aggregate_sums_suburb_aluminium_and_never_guesses_stale_breakdown_as_aluminium()
    {
        var board = WaitlistDensity.Aggregate(new[]
        {
            new HouseholdClusterRow("MOOROOKA", 3, "residential", PendingContainers: 10, AluminiumContainers: 6),
            new HouseholdClusterRow("MOOROOKA", 3, "residential", PendingContainers: 4, AluminiumContainers: 9), // stale tally > ledger: never infer 4 aluminium
            new HouseholdClusterRow("MOOROOKA", 3, "unit_complex", PendingContainers: 50, AluminiumContainers: 50), // units never count
        });
        var s = Assert.Single(board.Suburbs);
        Assert.Equal(14, s.Containers);
        Assert.Equal(6, s.AluminiumContainers); // only the verified 6 aluminium count
        Assert.NotNull(s.Readiness);
        Assert.Equal(CollectionReadiness.PendingOperatorConfiguration, s.Readiness!.Status);
        Assert.False(board.CollectionReadiness!.Configured);
    }

    [Fact]
    public void Partial_pickup_of_mixed_materials_without_breakdown_never_guesses_aluminium()
    {
        var hh = new GoodSort.Api.Data.Entities.Household
        {
            Suburb = "MOOROOKA",
            PendingContainers = 10,
            PendingValueCents = 50,
            Materials = new GoodSort.Api.Data.Entities.MaterialBreakdown { Aluminium = 5, Pet = 5 },
        };
        var bin = new GoodSort.Api.Data.Entities.Bin
        {
            HouseholdId = hh.Id,
            PendingContainers = 10,
            PendingValueCents = 50,
            Materials = new GoodSort.Api.Data.Entities.MaterialBreakdown { Aluminium = 5, Pet = 5 },
        };
        var scans = Enumerable.Range(0, 5)
            .Select(_ => new GoodSort.Api.Data.Entities.Scan { HouseholdId = hh.Id, Material = "aluminium", Status = "pending" })
            .Concat(Enumerable.Range(0, 5)
                .Select(_ => new GoodSort.Api.Data.Entities.Scan { HouseholdId = hh.Id, Material = "pet", Status = "pending" }))
            .ToList();
        var owner = new GoodSort.Api.Data.Entities.Profile { Id = Guid.NewGuid(), HouseholdId = hh.Id, PendingCents = 50 };
        foreach (var sc in scans) sc.UserId = owner.Id;

        // Pick up 6 of 10 containers without a per-material breakdown.
        HouseholdCredit.ApplyPickup([owner], scans, pickupCount: 6);
        HouseholdCredit.ReconcileHouseholdPickup(hh, bin, scans, pickupCount: 6);

        Assert.Equal(4, hh.PendingContainers);
        Assert.Equal(0, hh.Materials.Aluminium);
        Assert.Equal(4, hh.Materials.Other);
        Assert.Equal(4, scans.Count(s => s.Status == "pending_unreconciled"));

        var config = CollectionReadiness.ConfigFrom(Cfg(("COLLECTION_ALUMINIUM_THRESHOLD_CONTAINERS", "4")));
        var board = WaitlistDensity.Aggregate(new[]
        {
            new HouseholdClusterRow("MOOROOKA", 3, "residential", hh.PendingContainers, AluminiumContainers: hh.Materials.Aluminium, MaterialCompositionUnknown: true),
        }, readinessConfig: config);
        var suburb = Assert.Single(board.Suburbs);
        Assert.Equal(4, suburb.Containers);
        Assert.Equal(0, suburb.AluminiumContainers);
        Assert.False(suburb.Live);
        Assert.Equal(CollectionReadiness.PendingMaterialReconciliation, suburb.Readiness!.Status);
        Assert.Equal(4, suburb.Readiness.AluminiumNeeded);
    }

    [Fact]
    public void Partial_pickup_of_pure_aluminium_household_preserves_verified_aluminium_remainder()
    {
        var hh = new GoodSort.Api.Data.Entities.Household
        {
            Suburb = "MOOROOKA",
            PendingContainers = 10,
            PendingValueCents = 50,
            Materials = new GoodSort.Api.Data.Entities.MaterialBreakdown { Aluminium = 10 },
        };
        var scans = Enumerable.Range(0, 10)
            .Select(_ => new GoodSort.Api.Data.Entities.Scan { HouseholdId = hh.Id, Material = "aluminium", Status = "pending" })
            .ToList();
        var owner = new GoodSort.Api.Data.Entities.Profile { Id = Guid.NewGuid(), HouseholdId = hh.Id, PendingCents = 50 };
        foreach (var sc in scans) sc.UserId = owner.Id;

        HouseholdCredit.ApplyPickup([owner], scans, pickupCount: 6);
        HouseholdCredit.ReconcileHouseholdPickup(hh, null, scans, pickupCount: 6);

        Assert.Equal(4, hh.PendingContainers);
        Assert.Equal(4, hh.Materials.Aluminium);
        Assert.Equal(0, hh.Materials.Other);
    }

    // ── HTTP: the endpoint the household journey reads ───────────────────

    public abstract class HostBase : WebApplicationFactory<Program>
    {
        private readonly string _dbName = $"readiness-{Guid.NewGuid():N}";
        protected abstract void Extra(IWebHostBuilder builder);

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
            builder.UseSetting("SCAN_RATE_PER_MINUTE", "100000");
            builder.UseSetting("SCAN_DAILY_CAP", "100000");
            builder.UseSetting("LAUNCH_BONUS_CONTAINERS", "0");
            Extra(builder);
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                services.RemoveAll<GoodSortDbContext>();
                services.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(_dbName));
                services.RemoveAll<IHostedService>();
            });
        }
    }

    public class PendingHost : HostBase
    {
        protected override void Extra(IWebHostBuilder builder) { }
    }

    public class FixtureHost : HostBase
    {
        protected override void Extra(IWebHostBuilder builder)
        {
            builder.UseSetting("COLLECTION_ALUMINIUM_THRESHOLD_CONTAINERS", "3");
            builder.UseSetting("COLLECTION_READINESS_FIXTURE_LABEL", "LOCAL TEST FIXTURE");
        }
    }

    private static async Task<HttpClient> SignedInClient(WebApplicationFactory<Program> host, string email)
    {
        var client = host.CreateClient();
        var send = await client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        var code = (await send.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verify = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        var token = (await verify.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task Join(HttpClient client, string suburb)
    {
        var res = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Test House",
            address = $"12 Test St, {suburb} QLD 4105",
            suburb,
            street = "TEST ST",
            lat = -27.53,
            lng = 153.02,
            type = "residential",
            councilCollectionDay = 3,
            councilArea = "BCC",
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
    }

    private static async Task<int> Scan(HttpClient client, string material)
    {
        var res = await client.PostAsJsonAsync("/api/scans", new
        {
            barcode = "9300675024235",
            containerName = material == "aluminium" ? "Test 375ml Can" : "Test 600ml Bottle",
            material,
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("creditedCents").GetInt32();
    }

    private static async Task<(JsonElement Board, JsonElement Suburb)> Board(WebApplicationFactory<Program> host, string suburb)
    {
        var res = await host.CreateClient().GetAsync("/api/growth/brisbane");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var board = await res.Content.ReadFromJsonAsync<JsonElement>();
        var s = board.GetProperty("suburbs").EnumerateArray()
            .First(x => string.Equals(x.GetProperty("suburb").GetString(), suburb, StringComparison.OrdinalIgnoreCase));
        return (board, s);
    }

    [Fact]
    public async Task Without_operator_config_scans_credit_5c_and_aluminium_accumulates_but_readiness_is_pending()
    {
        using var host = new PendingHost();
        var c = await SignedInClient(host, "pending-a@example.test");
        await Join(c, "Moorooka");
        Assert.Equal(5, await Scan(c, "aluminium"));
        Assert.Equal(5, await Scan(c, "aluminium"));
        Assert.Equal(5, await Scan(c, "pet"));

        var (board, s) = await Board(host, "MOOROOKA");
        Assert.Equal(3, s.GetProperty("containers").GetInt32());
        Assert.Equal(2, s.GetProperty("aluminiumContainers").GetInt32());
        var r = s.GetProperty("readiness");
        Assert.Equal("pending_operator_configuration", r.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, r.GetProperty("aluminiumThreshold").ValueKind);
        Assert.Equal(JsonValueKind.Null, r.GetProperty("aluminiumNeeded").ValueKind);
        var cfg = board.GetProperty("collectionReadiness");
        Assert.False(cfg.GetProperty("configured").GetBoolean());
        Assert.Equal("none", cfg.GetProperty("source").GetString());
    }

    [Fact]
    public async Task With_labelled_fixture_config_readiness_moves_from_accumulating_to_awaiting_ops()
    {
        using var host = new FixtureHost();
        var a = await SignedInClient(host, "fixture-a@example.test");
        await Join(a, "Moorooka");
        await Scan(a, "aluminium");
        await Scan(a, "glass");

        var (board, s) = await Board(host, "MOOROOKA");
        var cfg = board.GetProperty("collectionReadiness");
        Assert.Equal("local_fixture", cfg.GetProperty("source").GetString());
        Assert.Equal("LOCAL TEST FIXTURE", cfg.GetProperty("fixtureLabel").GetString());
        Assert.Equal("accumulating", s.GetProperty("readiness").GetProperty("status").GetString());
        Assert.Equal(2, s.GetProperty("readiness").GetProperty("aluminiumNeeded").GetInt32());

        var b = await SignedInClient(host, "fixture-b@example.test");
        await Join(b, "Moorooka");
        await Scan(b, "aluminium");
        await Scan(b, "aluminium");

        (_, s) = await Board(host, "MOOROOKA");
        Assert.Equal(3, s.GetProperty("aluminiumContainers").GetInt32());
        Assert.Equal("aluminium_volume_reached_awaiting_ops", s.GetProperty("readiness").GetProperty("status").GetString());
        Assert.True(s.GetProperty("live").GetBoolean());
        Assert.False(s.GetProperty("committed").GetBoolean());
    }

    // ── R1: Two successive partial pickups with multiple payees + launch bonus ──

    [Fact]
    public void R1_Two_successive_partial_pickups_with_multiple_payees_and_bonus_conserve_credit_and_never_repeat_bonus()
    {
        var hh = new GoodSort.Api.Data.Entities.Household
        {
            Suburb = "MOOROOKA",
            PendingContainers = 10,
            PendingValueCents = 100,
            Materials = new GoodSort.Api.Data.Entities.MaterialBreakdown { Aluminium = 6, Pet = 4 },
        };
        var bin = new GoodSort.Api.Data.Entities.Bin
        {
            HouseholdId = hh.Id,
            PendingContainers = 10,
            PendingValueCents = 100,
            Materials = new GoodSort.Api.Data.Entities.MaterialBreakdown { Aluminium = 6, Pet = 4 },
        };
        var owner = new GoodSort.Api.Data.Entities.Profile
        {
            Id = Guid.NewGuid(),
            HouseholdId = hh.Id,
            PendingCents = 60, // 6 bonus scans @ 10c each
            ClearedCents = 0,
        };
        var memberB = new GoodSort.Api.Data.Entities.Profile
        {
            Id = Guid.NewGuid(),
            HouseholdId = hh.Id,
            PendingCents = 40, // 4 bonus scans @ 10c each
            ClearedCents = 0,
        };
        var payees = new List<GoodSort.Api.Data.Entities.Profile> { owner, memberB };

        var baseTime = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc);
        var allScans = new List<GoodSort.Api.Data.Entities.Scan>();
        for (int i = 0; i < 6; i++)
        {
            allScans.Add(new GoodSort.Api.Data.Entities.Scan
            {
                HouseholdId = hh.Id,
                UserId = owner.Id,
                Material = "aluminium",
                RefundCents = LaunchBonus.CentsPerContainer, // 10c (5c estimate + 5c bonus)
                Status = "pending",
                CreatedAt = baseTime.AddMinutes(i),
            });
        }
        for (int i = 0; i < 4; i++)
        {
            allScans.Add(new GoodSort.Api.Data.Entities.Scan
            {
                HouseholdId = hh.Id,
                UserId = memberB.Id,
                Material = "pet",
                RefundCents = LaunchBonus.CentsPerContainer, // 10c (5c estimate + 5c bonus)
                Status = "pending",
                CreatedAt = baseTime.AddMinutes(10 + i),
            });
        }

        // Pickup 1: collect 5 of 10 containers.
        HouseholdCredit.SettleHouseholdPickup(hh, bin, payees, allScans, pickupCount: 5);

        Assert.Equal(5, hh.PendingContainers);
        Assert.Equal(5, bin.PendingContainers);
        Assert.Equal(5, allScans.Count(s => s.Status == "settled"));
        Assert.Equal(5, allScans.Count(s => s.Status == "pending_unreconciled"));

        // Owner had 6 scans (60c pending): 5 settled -> 10c pending remains; 5 * 5c bonus + 5 * 5c runner pickup = 50c cleared.
        Assert.Equal(10, owner.PendingCents);
        Assert.Equal(50, owner.ClearedCents);
        // Member B had 4 scans (40c pending): 0 settled -> 40c pending remains, 0c cleared.
        Assert.Equal(40, memberB.PendingCents);
        Assert.Equal(0, memberB.ClearedCents);
        // Total PendingCents (50) + Total ClearedCents (50) == 100c conserved.
        Assert.Equal(100, owner.PendingCents + memberB.PendingCents + owner.ClearedCents + memberB.ClearedCents);

        // Pickup 2: collect remaining 5 containers (only unsettled scans are passed, matching DB query).
        var unsettledAfterFirst = allScans
            .Where(s => s.Status == "pending" || s.Status == "pending_unreconciled")
            .ToList();
        Assert.Equal(5, unsettledAfterFirst.Count);

        HouseholdCredit.SettleHouseholdPickup(hh, bin, payees, unsettledAfterFirst, pickupCount: 5);

        Assert.Equal(0, hh.PendingContainers);
        Assert.Equal(0, bin.PendingContainers);
        Assert.Equal(10, allScans.Count(s => s.Status == "settled"));
        Assert.Equal(0, owner.PendingCents);
        Assert.Equal(0, memberB.PendingCents);
        // Owner: 50 + 5c (1 remaining bonus) + 25c (5 * 5c runner pickup) = 80c
        Assert.Equal(80, owner.ClearedCents);
        // Member B: 4 * 5c bonus = 20c
        Assert.Equal(20, memberB.ClearedCents);
        // Total cleared across household = 100c (50c runner container credit + 50c launch bonus, never paid twice).
        Assert.Equal(100, owner.ClearedCents + memberB.ClearedCents);
    }

    [Fact]
    public async Task R1_Legacy_route_settle_endpoint_conserves_pending_and_bonus_across_two_partial_pickups()
    {
        using var host = new FixtureHost();
        using var scope = host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();

        var driverProfile = new GoodSort.Api.Data.Entities.Profile
        {
            Id = Guid.NewGuid(),
            Email = "driver-r1@example.test",
            Name = "Driver",
            Role = "admin",
        };
        var hh = new GoodSort.Api.Data.Entities.Household
        {
            Id = Guid.NewGuid(),
            Name = "R1 House",
            Suburb = "MOOROOKA",
            Street = "TEST ST",
            Type = "residential",
            BinStatus = BinStatuses.Collecting,
            PendingContainers = 10,
            PendingValueCents = 100,
            Materials = new GoodSort.Api.Data.Entities.MaterialBreakdown { Aluminium = 6, Pet = 4 },
        };
        var bin = new GoodSort.Api.Data.Entities.Bin
        {
            Id = Guid.NewGuid(),
            Code = "GS-R1BIN",
            HouseholdId = hh.Id,
            PendingContainers = 10,
            PendingValueCents = 100,
            Materials = new GoodSort.Api.Data.Entities.MaterialBreakdown { Aluminium = 6, Pet = 4 },
        };
        var owner = new GoodSort.Api.Data.Entities.Profile
        {
            Id = Guid.NewGuid(),
            Email = "owner-r1@example.test",
            HouseholdId = hh.Id,
            PendingCents = 60,
            ClearedCents = 0,
        };
        var memberB = new GoodSort.Api.Data.Entities.Profile
        {
            Id = Guid.NewGuid(),
            Email = "memberb-r1@example.test",
            HouseholdId = hh.Id,
            PendingCents = 40,
            ClearedCents = 0,
        };
        var depot = new GoodSort.Api.Data.Entities.Depot
        {
            Id = Guid.NewGuid(),
            Name = "Moorooka Depot",
            Address = "1 Depot Rd",
            Lat = -27.53,
            Lng = 153.02,
        };
        var route1 = new GoodSort.Api.Data.Entities.CollectionRoute
        {
            Id = Guid.NewGuid(),
            DriverId = driverProfile.Id,
            DepotId = depot.Id,
            Status = "at_depot",
            Stops =
            [
                new GoodSort.Api.Data.Entities.RouteStop
                {
                    Id = Guid.NewGuid(),
                    HouseholdId = hh.Id,
                    Status = "picked_up",
                    ContainerCount = 10,
                    ActualContainerCount = 5,
                },
            ],
        };
        var route2 = new GoodSort.Api.Data.Entities.CollectionRoute
        {
            Id = Guid.NewGuid(),
            DriverId = driverProfile.Id,
            DepotId = depot.Id,
            Status = "at_depot",
            Stops =
            [
                new GoodSort.Api.Data.Entities.RouteStop
                {
                    Id = Guid.NewGuid(),
                    HouseholdId = hh.Id,
                    Status = "picked_up",
                    ContainerCount = 5,
                    ActualContainerCount = 5,
                },
            ],
        };

        var baseTime = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc);
        for (int i = 0; i < 6; i++)
        {
            db.Scans.Add(new GoodSort.Api.Data.Entities.Scan
            {
                HouseholdId = hh.Id,
                UserId = owner.Id,
                Material = "aluminium",
                RefundCents = 10,
                Status = "pending",
                CreatedAt = baseTime.AddMinutes(i),
            });
        }
        for (int i = 0; i < 4; i++)
        {
            db.Scans.Add(new GoodSort.Api.Data.Entities.Scan
            {
                HouseholdId = hh.Id,
                UserId = memberB.Id,
                Material = "pet",
                RefundCents = 10,
                Status = "pending",
                CreatedAt = baseTime.AddMinutes(10 + i),
            });
        }

        db.Profiles.AddRange(driverProfile, owner, memberB);
        db.Households.Add(hh);
        db.Bins.Add(bin);
        db.Depots.Add(depot);
        db.Routes.AddRange(route1, route2);
        await db.SaveChangesAsync();

        var authSvc = scope.ServiceProvider.GetRequiredService<AuthService>();
        var token = authSvc.GenerateJwt(driverProfile);
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        // Settle Route 1 (partial pickup of 5 containers)
        var res1 = await client.PostAsync($"/api/routes/{route1.Id}/settle", null);
        Assert.Equal(HttpStatusCode.OK, res1.StatusCode);

        using (var checkScope1 = host.Services.CreateScope())
        {
            var checkDb1 = checkScope1.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var hh1 = await checkDb1.Households.SingleAsync(h => h.Id == hh.Id);
            var bin1 = await checkDb1.Bins.SingleAsync(b => b.Id == bin.Id);
            var owner1 = await checkDb1.Profiles.SingleAsync(p => p.Id == owner.Id);
            var memberB1 = await checkDb1.Profiles.SingleAsync(p => p.Id == memberB.Id);
            Assert.Equal(5, hh1.PendingContainers);
            Assert.Equal(5, bin1.PendingContainers);
            Assert.Equal(0, bin1.Materials.Aluminium);
            Assert.Equal(5, bin1.Materials.Other);
            Assert.Equal(10, owner1.PendingCents);
            Assert.Equal(50, owner1.ClearedCents);
            Assert.Equal(40, memberB1.PendingCents);
            Assert.Equal(0, memberB1.ClearedCents);
        }

        // Settle Route 2 (remaining 5 containers)
        var res2 = await client.PostAsync($"/api/routes/{route2.Id}/settle", null);
        Assert.Equal(HttpStatusCode.OK, res2.StatusCode);

        using (var checkScope2 = host.Services.CreateScope())
        {
            var checkDb2 = checkScope2.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var hh2 = await checkDb2.Households.SingleAsync(h => h.Id == hh.Id);
            var bin2 = await checkDb2.Bins.SingleAsync(b => b.Id == bin.Id);
            var owner2 = await checkDb2.Profiles.SingleAsync(p => p.Id == owner.Id);
            var memberB2 = await checkDb2.Profiles.SingleAsync(p => p.Id == memberB.Id);
            Assert.Equal(0, hh2.PendingContainers);
            Assert.Equal(0, bin2.PendingContainers);
            Assert.Equal(0, owner2.PendingCents);
            Assert.Equal(0, memberB2.PendingCents);
            Assert.Equal(80, owner2.ClearedCents);
            Assert.Equal(20, memberB2.ClearedCents);
        }
    }

    // ── R2: Stale mixed-material row fails closed across public, admin waitlist, and admin allocate ──

    [Fact]
    public async Task R2_Stale_mixed_material_row_agrees_and_fails_closed_across_public_admin_waitlist_and_allocate()
    {
        using var host = new FixtureHost(); // threshold = 3
        using var scope = host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();

        var admin = new GoodSort.Api.Data.Entities.Profile
        {
            Id = Guid.NewGuid(),
            Email = "admin-r2@example.test",
            Role = "admin",
        };
        db.Profiles.Add(admin);

        // Household 1: previously stale row (PendingContainers = 5, Aluminium = 5, Pet = 5 -> total 10 > pending 5)
        db.Households.AddRange(
            new GoodSort.Api.Data.Entities.Household
            {
                Id = Guid.NewGuid(),
                Name = "Stale House",
                Suburb = "MOOROOKA",
                Street = "HAMILTON RD",
                Type = "residential",
                CouncilCollectionDay = 2,
                BinStatus = BinStatuses.Waitlisted,
                PendingContainers = 5,
                Materials = new GoodSort.Api.Data.Entities.MaterialBreakdown { Aluminium = 5, Pet = 5 },
            },
            new GoodSort.Api.Data.Entities.Household
            {
                Id = Guid.NewGuid(),
                Name = "Clean House 2",
                Suburb = "MOOROOKA",
                Street = "HAMILTON RD",
                Type = "residential",
                CouncilCollectionDay = 2,
                BinStatus = BinStatuses.Waitlisted,
                PendingContainers = 1,
                Materials = new GoodSort.Api.Data.Entities.MaterialBreakdown { Aluminium = 1 },
            },
            new GoodSort.Api.Data.Entities.Household
            {
                Id = Guid.NewGuid(),
                Name = "Clean House 3",
                Suburb = "MOOROOKA",
                Street = "HAMILTON RD",
                Type = "residential",
                CouncilCollectionDay = 2,
                BinStatus = BinStatuses.Waitlisted,
                PendingContainers = 1,
                Materials = new GoodSort.Api.Data.Entities.MaterialBreakdown { Aluminium = 1 },
            });
        await db.SaveChangesAsync();

        // 1. Public readiness: stale household contributes 0 verified aluminium; status is pending_material_reconciliation; live is false.
        var (_, publicSuburb) = await Board(host, "MOOROOKA");
        Assert.Equal(2, publicSuburb.GetProperty("aluminiumContainers").GetInt32());
        Assert.False(publicSuburb.GetProperty("live").GetBoolean());
        Assert.Equal(
            CollectionReadiness.PendingMaterialReconciliation,
            publicSuburb.GetProperty("readiness").GetProperty("status").GetString());

        // 2. Admin waitlist: agrees on 2 verified aluminium, readyToOrder == false, status == pending_material_reconciliation.
        var authSvc = scope.ServiceProvider.GetRequiredService<AuthService>();
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", authSvc.GenerateJwt(admin));

        var adminWaitlistRes = await client.GetAsync("/api/admin/waitlist");
        Assert.Equal(HttpStatusCode.OK, adminWaitlistRes.StatusCode);
        var adminWaitlistJson = await adminWaitlistRes.Content.ReadFromJsonAsync<JsonElement>();
        var adminSuburb = adminWaitlistJson.GetProperty("suburbs").EnumerateArray()
            .Single(s => s.GetProperty("suburb").GetString() == "MOOROOKA");
        Assert.Equal(2, adminSuburb.GetProperty("aluminiumContainers").GetInt32());
        Assert.False(adminSuburb.GetProperty("readyToOrder").GetBoolean());
        Assert.True(adminSuburb.GetProperty("materialCompositionUnknown").GetBoolean());
        Assert.Equal(
            CollectionReadiness.PendingMaterialReconciliation,
            adminSuburb.GetProperty("readiness").GetProperty("status").GetString());

        // 3. Admin allocate: fails closed (400 BadRequest), even if clean houses alone reached threshold!
        var allocateRes = await client.PostAsync("/api/admin/areas/MOOROOKA/allocate", null);
        Assert.Equal(HttpStatusCode.BadRequest, allocateRes.StatusCode);
    }

    // ── R3: Exact Aukus URI parser, documented path allowlist, redirect rejection, and disabled capabilities ──

    [Theory]
    [InlineData("https://api.aukus.si/v1", true)]
    [InlineData("https://api.aukus.si/v1/", true)]
    [InlineData("https://api.aukus.si/v1extra", false)]
    [InlineData("https://api.aukus.si/v1/vision/classify/upload", false)]
    [InlineData("https://api.aukus.si:8443/v1", false)]
    [InlineData("http://api.aukus.si/v1", false)]
    [InlineData("https://api.aukus.si/v1?foo=bar", false)]
    [InlineData("https://api.aukus.si/v1#frag", false)]
    [InlineData("https://user:pass@api.aukus.si/v1", false)]
    [InlineData("https://api.tailor.au/v1", false)]
    public void R3_AukusBoundary_TryParseBaseUri_validates_exact_canonical_base(string raw, bool expected)
    {
        Assert.Equal(expected, AukusBoundary.TryParseBaseUri(raw, out var uri));
        if (expected)
            Assert.Equal("https://api.aukus.si/v1/", uri!.AbsoluteUri);
    }

    [Theory]
    [InlineData("https://api.aukus.si/v1/chat/completions", true)]
    [InlineData("https://api.aukus.si/v1/responses", true)]
    [InlineData("https://api.aukus.si/v1/embeddings", true)]
    [InlineData("https://api.aukus.si/v1/models", true)]
    [InlineData("https://api.aukus.si/v1extra/chat/completions", false)]
    [InlineData("https://api.aukus.si/v1/vision/classify/upload", false)]
    [InlineData("https://api.aukus.si/v1/api/v2/product/9300675024235.json", false)]
    [InlineData("https://api.aukus.si/v1/explore/v2.1/catalog/datasets/waste-collection-days-collection-days/records", false)]
    [InlineData("https://api.aukus.si/v1/trip/v1/driving/153.02,-27.53", false)]
    [InlineData("https://api.aukus.si/v1/openai/deployments/gpt-5-mini/chat/completions", false)]
    [InlineData("https://api.aukus.si:8443/v1/chat/completions", false)]
    [InlineData("http://api.aukus.si/v1/chat/completions", false)]
    public void R3_AukusBoundary_IsAllowedRequestUri_enforces_documented_paths_only(string raw, bool expected)
    {
        Assert.Equal(expected, AukusBoundary.IsAllowedRequestUri(new Uri(raw)));
    }

    [Fact]
    public async Task R3_AukusEnforcingHandler_blocks_undocumented_paths_before_network_and_rejects_redirects()
    {
        var innerCalls = 0;
        var inner = new StubInnerHandler(req =>
        {
            innerCalls++;
            var redirect = new HttpResponseMessage(HttpStatusCode.MovedPermanently);
            redirect.Headers.Location = new Uri("https://evil.example.com/v1/chat/completions");
            return redirect;
        });

        using var client = new HttpClient(new AukusEnforcingHandler(inner))
        {
            BaseAddress = new Uri(AukusBoundary.CanonicalBaseWithSlash),
        };

        // 1. Undocumented path is blocked BEFORE calling inner handler
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            client.GetAsync("api/v2/product/9300675024235.json"));
        Assert.Equal(0, innerCalls);

        // 2. 3xx redirect from a documented path is rejected and never followed
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            client.PostAsync("chat/completions", new StringContent("{}")));
        Assert.Equal(1, innerCalls);
        Assert.Contains("redirect", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    private sealed class StubInnerHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(responder(request));
    }
}

