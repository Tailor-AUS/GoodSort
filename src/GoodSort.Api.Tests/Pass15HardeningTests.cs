using System.Net;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using GoodSort.Api.Tests.OpaqueBox;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace GoodSort.Api.Tests;

/// <summary>
/// Pins the Pass 15 QA &amp; resilience hardening fixes (TailorAU/tailor-group#600):
/// 1. Unconfigured ACS (e.g. during the azd deploy -&gt; restore-secrets.sh window) must NEVER
///    stamp Household.LastPickupAt, Run.LastBriefedAt, or Profile.LastNudgedAt without sending mail.
/// 2. RunGenerationService.ResolveMinPayoutCents reads IConfiguration ("MINIMUM_RUN_PAYOUT_CENTS")
///    and clamps out-of-range values ([100, 100_000], default 2000).
/// 3. GET /api/marketplace/runs rejects invalid coordinates/radius bounds cleanly.
/// 4. GrowthEventRetentionHost releases its 6-hour SingletonLease if a sweep throws mid-pass.
/// </summary>
public class Pass15HardeningTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;

    public Pass15HardeningTests(OpaqueBoxHost host) => _host = host;

    [Fact]
    public async Task PickupReminderService_does_not_stamp_LastPickupAt_or_LastBriefedAt_when_ACS_is_unconfigured()
    {
        var tomorrowLocal = (DateTime.UtcNow + BrisbaneTime.Offset).Date.AddDays(1);
        var tomorrowDow = (int)tomorrowLocal.DayOfWeek;

        Guid hhId;
        Guid runId;

        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();

            var hh = new Household
            {
                Name = "Deploy Window House",
                Address = "88 Boundary St, West End QLD 4101",
                Suburb = "WEST END",
                Type = "residential",
                BinStatus = BinStatuses.Collecting,
                CouncilCollectionDay = tomorrowDow,
                Lat = -27.481,
                Lng = 153.012,
            };
            db.Households.Add(hh);

            var sorter = new Profile
            {
                Name = "Deploy Sorter",
                Email = $"pass15-remind-hh-{Guid.NewGuid():N}@example.test",
                Phone = $"pass15-remind-hh-{Guid.NewGuid():N}@example.test",
                Role = "sorter",
                HouseholdId = hh.Id,
            };
            var runnerUser = new Profile
            {
                Name = "Deploy Runner",
                Email = $"pass15-remind-run-{Guid.NewGuid():N}@example.test",
                Phone = $"pass15-remind-run-{Guid.NewGuid():N}@example.test",
                Role = "both",
            };
            db.Profiles.AddRange(sorter, runnerUser);

            var runnerProfile = new RunnerProfile
            {
                ProfileId = runnerUser.Id,
                VehicleType = "car",
                CapacityBags = 8,
                ServiceRadiusKm = 15,
            };
            db.RunnerProfiles.Add(runnerProfile);

            var depot = await db.Depots.FirstOrDefaultAsync();
            if (depot is null)
            {
                depot = new Depot
                {
                    Name = "TOMRA West End",
                    Address = "Montague Rd, West End QLD 4101",
                    Lat = -27.485,
                    Lng = 153.005,
                };
                db.Depots.Add(depot);
            }

            var run = new Run
            {
                Status = "claimed",
                AreaName = "WEST END",
                RunnerId = runnerProfile.Id,
                ClaimedAt = DateTime.UtcNow.AddHours(-1),
                DropPointId = depot.Id,
                CentroidLat = -27.481,
                CentroidLng = 153.012,
                EstimatedContainers = 1000,
                EstimatedPayoutCents = 4000,
                PerContainerCents = 4,
                ExpiresAt = DateTime.UtcNow.AddHours(12),
            };
            db.Runs.Add(run);
            await db.SaveChangesAsync();

            hhId = hh.Id;
            runId = run.Id;
        }

        // OpaqueBoxHost runs with ACS_CONNECTION_STRING = "" (simulating unconfigured deploy window).
        using (var scope = _host.Services.CreateScope())
        {
            var reminders = scope.ServiceProvider.GetRequiredService<PickupReminderService>();
            var (hhSent, runSent) = await reminders.TriggerNow();
            Assert.Equal(0, hhSent);
            Assert.Equal(0, runSent);
        }

        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var hhAfter = await db.Households.AsNoTracking().FirstAsync(h => h.Id == hhId);
            var runAfter = await db.Runs.AsNoTracking().FirstAsync(r => r.Id == runId);

            Assert.Null(hhAfter.LastPickupAt);
            Assert.Null(runAfter.LastBriefedAt);
        }
    }

    [Fact]
    public async Task NotificationService_does_not_stamp_LastNudgedAt_when_ACS_is_unconfigured()
    {
        Guid stuckProfileId;
        Guid waitlistProfileId;

        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();

            var stuckHh = new Household
            {
                Name = "No Suburb House",
                Address = "Unknown Street",
                Suburb = "",
                Type = "residential",
                BinStatus = BinStatuses.Waitlisted,
            };
            var waitlistHh = new Household
            {
                Name = "Moorooka Waitlist House",
                Address = "10 Beaudesert Rd, Moorooka QLD 4105",
                Suburb = "MOOROOKA",
                Type = "residential",
                BinStatus = BinStatuses.Waitlisted,
                CouncilCollectionDay = 2,
            };
            db.Households.AddRange(stuckHh, waitlistHh);

            var stuckMember = new Profile
            {
                Name = "Stuck Sorter",
                Email = $"pass15-stuck-{Guid.NewGuid():N}@example.test",
                Phone = $"pass15-stuck-{Guid.NewGuid():N}@example.test",
                HouseholdId = stuckHh.Id,
            };
            var waitlistMember = new Profile
            {
                Name = "Waitlist Sorter",
                Email = $"pass15-wait-{Guid.NewGuid():N}@example.test",
                Phone = $"pass15-wait-{Guid.NewGuid():N}@example.test",
                HouseholdId = waitlistHh.Id,
            };
            db.Profiles.AddRange(stuckMember, waitlistMember);
            await db.SaveChangesAsync();

            stuckProfileId = stuckMember.Id;
            waitlistProfileId = waitlistMember.Id;
        }

        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var logger = scope.ServiceProvider.GetRequiredService<Microsoft.Extensions.Logging.ILogger<NotificationService>>();
            var cfg = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["RECOVERY_EMAIL_ENABLED"] = "true",
                    ["ACS_CONNECTION_STRING"] = "",
                })
                .Build();

            var svc = new NotificationService(db, cfg, logger);
            var recoverySent = await svc.SendIncompleteHouseholdRecovery();
            Assert.Equal(0, recoverySent);

            // 100 containers triggers WaitlistNudge.ShouldNudgeOthers (milestone 100)
            await svc.SendWaitlistProgress("MOOROOKA", 2, 100, 900, excludeProfileId: null);
        }

        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var stuckAfter = await db.Profiles.AsNoTracking().FirstAsync(p => p.Id == stuckProfileId);
            var waitlistAfter = await db.Profiles.AsNoTracking().FirstAsync(p => p.Id == waitlistProfileId);

            Assert.Null(stuckAfter.LastNudgedAt);
            Assert.Null(waitlistAfter.LastNudgedAt);
        }
    }

    [Theory]
    [InlineData(null, 2000)]
    [InlineData("", 2000)]
    [InlineData("abc", 2000)]
    [InlineData("0", 2000)]
    [InlineData("-500", 2000)]
    [InlineData("99", 2000)]
    [InlineData("100", 100)]
    [InlineData("1500", 1500)]
    [InlineData("100000", 100000)]
    [InlineData("100001", 2000)]
    public void ResolveMinPayoutCents_reads_IConfiguration_and_clamps_bounds(string? configured, int expected)
    {
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["MINIMUM_RUN_PAYOUT_CENTS"] = configured,
            })
            .Build();

        Assert.Equal(expected, RunGenerationService.ResolveMinPayoutCents(cfg));
    }

    [Fact]
    public async Task Marketplace_runs_validates_coordinates_and_radius_bounds()
    {
        using var client = _host.CreateClient();

        var badLat = await client.GetAsync("/api/marketplace/runs?lat=95&lng=153.02");
        Assert.Equal(HttpStatusCode.BadRequest, badLat.StatusCode);

        var badLng = await client.GetAsync("/api/marketplace/runs?lat=-27.47&lng=195");
        Assert.Equal(HttpStatusCode.BadRequest, badLng.StatusCode);

        var zeroRadius = await client.GetAsync("/api/marketplace/runs?lat=-27.47&lng=153.02&radiusKm=0");
        Assert.Equal(HttpStatusCode.BadRequest, zeroRadius.StatusCode);

        var valid = await client.GetAsync("/api/marketplace/runs?lat=-27.47&lng=153.02&radiusKm=15");
        Assert.Equal(HttpStatusCode.OK, valid.StatusCode);
    }

    [Fact]
    public void GrowthEventRetentionHost_releases_singleton_lease_when_sweep_faults()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "src", "GoodSort.Api", "Services", "GrowthEventRetention.cs")))
            dir = dir.Parent;
        Assert.NotNull(dir);

        var src = File.ReadAllText(Path.Combine(dir!.FullName, "src", "GoodSort.Api", "Services", "GrowthEventRetention.cs"));
        Assert.Contains("SingletonLease.Release(db, LeaseName", src, StringComparison.Ordinal);
        Assert.Contains("retryInOneHour", src, StringComparison.Ordinal);
    }
}
