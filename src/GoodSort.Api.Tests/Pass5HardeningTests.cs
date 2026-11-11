using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using GoodSort.Api.Tests.OpaqueBox;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;

namespace GoodSort.Api.Tests;

/// <summary>
/// Pins the Pass 5 QA &amp; hardening fixes (TailorAU/tailor-group#600):
/// 1. AuthService.NormalizeValidEmail + /api/auth/send-otp &amp; /api/auth/verify-otp null/malformed/display-name email rejection.
/// 2. Per-IP rate limiting on /api/auth/send-otp (OTP_IP_RATE_PER_MINUTE).
/// 3. PATCH /api/admin/pricing persists all validated fields (AfternoonNormal, EveningSurge, BronzeBonus, SilverBonus, and 6 weights).
/// 4. POST /api/admin/pricing/simulate bounds StopCount/Containers/DistanceKm against allocation DoS.
/// 5. RunGenerationService.AbsorbFullBinHouseholds and PricingService.RepriceAvailableRuns promote below_threshold runs to available once payout crosses minPayoutCents.
/// </summary>
public class Pass5HardeningTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;

    public Pass5HardeningTests(OpaqueBoxHost host) => _host = host;

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("@")]
    [InlineData("user@")]
    [InlineData("@example.com")]
    [InlineData("user@localhost")]
    [InlineData("user@.example.com")]
    [InlineData("user@example.com.")]
    [InlineData("Bob <bob@example.com>")]
    [InlineData("bob@example.com\r\nBcc:evil@example.com")]
    [InlineData("bob smith@example.com")]
    public void NormalizeValidEmail_rejects_malformed_or_injected_addresses(string? bad)
    {
        Assert.Null(AuthService.NormalizeValidEmail(bad));
    }

    [Fact]
    public void NormalizeValidEmail_trims_and_lowercases_valid_addresses()
    {
        Assert.Equal("alice.sorter+1@thegoodsort.org", AuthService.NormalizeValidEmail("  Alice.Sorter+1@TheGoodSort.ORG  "));
    }

    [Fact]
    public async Task Auth_otp_endpoints_reject_null_empty_and_malformed_payloads_without_500()
    {
        var client = _host.CreateAnonymousClient();

        // Empty JSON object {} used to NullReferenceException on req.Email.Trim()
        var emptySend = await client.PostAsync(
            "/api/auth/send-otp",
            new StringContent("{}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, emptySend.StatusCode);

        var bareAtSend = await client.PostAsJsonAsync("/api/auth/send-otp", new { email = "@" });
        Assert.Equal(HttpStatusCode.BadRequest, bareAtSend.StatusCode);

        var displayNameSend = await client.PostAsJsonAsync("/api/auth/send-otp", new { email = "Attacker <victim@example.test>" });
        Assert.Equal(HttpStatusCode.BadRequest, displayNameSend.StatusCode);

        var emptyVerify = await client.PostAsync(
            "/api/auth/verify-otp",
            new StringContent("{}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, emptyVerify.StatusCode);

        var blankCodeVerify = await client.PostAsJsonAsync(
            "/api/auth/verify-otp",
            new { email = "valid@example.test", code = "   " });
        Assert.Equal(HttpStatusCode.Unauthorized, blankCodeVerify.StatusCode);
    }

    [Fact]
    public async Task Send_otp_enforces_per_ip_rate_limit_across_rotating_emails()
    {
        var dbName = $"otp-ip-limit-{Guid.NewGuid():N}";
        await using var factory = _host.WithWebHostBuilder(b =>
        {
            b.UseSetting("OTP_IP_RATE_PER_MINUTE", "2");
            b.ConfigureServices(s =>
            {
                s.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                s.RemoveAll<GoodSortDbContext>();
                s.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(dbName));
            });
        });

        var client = factory.CreateClient();
        var r1 = await client.PostAsJsonAsync("/api/auth/send-otp", new { email = "rotate1@example.test" });
        var r2 = await client.PostAsJsonAsync("/api/auth/send-otp", new { email = "rotate2@example.test" });
        var r3 = await client.PostAsJsonAsync("/api/auth/send-otp", new { email = "rotate3@example.test" });

        Assert.Equal(HttpStatusCode.OK, r1.StatusCode);
        Assert.Equal(HttpStatusCode.OK, r2.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, r3.StatusCode);
    }

    [Fact]
    public async Task Admin_pricing_patch_persists_all_validated_fields_and_simulate_bounds_stop_count()
    {
        var (adminClient, _, adminId) = await _host.SignInMemberAsync($"pass5-admin-{Guid.NewGuid():N}@example.test");
        string adminToken;
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var auth = scope.ServiceProvider.GetRequiredService<AuthService>();
            var prof = await db.Profiles.FindAsync(adminId);
            prof!.IsAdmin = true;
            if (!await db.PricingConfigs.AnyAsync(pc => pc.IsActive))
                db.PricingConfigs.Add(new PricingConfig { IsActive = true });
            await db.SaveChangesAsync();
            adminToken = auth.GenerateJwt(prof);
        }
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var updated = new PricingConfig
        {
            FloorCents = 4,
            CeilingCents = 10,
            BaseCents = 6,
            DistanceEfficiencyWeight = 0.15,
            BinDensityWeight = 0.25,
            SupplyDemandWeight = 0.20,
            TimeOfDayWeight = 0.15,
            MaterialMixWeight = 0.15,
            ScrapPriceWeight = 0.10,
            MorningSurge = 1.4,
            AfternoonNormal = 1.15,
            EveningSurge = 1.25,
            NightDiscount = 0.8,
            BronzeBonus = 1,
            SilverBonus = 2,
            GoldBonus = 3,
            PlatinumBonus = 4,
            AluminiumSpotCents = 135,
            PetSpotCents = 35,
            GlassSpotCents = 8,
        };

        var patchRes = await adminClient.PatchAsJsonAsync("/api/admin/pricing", updated);
        Assert.Equal(HttpStatusCode.OK, patchRes.StatusCode);

        var getRes = await adminClient.GetFromJsonAsync<PricingConfig>("/api/admin/pricing");
        Assert.NotNull(getRes);
        Assert.Equal(1.15, getRes!.AfternoonNormal);
        Assert.Equal(1.25, getRes.EveningSurge);
        Assert.Equal(1, getRes.BronzeBonus);
        Assert.Equal(2, getRes.SilverBonus);
        Assert.Equal(0.15, getRes.DistanceEfficiencyWeight);
        Assert.Equal(0.25, getRes.BinDensityWeight);
        Assert.Equal(0.10, getRes.ScrapPriceWeight);

        // Restore default config so shared-host tests observe standard pricing.
        await adminClient.PatchAsJsonAsync("/api/admin/pricing", new PricingConfig());

        // Simulate rejects allocation-DoS StopCount and negative containers
        var dosSim = await adminClient.PostAsJsonAsync("/api/admin/pricing/simulate", new
        {
            containers = 500,
            distanceKm = 4.0,
            stopCount = 5_000_000,
        });
        Assert.Equal(HttpStatusCode.BadRequest, dosSim.StatusCode);

        var negSim = await adminClient.PostAsJsonAsync("/api/admin/pricing/simulate", new
        {
            containers = -10,
            distanceKm = 4.0,
            stopCount = 5,
        });
        Assert.Equal(HttpStatusCode.BadRequest, negSim.StatusCode);

        var okSim = await adminClient.PostAsJsonAsync("/api/admin/pricing/simulate", new
        {
            containers = 500,
            distanceKm = 4.0,
            stopCount = 8,
        });
        Assert.Equal(HttpStatusCode.OK, okSim.StatusCode);
    }

    [Fact]
    public async Task Absorbing_full_bin_household_and_repricing_promote_below_threshold_runs_to_available()
    {
        var dbName = $"pass5-runs-{Guid.NewGuid():N}";
        await using var factory = _host.WithWebHostBuilder(b =>
        {
            b.ConfigureServices(s =>
            {
                s.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                s.RemoveAll<GoodSortDbContext>();
                s.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(dbName));
            });
        });

        Guid subThresholdRunId;
        Guid repriceRunId;

        _ = factory.Services; // Trigger Program.cs EnsureCreatedAsync seed first
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var depot = new Depot
            {
                Name = "Moorooka Test Depot",
                Address = "1 Depot Rd, Moorooka QLD 4105",
                Lat = -27.535,
                Lng = 153.025,
            };
            db.Depots.Add(depot);
            var seededCfg = await db.PricingConfigs.FirstOrDefaultAsync(pc => pc.IsActive);
            if (seededCfg is not null)
            {
                seededCfg.BaseCents = 5;
                seededCfg.FloorCents = 5;
                seededCfg.CeilingCents = 6;
            }
            else
            {
                db.PricingConfigs.Add(new PricingConfig { IsActive = true, BaseCents = 5, FloorCents = 5, CeilingCents = 6 });
            }

            // Existing below_threshold run with 250 containers ($12.50 < $20.00 threshold)
            var existingBin = new Bin
            {
                Code = "GS-H10001",
                Name = "10 Tarragindi Rd",
                Address = "10 Tarragindi Rd, Moorooka QLD 4105",
                Lat = -27.5351,
                Lng = 153.0251,
                PendingContainers = 250,
            };
            db.Bins.Add(existingBin);

            var subRun = new Run
            {
                DropPointId = depot.Id,
                Status = "below_threshold",
                AreaName = "Moorooka · Wednesday",
                CentroidLat = -27.5351,
                CentroidLng = 153.0251,
                EstimatedContainers = 250,
                EstimatedDistanceKm = 2.0,
                PerContainerCents = 5,
                EstimatedPayoutCents = 1250,
                Materials = new MaterialBreakdown { Aluminium = 250 },
                ExpiresAt = DateTime.UtcNow.AddHours(12),
                Stops =
                [
                    new RunStop
                    {
                        BinId = existingBin.Id,
                        Lat = existingBin.Lat,
                        Lng = existingBin.Lng,
                        EstimatedContainers = 250,
                        Sequence = 0,
                    }
                ],
            };
            db.Runs.Add(subRun);
            subThresholdRunId = subRun.Id;

            // Nearby collecting household flags BinIsOut with 200 containers -> combined 450 >= $20!
            var fullHh = new Household
            {
                Name = "Full Bag Home",
                Address = "12 Tarragindi Rd, Moorooka QLD 4105",
                Suburb = "MOOROOKA",
                CouncilCollectionDay = 3,
                BinStatus = BinStatuses.Collecting,
                BinIsOut = true,
                Lat = -27.5355,
                Lng = 153.0255,
                PendingContainers = 200,
            };
            db.Households.Add(fullHh);
            db.Bins.Add(new Bin
            {
                Code = "GS-H10002",
                Name = fullHh.Name,
                Address = fullHh.Address,
                HouseholdId = fullHh.Id,
                Lat = fullHh.Lat,
                Lng = fullHh.Lng,
                PendingContainers = 200,
                Materials = new MaterialBreakdown { Pet = 200 },
            });

            // Second below_threshold run far away (30km) with 260 containers (at <= 6c ceiling = $15.60 < $20)
            var farBin = new Bin
            {
                Code = "GS-H10003",
                Name = "Far Home",
                Address = "1 Sandgate Rd, Sandgate QLD 4017",
                Lat = -27.320,
                Lng = 153.069,
                PendingContainers = 260,
            };
            db.Bins.Add(farBin);
            var farRun = new Run
            {
                DropPointId = depot.Id,
                Status = "below_threshold",
                AreaName = "Sandgate · Thursday",
                CentroidLat = -27.320,
                CentroidLng = 153.069,
                EstimatedContainers = 260,
                EstimatedDistanceKm = 2.0,
                PerContainerCents = 5,
                EstimatedPayoutCents = 1300,
                Materials = new MaterialBreakdown { Glass = 260 },
                ExpiresAt = DateTime.UtcNow.AddHours(12),
                Stops =
                [
                    new RunStop
                    {
                        BinId = farBin.Id,
                        Lat = farBin.Lat,
                        Lng = farBin.Lng,
                        EstimatedContainers = 260,
                        Sequence = 0,
                    }
                ],
            };
            db.Runs.Add(farRun);
            repriceRunId = farRun.Id;

            await db.SaveChangesAsync();
        }

        // TriggerNowAsync absorbs fullHh into subThresholdRunId BEFORE GenerateRuns
        // can fragment it into a separate 1-stop below_threshold run.
        var runGen = new RunGenerationService(factory.Services, NullLogger<RunGenerationService>.Instance);
        var (acquiredLease, availableRuns) = await runGen.TriggerNowAsync();
        Assert.True(acquiredLease);
        Assert.Equal(1, availableRuns);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var pricing = scope.ServiceProvider.GetRequiredService<PricingService>();

            var promoted = await db.Runs.Include(r => r.Stops).FirstAsync(r => r.Id == subThresholdRunId);
            Assert.Equal("available", promoted.Status);
            Assert.Equal(450, promoted.EstimatedContainers);
            Assert.Equal(2, promoted.Stops.Count);
            Assert.Equal(200, promoted.Materials.Pet);
            Assert.True(promoted.EstimatedPayoutCents >= 2000);
            Assert.Equal(2, await db.Runs.CountAsync()); // No duplicate fragmented run created!

            var stillBelow = await db.Runs.FirstAsync(r => r.Id == repriceRunId);
            Assert.Equal("below_threshold", stillBelow.Status);

            // Test 2: RepriceAvailableRuns promotes repriceRunId (260 containers) when FloorCents rises to 8c (260 * 8c = 2080c >= 2000c)
            var activeCfg = await db.PricingConfigs.FirstAsync(pc => pc.IsActive);
            activeCfg.CeilingCents = 8;
            activeCfg.FloorCents = 8;
            activeCfg.BaseCents = 8;
            await db.SaveChangesAsync();

            await pricing.RepriceAvailableRuns(2000);
            var repriced = await db.Runs.FirstAsync(r => r.Id == repriceRunId);
            Assert.Equal("available", repriced.Status);
            Assert.True(repriced.EstimatedPayoutCents >= 2080);
        }
    }
}
