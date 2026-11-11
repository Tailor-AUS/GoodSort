using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using GoodSort.Api.Tests.OpaqueBox;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace GoodSort.Api.Tests;

/// <summary>
/// Pins the Pass 6 QA &amp; hardening fixes (TailorAU/tailor-group#600):
/// 1. BrisbaneTime.StartOfTodayUtc / StartOfWeekUtc + RunnerService.UpdateStreak / "early_bird" badge / GenerateRating zero-duration guard.
/// 2. GET /api/runner/earnings/{profileId} uses Brisbane (UTC+10) midnight rather than resetting at 10:00 AM AEST (00:00 UTC).
/// 3. Single-account Sybil household-count guard &amp; coordinate/input bounds on POST /api/households, PATCH .../street, and POST /api/waitlist/unit-complex.
/// 4. POST /api/scan/photo/confirm mirrors launch-bonus-adjusted cents onto Bin.PendingValueCents to match Household.PendingValueCents.
/// </summary>
public class Pass6HardeningTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;

    public Pass6HardeningTests(OpaqueBoxHost host) => _host = host;

    [Fact]
    public void BrisbaneTime_StartOfTodayUtc_and_StartOfWeekUtc_anchor_to_AEST_midnight()
    {
        // Thu 12 Nov 2026 08:00 AEST = Wed 11 Nov 2026 22:00 UTC
        var morning8amAestUtc = new DateTime(2026, 11, 11, 22, 0, 0, DateTimeKind.Utc);
        // Thu 12 Nov 2026 10:30 AEST = Thu 12 Nov 2026 00:30 UTC
        var morning1030amAestUtc = new DateTime(2026, 11, 12, 0, 30, 0, DateTimeKind.Utc);

        // Both instants are Thursday 12 Nov in Brisbane -> local 00:00 is 2026-11-11T14:00:00Z
        var expectedTodayStartUtc = new DateTime(2026, 11, 11, 14, 0, 0, DateTimeKind.Utc);
        Assert.Equal(expectedTodayStartUtc, BrisbaneTime.StartOfTodayUtc(morning8amAestUtc));
        Assert.Equal(expectedTodayStartUtc, BrisbaneTime.StartOfTodayUtc(morning1030amAestUtc));

        // Sunday 8 Nov 2026 00:00 AEST = Saturday 7 Nov 2026 14:00 UTC
        var expectedWeekStartUtc = new DateTime(2026, 11, 7, 14, 0, 0, DateTimeKind.Utc);
        Assert.Equal(expectedWeekStartUtc, BrisbaneTime.StartOfWeekUtc(morning8amAestUtc));
    }

    [Fact]
    public void RunnerService_UpdateStreak_uses_Brisbane_calendar_days_across_10am_AEST()
    {
        var runner = new RunnerProfile { Id = Guid.NewGuid(), ProfileId = Guid.NewGuid() };

        // Run 1 at 09:30 AM AEST Thu 12 Nov (23:30 UTC Wed 11 Nov)
        var run1Utc = new DateTime(2026, 11, 11, 23, 30, 0, DateTimeKind.Utc);
        RunnerService.UpdateStreak(runner, run1Utc);
        runner.LastRunCompletedAt = run1Utc;
        Assert.Equal(1, runner.CurrentStreakDays);

        // Run 2 one hour later at 10:30 AM AEST Thu 12 Nov (00:30 UTC Thu 12 Nov):
        // UTC date changed, but Brisbane date is STILL Thu 12 Nov -> streak stays 1!
        var run2SameMorningUtc = new DateTime(2026, 11, 12, 0, 30, 0, DateTimeKind.Utc);
        RunnerService.UpdateStreak(runner, run2SameMorningUtc);
        runner.LastRunCompletedAt = run2SameMorningUtc;
        Assert.Equal(1, runner.CurrentStreakDays);

        // Run 3 next morning at 08:30 AM AEST Fri 13 Nov (22:30 UTC Thu 12 Nov):
        // UTC date is STILL 12 Nov, but Brisbane date advanced to Fri 13 Nov -> streak increments to 2!
        var run3NextMorningUtc = new DateTime(2026, 11, 12, 22, 30, 0, DateTimeKind.Utc);
        RunnerService.UpdateStreak(runner, run3NextMorningUtc);
        runner.LastRunCompletedAt = run3NextMorningUtc;
        Assert.Equal(2, runner.CurrentStreakDays);
        Assert.Equal(2, runner.LongestStreakDays);
    }

    [Fact]
    public async Task RunnerService_early_bird_uses_Brisbane_hour_and_GenerateRating_guards_zero_duration()
    {
        var options = new DbContextOptionsBuilder<GoodSortDbContext>()
            .UseInMemoryDatabase($"runner-tz-{Guid.NewGuid():N}")
            .Options;
        await using var db = new GoodSortDbContext(options);

        var afternoonProfile = new Profile { Id = Guid.NewGuid(), Name = "Afternoon" };
        var afternoonRunner = new RunnerProfile { Id = Guid.NewGuid(), ProfileId = afternoonProfile.Id, Profile = afternoonProfile };
        var morningProfile = new Profile { Id = Guid.NewGuid(), Name = "Morning" };
        var morningRunner = new RunnerProfile { Id = Guid.NewGuid(), ProfileId = morningProfile.Id, Profile = morningProfile };
        db.Profiles.AddRange(afternoonProfile, morningProfile);
        db.RunnerProfiles.AddRange(afternoonRunner, morningRunner);

        // 04:30 UTC = 14:30 AEST (2:30 PM afternoon in Brisbane!) -> NOT early_bird
        var afternoonRun = new Run
        {
            Id = Guid.NewGuid(),
            RunnerId = afternoonRunner.Id,
            EstimatedDurationMin = 0, // Also exercises zero-duration division guard!
            StartedAt = new DateTime(2026, 11, 11, 4, 30, 0, DateTimeKind.Utc),
            CompletedAt = new DateTime(2026, 11, 11, 5, 0, 0, DateTimeKind.Utc),
            ActualContainers = 500,
            ActualPayoutCents = 2500,
        };

        // 20:15 UTC = 06:15 AEST next morning -> IS early_bird!
        var morningRun = new Run
        {
            Id = Guid.NewGuid(),
            RunnerId = morningRunner.Id,
            EstimatedDurationMin = 30,
            StartedAt = new DateTime(2026, 11, 11, 20, 15, 0, DateTimeKind.Utc),
            CompletedAt = new DateTime(2026, 11, 11, 20, 35, 0, DateTimeKind.Utc),
            ActualContainers = 500,
            ActualPayoutCents = 2500,
        };
        db.Runs.AddRange(afternoonRun, morningRun);
        await db.SaveChangesAsync();

        var svc = new RunnerService(db);

        var zeroDurationRating = await svc.GenerateRating(afternoonRun);
        Assert.True(double.IsFinite(zeroDurationRating.Timeliness));
        Assert.InRange(zeroDurationRating.Stars, 1, 5);
        await svc.UpdateRunnerStats(afternoonRun, afternoonRun.CompletedAt);
        Assert.DoesNotContain("early_bird", afternoonRunner.Badges);

        await svc.GenerateRating(morningRun);
        await svc.UpdateRunnerStats(morningRun, morningRun.CompletedAt);
        Assert.Contains("early_bird", morningRunner.Badges);
    }

    [Fact]
    public async Task Runner_earnings_endpoint_counts_Brisbane_today_settlements()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync($"runner-earn-{Guid.NewGuid():N}@example.test");
        var regRes = await client.PostAsJsonAsync("/api/runner/register", new
        {
            vehicleType = "ute",
            abn = "51824753556",
        });
        Assert.Equal(HttpStatusCode.Created, regRes.StatusCode);
        var runnerId = (await regRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        // Seed a settled run 5 minutes after Brisbane midnight today (which is 14:05 UTC yesterday!)
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            db.Runs.Add(new Run
            {
                Id = Guid.NewGuid(),
                RunnerId = runnerId,
                Status = "settled",
                ActualContainers = 1000,
                ActualPayoutCents = 4200,
                SettledAt = BrisbaneTime.StartOfTodayUtc().AddMinutes(5),
            });
            await db.SaveChangesAsync();
        }

        var earnRes = await client.GetFromJsonAsync<JsonElement>($"/api/runner/earnings/{profileId}");
        Assert.Equal(4200, earnRes.GetProperty("todayEarnings").GetInt32());
        Assert.Equal(4200, earnRes.GetProperty("weekEarnings").GetInt32());
    }

    [Fact]
    public async Task Single_account_cannot_inflate_suburb_household_count_and_coordinates_are_bounded()
    {
        var dbName = $"sybil-hh-{Guid.NewGuid():N}";
        await using var factory = _host.WithWebHostBuilder(b =>
        {
            b.ConfigureServices(s =>
            {
                s.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                s.RemoveAll<GoodSortDbContext>();
                s.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(dbName));
            });
        });

        var client = factory.CreateClient();
        var email = $"sybil-{Guid.NewGuid():N}@example.test";
        var otpSend = await client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        var code = (await otpSend.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verify = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code });
        var token = (await verify.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        // Out-of-range coordinates rejected on POST /api/households
        var badCoord = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Bad Coord",
            address = "10 Mayfield Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = -95.0,
            lng = 153.02,
            councilCollectionDay = 2,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.BadRequest, badCoord.StatusCode);

        // First household create succeeds
        Guid? firstId = null;
        for (var i = 0; i < 3; i++)
        {
            var res = await client.PostAsJsonAsync("/api/households", new
            {
                name = $"Attempt {i}",
                address = $"{10 + i} Mayfield Rd, Moorooka QLD 4105",
                suburb = "MOOROOKA",
                lat = -27.5333,
                lng = 153.0167,
                councilCollectionDay = 2,
                accessConsent = true,
            });
            Assert.Equal(HttpStatusCode.Created, res.StatusCode);
            var id = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
            firstId ??= id;
            Assert.Equal(firstId.Value, id);
        }

        // Suburb board must show ONLY 1 household, never 3!
        var growth = await client.GetFromJsonAsync<JsonElement>("/api/growth/brisbane");
        Assert.Equal(1, growth.GetProperty("totalHouseholds").GetInt32());

        // Out-of-range coordinates on PATCH .../street rejected
        var badPatch = await client.PatchAsJsonAsync($"/api/households/{firstId}/street", new
        {
            address = "12 Mayfield Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = -27.5333,
            lng = 195.0,
        });
        Assert.Equal(HttpStatusCode.BadRequest, badPatch.StatusCode);

        // Unit-complex endpoint rejects blank building/address & out-of-range coords
        var blankUnit = await client.PostAsJsonAsync("/api/waitlist/unit-complex", new
        {
            buildingName = "   ",
            address = "42 Hamilton Rd, Moorooka QLD 4105",
            lat = -27.5333,
            lng = 153.0167,
        });
        Assert.Equal(HttpStatusCode.BadRequest, blankUnit.StatusCode);
    }

    [Fact]
    public async Task Photo_scan_confirm_mirrors_launch_bonus_cents_onto_household_bin()
    {
        var dbName = $"photo-bonus-bin-{Guid.NewGuid():N}";
        await using var factory = _host.WithWebHostBuilder(b =>
        {
            b.UseSetting("LAUNCH_BONUS_CONTAINERS", "5");
            b.ConfigureServices(s =>
            {
                s.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                s.RemoveAll<GoodSortDbContext>();
                s.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(dbName));
            });
        });

        var client = factory.CreateClient();
        var email = $"bonus-bin-{Guid.NewGuid():N}@example.test";
        var otpSend = await client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        var code = (await otpSend.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verify = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code });
        var verifyJson = await verify.Content.ReadFromJsonAsync<JsonElement>();
        var token = verifyJson.GetProperty("token").GetString();
        var profileId = verifyJson.GetProperty("profile").GetProperty("id").GetGuid();
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var hhRes = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Bonus House",
            address = "20 Mayfield Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = -27.5333,
            lng = 153.0167,
            councilCollectionDay = 3,
            accessConsent = true,
        });
        var hhId = (await hhRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        using var scope = factory.Services.CreateScope();
        var tokens = scope.ServiceProvider.GetRequiredService<ScanTokenService>();
        var scanToken = tokens.Issue(new ScanTokenPayload
        {
            Uid = profileId,
            Items = [new ScanTokenItem { Name = "Suntory 330ml Can", Material = "aluminium", Count = 2, Eligible = true }],
        }, TimeSpan.FromMinutes(10));

        var confirmRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken });
        Assert.Equal(HttpStatusCode.OK, confirmRes.StatusCode);
        var confirmJson = await confirmRes.Content.ReadFromJsonAsync<JsonElement>();
        var expectedBonusCents = LaunchBonus.TotalCents(0, 2, 5);
        Assert.Equal(expectedBonusCents, confirmJson.GetProperty("totalCents").GetInt32());

        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
        var hh = await db.Households.AsNoTracking().FirstAsync(h => h.Id == hhId);
        var bin = await db.Bins.AsNoTracking().FirstAsync(b => b.HouseholdId == hhId);
        Assert.Equal(expectedBonusCents, hh.PendingValueCents);
        Assert.Equal(expectedBonusCents, bin.PendingValueCents);
    }
}
