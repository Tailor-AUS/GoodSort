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
/// Pins the Pass 13 QA &amp; resilience hardening fixes (TailorAU/tailor-group#600):
/// 1. Marketplace run mutation endpoints (/claim, /start, /pickup, /skip, /deliver, /complete) preserve ordered Stops and DropPoint.
/// 2. Single-active-run hoarding guard on POST /api/marketplace/runs/{id}/claim + claimed-run release on POST /api/marketplace/runs/{id}/release.
/// 3. 24-hour stale claimed-run reclamation in RunGenerationService.ExpireOldRuns.
/// 4. Preserving Household.BinIsOut across AbsorbFullBinHouseholds so expired unclaimed runs never drop a household's kerb flag.
/// </summary>
public class Pass13HardeningTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;

    public Pass13HardeningTests(OpaqueBoxHost host) => _host = host;

    [Fact]
    public async Task Claim_start_pickup_skip_deliver_complete_always_include_ordered_stops_and_dropPoint()
    {
        var (runnerClient, _, profileId) = await _host.SignInMemberAsync($"pass13-graph-{Guid.NewGuid():N}@example.test");
        Assert.Equal(HttpStatusCode.Created, (await runnerClient.PostAsJsonAsync("/api/runner/register", new
        {
            profileId,
            vehicleType = "ute",
            capacityBags = 12,
            serviceRadiusKm = 15.0,
        })).StatusCode);

        Guid runId;
        Guid stop0Id;
        Guid stop1Id;
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            if (!await db.PricingConfigs.AnyAsync())
                db.PricingConfigs.Add(new PricingConfig());

            var depot = await db.Depots.FirstOrDefaultAsync();
            if (depot is null)
            {
                depot = new Depot
                {
                    Name = "Moorooka Refund Point",
                    Address = "100 Ipswich Rd, Moorooka QLD 4105",
                    Lat = -27.5320,
                    Lng = 153.0210,
                };
                db.Depots.Add(depot);
            }

            var binA = new Bin { Code = $"GS-13A-{Guid.NewGuid():N}"[..12], Name = "Stop A", Address = "1 Test St", Lat = -27.515, Lng = 153.030, PendingContainers = 500 };
            var binB = new Bin { Code = $"GS-13B-{Guid.NewGuid():N}"[..12], Name = "Stop B", Address = "2 Test St", Lat = -27.516, Lng = 153.031, PendingContainers = 500 };
            db.Bins.AddRange(binA, binB);

            var run = new Run
            {
                DropPointId = depot.Id,
                CentroidLat = -27.5155,
                CentroidLng = 153.0305,
                AreaName = "Moorooka",
                Status = "available",
                EstimatedContainers = 1000,
                PerContainerCents = 4,
                EstimatedPayoutCents = 4000,
                ExpiresAt = DateTime.UtcNow.AddHours(12),
            };
            var s1 = new RunStop { RunId = run.Id, BinId = binB.Id, Lat = binB.Lat, Lng = binB.Lng, EstimatedContainers = 500, Sequence = 1 };
            var s0 = new RunStop { RunId = run.Id, BinId = binA.Id, Lat = binA.Lat, Lng = binA.Lng, EstimatedContainers = 500, Sequence = 0 };
            db.Runs.Add(run);
            db.RunStops.AddRange(s1, s0);
            await db.SaveChangesAsync();
            runId = run.Id;
            stop0Id = s0.Id;
            stop1Id = s1.Id;
        }

        static void AssertStopsAndDepot(JsonElement payload, Guid expectedFirstStopId)
        {
            var stops = payload.GetProperty("stops");
            Assert.Equal(2, stops.GetArrayLength());
            Assert.Equal(expectedFirstStopId, stops[0].GetProperty("id").GetGuid());
            var dp = payload.GetProperty("dropPoint");
            Assert.Equal(JsonValueKind.Object, dp.ValueKind);
            Assert.False(string.IsNullOrWhiteSpace(dp.GetProperty("name").GetString()));
        }

        var claimRes = await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{runId}/claim", new { profileId });
        Assert.Equal(HttpStatusCode.OK, claimRes.StatusCode);
        AssertStopsAndDepot(await claimRes.Content.ReadFromJsonAsync<JsonElement>(), stop0Id);

        var startRes = await runnerClient.PostAsync($"/api/marketplace/runs/{runId}/start", null);
        Assert.Equal(HttpStatusCode.OK, startRes.StatusCode);
        AssertStopsAndDepot(await startRes.Content.ReadFromJsonAsync<JsonElement>(), stop0Id);

        var pickupRes = await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{runId}/stops/{stop0Id}/pickup", new
        {
            actualContainers = 510,
        });
        Assert.Equal(HttpStatusCode.OK, pickupRes.StatusCode);
        AssertStopsAndDepot(await pickupRes.Content.ReadFromJsonAsync<JsonElement>(), stop0Id);

        var skipRes = await runnerClient.PostAsync($"/api/marketplace/runs/{runId}/stops/{stop1Id}/skip", null);
        Assert.Equal(HttpStatusCode.OK, skipRes.StatusCode);
        AssertStopsAndDepot(await skipRes.Content.ReadFromJsonAsync<JsonElement>(), stop0Id);

        var deliverRes = await runnerClient.PostAsync($"/api/marketplace/runs/{runId}/deliver", null);
        Assert.Equal(HttpStatusCode.OK, deliverRes.StatusCode);
        AssertStopsAndDepot(await deliverRes.Content.ReadFromJsonAsync<JsonElement>(), stop0Id);

        var completeRes = await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{runId}/complete", new
        {
            depotVerifiedContainers = 510,
            coexDocketRef = "PASS13-DOCKET",
        });
        Assert.Equal(HttpStatusCode.OK, completeRes.StatusCode);
        AssertStopsAndDepot(await completeRes.Content.ReadFromJsonAsync<JsonElement>(), stop0Id);
    }

    [Fact]
    public async Task Runner_cannot_hoard_multiple_active_runs_and_can_release_claimed_run_only_before_start()
    {
        var (runnerA, _, profileA) = await _host.SignInMemberAsync($"pass13-relA-{Guid.NewGuid():N}@example.test");
        var (runnerB, _, profileB) = await _host.SignInMemberAsync($"pass13-relB-{Guid.NewGuid():N}@example.test");
        foreach (var (client, pid) in new[] { (runnerA, profileA), (runnerB, profileB) })
        {
            Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/runner/register", new
            {
                profileId = pid,
                vehicleType = "car",
                capacityBags = 10,
                serviceRadiusKm = 15.0,
            })).StatusCode);
        }

        Guid run1Id;
        Guid run2Id;
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            if (!await db.PricingConfigs.AnyAsync())
                db.PricingConfigs.Add(new PricingConfig());
            var depot = await db.Depots.FirstOrDefaultAsync() ?? new Depot
            {
                Name = "Yeronga Depot",
                Address = "10 Fairfield Rd, Yeronga QLD 4104",
                Lat = -27.519,
                Lng = 153.018,
            };
            if (db.Entry(depot).State == EntityState.Detached) db.Depots.Add(depot);

            var r1 = new Run
            {
                DropPointId = depot.Id,
                CentroidLat = -27.520,
                CentroidLng = 153.020,
                AreaName = "Yeronga",
                Status = "available",
                EstimatedContainers = 1000,
                PerContainerCents = 4,
                EstimatedPayoutCents = 4000,
                ExpiresAt = DateTime.UtcNow.AddMinutes(30),
            };
            var r2 = new Run
            {
                DropPointId = depot.Id,
                CentroidLat = -27.505,
                CentroidLng = 153.035,
                AreaName = "Annerley",
                Status = "available",
                EstimatedContainers = 1000,
                PerContainerCents = 4,
                EstimatedPayoutCents = 4000,
                ExpiresAt = DateTime.UtcNow.AddHours(8),
            };
            db.Runs.AddRange(r1, r2);
            await db.SaveChangesAsync();
            run1Id = r1.Id;
            run2Id = r2.Id;
        }

        Assert.Equal(HttpStatusCode.OK, (await runnerA.PostAsJsonAsync($"/api/marketplace/runs/{run1Id}/claim", new { profileId = profileA })).StatusCode);

        // Runner A cannot hoard a second active run while holding run1
        var hoardRes = await runnerA.PostAsJsonAsync($"/api/marketplace/runs/{run2Id}/claim", new { profileId = profileA });
        Assert.Equal(HttpStatusCode.BadRequest, hoardRes.StatusCode);

        // Runner B cannot release Runner A's claimed run
        var forbidRelease = await runnerB.PostAsync($"/api/marketplace/runs/{run1Id}/release", null);
        Assert.Equal(HttpStatusCode.Forbidden, forbidRelease.StatusCode);

        // Runner A releases run1 -> run1 returns to available (with refreshed expiry) and Runner B can claim it
        var okRelease = await runnerA.PostAsync($"/api/marketplace/runs/{run1Id}/release", null);
        Assert.Equal(HttpStatusCode.OK, okRelease.StatusCode);

        var bClaim = await runnerB.PostAsJsonAsync($"/api/marketplace/runs/{run1Id}/claim", new { profileId = profileB });
        Assert.Equal(HttpStatusCode.OK, bClaim.StatusCode);

        // Once started (in_progress), /release is rejected
        Assert.Equal(HttpStatusCode.OK, (await runnerB.PostAsync($"/api/marketplace/runs/{run1Id}/start", null)).StatusCode);
        var startedRelease = await runnerB.PostAsync($"/api/marketplace/runs/{run1Id}/release", null);
        Assert.Equal(HttpStatusCode.BadRequest, startedRelease.StatusCode);
    }

    [Fact]
    public async Task RunGeneration_reclaims_24h_stale_claimed_runs_and_preserves_BinIsOut_across_unclaimed_expiry()
    {
        Guid staleRunId;
        Guid absorbedRunId;
        Guid kerbHouseholdId;

        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            if (!await db.PricingConfigs.AnyAsync())
                db.PricingConfigs.Add(new PricingConfig());

            var depot = await db.Depots.FirstOrDefaultAsync() ?? new Depot
            {
                Name = "West End Depot",
                Address = "5 Montague Rd, West End QLD 4101",
                Lat = -27.481,
                Lng = 153.005,
            };
            if (db.Entry(depot).State == EntityState.Detached) db.Depots.Add(depot);

            var staleProfile = new Profile { Email = $"stale-{Guid.NewGuid():N}@example.test", Name = "Stale Runner" };
            var staleRunner = new RunnerProfile { ProfileId = staleProfile.Id, VehicleType = "car" };
            db.Profiles.Add(staleProfile);
            db.RunnerProfiles.Add(staleRunner);

            var staleRun = new Run
            {
                DropPointId = depot.Id,
                RunnerId = staleRunner.Id,
                CentroidLat = -27.482,
                CentroidLng = 153.010,
                AreaName = "West End",
                Status = "claimed",
                EstimatedContainers = 1000,
                PerContainerCents = 4,
                EstimatedPayoutCents = 4000,
                ClaimedAt = DateTime.UtcNow.AddHours(-25),
                ExpiresAt = DateTime.UtcNow.AddHours(6),
            };
            db.Runs.Add(staleRun);

            var kerbHh = new Household
            {
                Name = "Kerb Flagged Home",
                Address = "88 Boundary St, West End QLD 4101",
                Suburb = "West End",
                Type = "residential",
                Lat = -27.4815,
                Lng = 153.0110,
                BinStatus = BinStatuses.Collecting,
                BinIsOut = true,
                BinIsOutAt = DateTime.UtcNow,
                AccessConsent = true,
            };
            var kerbBin = new Bin
            {
                Code = $"GS-KRB-{Guid.NewGuid():N}"[..12],
                Name = kerbHh.Name,
                Address = kerbHh.Address,
                Lat = kerbHh.Lat,
                Lng = kerbHh.Lng,
                HouseholdId = kerbHh.Id,
                Status = "active",
                PendingContainers = 0,
            };
            var nearbyOpenRun = new Run
            {
                DropPointId = depot.Id,
                CentroidLat = -27.4818,
                CentroidLng = 153.0112,
                AreaName = "West End",
                Status = "available",
                EstimatedContainers = 980,
                PerContainerCents = 4,
                EstimatedPayoutCents = 3920,
                ExpiresAt = DateTime.UtcNow.AddHours(6),
            };
            db.Households.Add(kerbHh);
            db.Bins.Add(kerbBin);
            db.Runs.Add(nearbyOpenRun);
            await db.SaveChangesAsync();

            staleRunId = staleRun.Id;
            absorbedRunId = nearbyOpenRun.Id;
            kerbHouseholdId = kerbHh.Id;
        }

        // Pass 1: stale claimed run is reclaimed -> available; kerb household is absorbed AND keeps BinIsOut == true
        using (var scope = _host.Services.CreateScope())
        {
            var svc = scope.ServiceProvider.GetRequiredService<RunGenerationService>();
            var (acquired, _) = await svc.TriggerNowAsync();
            Assert.True(acquired);
        }

        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var reclaimed = await db.Runs.AsNoTracking().FirstAsync(r => r.Id == staleRunId);
            Assert.Equal("available", reclaimed.Status);
            Assert.Null(reclaimed.RunnerId);
            Assert.Null(reclaimed.ClaimedAt);

            var absorbedStops = await db.RunStops.AsNoTracking().Where(s => s.RunId == absorbedRunId).ToListAsync();
            Assert.Single(absorbedStops);

            var hhAfterAbsorb = await db.Households.AsNoTracking().FirstAsync(h => h.Id == kerbHouseholdId);
            Assert.True(hhAfterAbsorb.BinIsOut);

            // Force-expire the unclaimed run and verify BinIsOut remains true so the household is never stranded
            var toExpire = await db.Runs.FirstAsync(r => r.Id == absorbedRunId);
            toExpire.ExpiresAt = DateTime.UtcNow.AddMinutes(-5);
            await db.SaveChangesAsync();
        }

        using (var scope = _host.Services.CreateScope())
        {
            var svc = scope.ServiceProvider.GetRequiredService<RunGenerationService>();
            await svc.TriggerNowAsync();
        }

        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var expiredRun = await db.Runs.AsNoTracking().FirstAsync(r => r.Id == absorbedRunId);
            Assert.Equal("expired", expiredRun.Status);

            var hhAfterExpiry = await db.Households.AsNoTracking().FirstAsync(h => h.Id == kerbHouseholdId);
            Assert.True(hhAfterExpiry.BinIsOut);
        }
    }
}
