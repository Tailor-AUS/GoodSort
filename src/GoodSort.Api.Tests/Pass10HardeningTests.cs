using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using GoodSort.Api.Tests.OpaqueBox;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GoodSort.Api.Tests;

/// <summary>
/// Pins the Pass 10 QA &amp; hardening fixes (TailorAU/tailor-group#600):
/// 1. Settling a marketplace run resets household.BinIsOut = false (and BinIsOutAt = null) when
///    all kerb QR bags have been collected, preventing RunGenerationService from spawning phantom
///    20-container runs on emptied kerbs every 30 minutes.
/// 2. Settling a household's first verified pickup clears the referrer's $1 (100¢) Container Mafia
///    signup bonus from PendingCents into ClearedCents alongside the 1¢/can override, and never
///    double-clears $1 on subsequent runs.
/// 3. Placing a fresh QR bag on the kerb after stop pickup (before settlement) keeps household.BinIsOut
///    true so newly staged bags are not dropped by an in-flight run's settlement.
/// </summary>
public class Pass10HardeningTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;

    public Pass10HardeningTests(OpaqueBoxHost host) => _host = host;

    [Fact]
    public async Task Settle_clears_mafia_signup_bonus_once_and_resets_binIsOut_preventing_phantom_runs()
    {
        var (mafiaClient, _, mafiaId) = await _host.SignInMemberAsync($"pass10-mafia-{Guid.NewGuid():N}@example.test");
        var (sorter1Client, _, sorter1Id) = await _host.SignInMemberAsync($"pass10-s1-{Guid.NewGuid():N}@example.test", referrerId: mafiaId);
        var (sorter2Client, _, sorter2Id) = await _host.SignInMemberAsync($"pass10-s2-{Guid.NewGuid():N}@example.test");
        var (sorter3Client, _, sorter3Id) = await _host.SignInMemberAsync($"pass10-s3-{Guid.NewGuid():N}@example.test");
        var (runnerClient, _, runnerProfileId) = await _host.SignInMemberAsync($"pass10-runner-{Guid.NewGuid():N}@example.test");

        async Task<Guid> CreateTarragindiHouseholdAsync(HttpClient client, string name, int houseNo, double latOffset)
        {
            var res = await client.PostAsJsonAsync("/api/households", new
            {
                name,
                address = $"{houseNo} Windmill Street, Tarragindi QLD 4121",
                suburb = "TARRAGINDI",
                street = "WINDMILL STREET",
                lat = -27.5260 + latOffset,
                lng = 153.0460 + latOffset,
                type = "residential",
                councilCollectionDay = 4,
                councilArea = "Brisbane City",
                usesDivider = true,
                accessConsent = true,
            });
            Assert.Equal(HttpStatusCode.Created, res.StatusCode);
            return (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        }

        var hh1Id = await CreateTarragindiHouseholdAsync(sorter1Client, "Tarragindi Home 1", 12, 0.0001);
        var hh2Id = await CreateTarragindiHouseholdAsync(sorter2Client, "Tarragindi Home 2", 14, 0.0002);
        var hh3Id = await CreateTarragindiHouseholdAsync(sorter3Client, "Tarragindi Home 3", 16, 0.0003);

        // Referrer starts with $1 (100¢) pending from Sorter 1's household onboarding, plus $0.50 (50¢) of own pending scans
        var mafiaHhId = await CreateTarragindiHouseholdAsync(mafiaClient, "Mafia Home", 99, 0.0500);
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var mafiaProfile = await db.Profiles.FindAsync(mafiaId);
            Assert.NotNull(mafiaProfile);
            Assert.Equal(100, mafiaProfile!.PendingCents);
            Assert.Equal(0, mafiaProfile.ClearedCents);

            // Give Mafia 50¢ of their own uncollected scan credit so we verify only 100¢ clears on Sorter 1's pickup
            mafiaProfile.PendingCents += 50;

            if (!await db.PricingConfigs.AnyAsync())
            {
                db.PricingConfigs.Add(new PricingConfig());
            }

            if (!await db.Depots.AnyAsync())
            {
                db.Depots.Add(new Depot
                {
                    Name = "RECAN Yeerongpilly",
                    Address = "993 Fairfield Rd, Yeerongpilly",
                    Lat = -27.531,
                    Lng = 153.013,
                });
            }

            // Activate the 3 Tarragindi households as collecting with 400 + 350 + 300 = 1,050 containers
            var counts = new Dictionary<Guid, int>
            {
                [hh1Id] = 400,
                [hh2Id] = 350,
                [hh3Id] = 300,
            };
            foreach (var (hid, cnt) in counts)
            {
                var hh = await db.Households.FindAsync(hid);
                var bin = await db.Bins.FirstAsync(b => b.HouseholdId == hid);
                hh!.BinStatus = BinStatuses.Collecting;
                hh.PendingContainers = cnt;
                hh.PendingValueCents = cnt * 10;
                hh.BinIsOut = true;
                hh.BinIsOutAt = DateTime.UtcNow.AddMinutes(-5);
                bin.PendingContainers = cnt;
                bin.PendingValueCents = cnt * 10;
            }
            await db.SaveChangesAsync();
        }

        // Sorter 1 seals a 400-can Aluminium QR bag on the kerb
        var bag1Res = await sorter1Client.PostAsJsonAsync("/api/bags", new
        {
            stream = "aluminium",
            declaredContainers = 400,
            putOnKerb = true,
        });
        Assert.Equal(HttpStatusCode.Created, bag1Res.StatusCode);
        var bag1Code = (await bag1Res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString()!;

        // Trigger RunGenerationService -> spawns the 3-stop Tarragindi run (>= 1,000 containers)
        var runGen = ActivatorUtilities.CreateInstance<RunGenerationService>(_host.Services);
        var (acquired1, _) = await runGen.TriggerNowAsync();
        Assert.True(acquired1);

        Guid runId;
        List<(Guid StopId, Guid HouseholdId, int ExpectedCount)> stopPlan;
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var expectedArea = RunCluster.AreaName("TARRAGINDI", 4);
            var tarragindiRuns = await db.Runs
                .Include(r => r.Stops)
                .Where(r => r.AreaName == expectedArea && r.Status == "available")
                .ToListAsync();
            var run = Assert.Single(tarragindiRuns);
            Assert.Equal(3, run.Stops.Count);
            runId = run.Id;

            stopPlan = [];
            foreach (var s in run.Stops.OrderBy(x => x.Sequence))
            {
                var bin = await db.Bins.FindAsync(s.BinId);
                stopPlan.Add((s.Id, bin!.HouseholdId!.Value, s.EstimatedContainers));
            }
        }

        // Register Runner, claim, start, arrive, scan 400-can bag on HH1, complete all 3 pickups, deliver, complete, settle
        var regRes = await runnerClient.PostAsJsonAsync("/api/runner/register", new
        {
            profileId = runnerProfileId,
            vehicleType = "ute",
            capacityBags = 16,
            serviceRadiusKm = 20.0,
            coexSchemeId = "C104445556",
        });
        Assert.Equal(HttpStatusCode.Created, regRes.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{runId}/claim", new { profileId = runnerProfileId })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsync($"/api/marketplace/runs/{runId}/start", null)).StatusCode);

        foreach (var (stopId, stopHhId, expectedCount) in stopPlan)
        {
            Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsync($"/api/marketplace/runs/{runId}/stops/{stopId}/arrive", null)).StatusCode);
            if (stopHhId == hh1Id)
            {
                var scanBagRes = await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{runId}/stops/{stopId}/scan-bag", new
                {
                    bagCode = bag1Code,
                    verifiedContainers = 400,
                    contaminationFlag = false,
                    discrepancyCode = "none",
                });
                Assert.Equal(HttpStatusCode.OK, scanBagRes.StatusCode);
            }
            var pickupRes = await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{runId}/stops/{stopId}/pickup", new
            {
                actualContainers = expectedCount,
                contaminationFlag = false,
                discrepancyCode = "none",
            });
            Assert.Equal(HttpStatusCode.OK, pickupRes.StatusCode);
        }

        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsync($"/api/marketplace/runs/{runId}/deliver", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{runId}/complete", new
        {
            depotVerifiedContainers = 1050,
            coexDocketRef = "DOCKET-PASS10-1",
        })).StatusCode);

        var settleRes = await runnerClient.PostAsync($"/api/marketplace/runs/{runId}/settle", null);
        Assert.Equal(HttpStatusCode.OK, settleRes.StatusCode);
        var settleJson = await settleRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(400, settleJson.GetProperty("containerMafiaCents").GetInt32()); // 400 * 1¢ per-can ledger line

        // Verify all 3 households had BinIsOut reset to false and Mafia cleared $1.00 signup + $4.00 override = $5.00 (500¢)
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            foreach (var hid in new[] { hh1Id, hh2Id, hh3Id })
            {
                var hh = await db.Households.AsNoTracking().FirstAsync(h => h.Id == hid);
                Assert.False(hh.BinIsOut);
                Assert.Null(hh.BinIsOutAt);
                Assert.Equal(0, hh.PendingContainers);
                Assert.NotNull(hh.LastPickupAt);
            }

            var mafiaAfter = await db.Profiles.AsNoTracking().FirstAsync(p => p.Id == mafiaId);
            Assert.Equal(50, mafiaAfter.PendingCents); // Only Mafia's own 50¢ uncollected scan remains pending!
            Assert.Equal(500, mafiaAfter.ClearedCents); // 100¢ signup bonus + 400¢ (400 * 1¢) commission!
        }

        // Trigger RunGenerationService again -> ZERO phantom runs spawned for Tarragindi!
        var (acquired2, _) = await runGen.TriggerNowAsync();
        Assert.True(acquired2);
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var expectedArea = RunCluster.AreaName("TARRAGINDI", 4);
            var phantomRuns = await db.Runs
                .Where(r => r.AreaName == expectedArea && r.Id != runId)
                .ToListAsync();
            Assert.Empty(phantomRuns);
        }

        // Second run on HH1 (50 containers): Mafia earns 50¢ (1¢/can) ONLY — $1 signup bonus never clears a second time!
        Guid secondRunId;
        Guid secondStopId;
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var hh1 = await db.Households.FindAsync(hh1Id);
            var bin1 = await db.Bins.FirstAsync(b => b.HouseholdId == hh1Id);
            var depot = await db.Depots.FirstAsync();
            hh1!.PendingContainers = 50;
            hh1.PendingValueCents = 500;
            hh1.BinIsOut = true;
            hh1.BinIsOutAt = DateTime.UtcNow.AddMinutes(-1);
            bin1.PendingContainers = 50;
            bin1.PendingValueCents = 500;

            var run2 = new Run
            {
                DropPointId = depot.Id,
                AreaName = "TARRAGINDI",
                CentroidLat = -27.526,
                CentroidLng = 153.046,
                EstimatedContainers = 50,
                PerContainerCents = 3,
                EstimatedPayoutCents = 150,
                Status = "available",
                ExpiresAt = DateTime.UtcNow.AddHours(6),
            };
            var stop2 = new RunStop
            {
                RunId = run2.Id,
                BinId = bin1.Id,
                Lat = -27.526,
                Lng = 153.046,
                EstimatedContainers = 50,
                Sequence = 1,
            };
            run2.Stops.Add(stop2);
            db.Runs.Add(run2);
            await db.SaveChangesAsync();
            secondRunId = run2.Id;
            secondStopId = stop2.Id;
        }

        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{secondRunId}/claim", new { profileId = runnerProfileId })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsync($"/api/marketplace/runs/{secondRunId}/start", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsync($"/api/marketplace/runs/{secondRunId}/stops/{secondStopId}/arrive", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{secondRunId}/stops/{secondStopId}/pickup", new
        {
            actualContainers = 50,
            contaminationFlag = false,
            discrepancyCode = "none",
        })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsync($"/api/marketplace/runs/{secondRunId}/deliver", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{secondRunId}/complete", new { depotVerifiedContainers = 50 })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsync($"/api/marketplace/runs/{secondRunId}/settle", null)).StatusCode);

        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var mafiaFinal = await db.Profiles.AsNoTracking().FirstAsync(p => p.Id == mafiaId);
            Assert.Equal(50, mafiaFinal.PendingCents);   // Own 50¢ scan untouched!
            Assert.Equal(550, mafiaFinal.ClearedCents);  // 500¢ + 50¢ (1¢/can), NOT 600¢!
        }
    }

    [Fact]
    public async Task Settle_preserves_binIsOut_when_household_stages_new_kerb_bag_before_settlement()
    {
        var (sorterClient, _, _) = await _host.SignInMemberAsync($"pass10-race-s-{Guid.NewGuid():N}@example.test");
        var (runnerClient, _, runnerProfileId) = await _host.SignInMemberAsync($"pass10-race-r-{Guid.NewGuid():N}@example.test");

        var hhRes = await sorterClient.PostAsJsonAsync("/api/households", new
        {
            name = "Staged Kerb Home",
            address = "88 Ekibin Road East, Annerley QLD 4103",
            suburb = "ANNERLEY",
            street = "EKIBIN ROAD EAST",
            lat = -27.515,
            lng = 153.038,
            type = "residential",
            councilCollectionDay = 2,
            councilArea = "Brisbane City",
            usesDivider = true,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hhRes.StatusCode);
        var hhId = (await hhRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var regRes = await runnerClient.PostAsJsonAsync("/api/runner/register", new
        {
            profileId = runnerProfileId,
            vehicleType = "car",
            capacityBags = 10,
            serviceRadiusKm = 15.0,
        });
        Assert.Equal(HttpStatusCode.Created, regRes.StatusCode);

        Guid runId;
        Guid stopId;
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var hh = await db.Households.FindAsync(hhId);
            var bin = await db.Bins.FirstAsync(b => b.HouseholdId == hhId);
            var depot = await db.Depots.FirstOrDefaultAsync() ?? new Depot
            {
                Name = "RECAN Yeerongpilly",
                Address = "993 Fairfield Rd, Yeerongpilly",
                Lat = -27.531,
                Lng = 153.013,
            };
            if (!await db.PricingConfigs.AnyAsync())
            {
                db.PricingConfigs.Add(new PricingConfig());
            }

            if (!await db.Depots.AnyAsync()) db.Depots.Add(depot);

            hh!.BinStatus = BinStatuses.Collecting;
            hh.PendingContainers = 100;
            hh.PendingValueCents = 1000;
            hh.BinIsOut = true;
            hh.BinIsOutAt = DateTime.UtcNow.AddMinutes(-10);
            bin.PendingContainers = 100;
            bin.PendingValueCents = 1000;

            var run = new Run
            {
                DropPointId = depot.Id,
                AreaName = "ANNERLEY",
                CentroidLat = -27.515,
                CentroidLng = 153.038,
                EstimatedContainers = 100,
                PerContainerCents = 3,
                EstimatedPayoutCents = 300,
                Status = "available",
                ExpiresAt = DateTime.UtcNow.AddHours(6),
            };
            var stop = new RunStop
            {
                RunId = run.Id,
                BinId = bin.Id,
                Lat = -27.515,
                Lng = 153.038,
                EstimatedContainers = 100,
                Sequence = 1,
            };
            run.Stops.Add(stop);
            db.Runs.Add(run);
            await db.SaveChangesAsync();
            runId = run.Id;
            stopId = stop.Id;
        }

        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{runId}/claim", new { profileId = runnerProfileId })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsync($"/api/marketplace/runs/{runId}/start", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsync($"/api/marketplace/runs/{runId}/stops/{stopId}/arrive", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{runId}/stops/{stopId}/pickup", new
        {
            actualContainers = 100,
            contaminationFlag = false,
            discrepancyCode = "none",
        })).StatusCode);

        // While the Runner is driving to the depot, the household puts a brand-new QR bag on the kerb!
        var newBagRes = await sorterClient.PostAsJsonAsync("/api/bags", new
        {
            stream = "pet_clear",
            declaredContainers = 60,
            putOnKerb = true,
        });
        Assert.Equal(HttpStatusCode.Created, newBagRes.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsync($"/api/marketplace/runs/{runId}/deliver", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{runId}/complete", new { depotVerifiedContainers = 100 })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsync($"/api/marketplace/runs/{runId}/settle", null)).StatusCode);

        var hhAfter = await sorterClient.GetFromJsonAsync<JsonElement>($"/api/households/{hhId}");
        Assert.True(hhAfter.GetProperty("binIsOut").GetBoolean());
    }
}
