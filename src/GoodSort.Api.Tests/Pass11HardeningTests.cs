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
/// Pins the Pass 11 QA &amp; hardening fixes (TailorAU/tailor-group#600):
/// 1. When PickupReminderService stamps Household.LastPickupAt at 6pm the night before a
///    referred household's first pickup, POST /api/marketplace/runs/{id}/settle still clears
///    the referrer's $1 (100¢) Container Mafia signup bonus via Bin.LastCollectedAt == null,
///    and still never double-clears on subsequent runs.
/// 2. Sub-minute run completions (e.g. Start -> Complete in 1 second at the kerb/depot) floor
///    elapsed duration at 5 minutes and cap runEfficiency at 3,600 containers/hr so the public
///    /api/runner/leaderboard is never poisoned with millions of containers/hr.
/// </summary>
public class Pass11HardeningTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;

    public Pass11HardeningTests(OpaqueBoxHost host) => _host = host;

    [Fact]
    public async Task Settle_clears_mafia_signup_bonus_even_after_pickup_reminder_stamped_household_lastPickupAt()
    {
        var (_, _, mafiaId) = await _host.SignInMemberAsync($"pass11-mafia-{Guid.NewGuid():N}@example.test");
        var (sorterClient, _, _) = await _host.SignInMemberAsync($"pass11-sorter-{Guid.NewGuid():N}@example.test", referrerId: mafiaId);
        var (runnerClient, _, runnerProfileId) = await _host.SignInMemberAsync($"pass11-runner-{Guid.NewGuid():N}@example.test");

        var hhRes = await sorterClient.PostAsJsonAsync("/api/households", new
        {
            name = "Reminder First Home",
            address = "24 Cracknell Road, Annerley QLD 4103",
            suburb = "ANNERLEY",
            street = "CRACKNELL ROAD",
            lat = -27.516,
            lng = 153.034,
            type = "residential",
            councilCollectionDay = 3,
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
            capacityBags = 12,
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
            if (!await db.Depots.AnyAsync()) db.Depots.Add(depot);

            // Simulate PickupReminderService having run at 6pm the night before:
            // Household.LastPickupAt is non-null, while Bin.LastCollectedAt is still null!
            hh!.BinStatus = BinStatuses.Collecting;
            hh.PendingContainers = 120;
            hh.PendingValueCents = 1200;
            hh.LastPickupAt = DateTime.UtcNow.Date;
            bin.PendingContainers = 120;
            bin.PendingValueCents = 1200;
            Assert.Null(bin.LastCollectedAt);

            var run = new Run
            {
                DropPointId = depot.Id,
                AreaName = "Annerley · Wednesday",
                CentroidLat = -27.516,
                CentroidLng = 153.034,
                EstimatedContainers = 120,
                PerContainerCents = 3,
                EstimatedPayoutCents = 360,
                Status = "available",
                ExpiresAt = DateTime.UtcNow.AddHours(6),
            };
            var stop = new RunStop
            {
                RunId = run.Id,
                BinId = bin.Id,
                Lat = -27.516,
                Lng = 153.034,
                EstimatedContainers = 120,
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
            actualContainers = 120,
            contaminationFlag = false,
            discrepancyCode = "none",
        })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsync($"/api/marketplace/runs/{runId}/deliver", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsJsonAsync($"/api/marketplace/runs/{runId}/complete", new { depotVerifiedContainers = 120 })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runnerClient.PostAsync($"/api/marketplace/runs/{runId}/settle", null)).StatusCode);

        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var mafia = await db.Profiles.AsNoTracking().FirstAsync(p => p.Id == mafiaId);
            Assert.Equal(0, mafia.PendingCents);
            Assert.Equal(220, mafia.ClearedCents); // 100¢ signup bonus + 120¢ (120 * 1¢) commission!

            var binAfter = await db.Bins.AsNoTracking().FirstAsync(b => b.HouseholdId == hhId);
            Assert.NotNull(binAfter.LastCollectedAt);
        }
    }

    [Fact]
    public async Task Sub_minute_run_completion_caps_efficiencyScore_at_3600_on_leaderboard()
    {
        var options = new DbContextOptionsBuilder<GoodSortDbContext>()
            .UseInMemoryDatabase($"pass11-eff-{Guid.NewGuid():N}")
            .Options;
        await using var db = new GoodSortDbContext(options);

        var profile = new Profile { Id = Guid.NewGuid(), Name = "Jordan Quick", Email = "jordan@test.au" };
        var runner = new RunnerProfile { Id = Guid.NewGuid(), ProfileId = profile.Id, Profile = profile };
        var startUtc = DateTime.UtcNow.AddSeconds(-1);
        var run = new Run
        {
            Id = Guid.NewGuid(),
            RunnerId = runner.Id,
            DropPointId = Guid.NewGuid(),
            ActualContainers = 400,
            ActualPayoutCents = 1200,
            EstimatedDurationMin = 30,
            StartedAt = startUtc,
            CompletedAt = startUtc.AddSeconds(1), // 1 second elapsed -> previously 1,440,000 containers/hr!
            Status = "settled",
        };
        db.Profiles.Add(profile);
        db.RunnerProfiles.Add(runner);
        db.Runs.Add(run);
        await db.SaveChangesAsync();

        var service = new RunnerService(db);
        await service.GenerateRating(run);
        await service.UpdateRunnerStats(run, startUtc.AddSeconds(1));

        var board = await service.GetLeaderboard("all", 10);
        var entry = Assert.Single(board);
        Assert.Equal("Jordan", entry.Name);
        Assert.InRange(entry.EfficiencyScore, 1.0, 3600.0);
    }
}
