using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

public class KerbsideNightTests
{
    [Fact]
    public void Thursday_evening_brisbane_is_friday_council_night()
    {
        // Thursday 18:00 AEST = Thursday 08:00 UTC
        var utc = new DateTime(2026, 8, 27, 8, 0, 0, DateTimeKind.Utc);
        Assert.Equal((int)DayOfWeek.Friday, KerbsideNight.TomorrowCouncilDay(utc));
        Assert.True(KerbsideNight.IsTonightFor(5, utc));
        Assert.False(KerbsideNight.IsTonightFor(1, utc));
    }

    [Fact]
    public void Next_runner_date_helper_still_computes_night_before_council()
    {
        var thursdayEveningUtc = new DateTime(2026, 8, 27, 8, 0, 0, DateTimeKind.Utc);
        Assert.Equal(new DateTime(2026, 8, 27), KerbsideNight.NextRunnerLocalDate(5, thursdayEveningUtc));
        var fridayMorningUtc = new DateTime(2026, 8, 28, 0, 0, 0, DateTimeKind.Utc);
        Assert.Equal(new DateTime(2026, 9, 3), KerbsideNight.NextRunnerLocalDate(5, fridayMorningUtc));
        Assert.Null(KerbsideNight.NextRunnerLocalDate(null, thursdayEveningUtc));
    }

    [Fact]
    public void Waitlisted_houses_never_join_a_run_serviceable_do()
    {
        var utc = new DateTime(2026, 8, 27, 8, 0, 0, DateTimeKind.Utc);
        Assert.False(KerbsideNight.HouseholdBinIsOnTonightRun(BinStatuses.Waitlisted, true, 5, utc));
        Assert.True(KerbsideNight.HouseholdBinIsOnTonightRun(BinStatuses.Collecting, false, 5, utc));
        Assert.True(KerbsideNight.HouseholdBinIsOnTonightRun(BinStatuses.Delivered, true, 1, utc));
        // Council day is not the gate — any serviceable house is eligible
        Assert.True(KerbsideNight.HouseholdBinIsOnTonightRun(BinStatuses.Collecting, false, 1, utc));
        Assert.True(KerbsideNight.HouseholdBinIsReady(BinStatuses.Collecting, false, 8));
        Assert.False(KerbsideNight.HouseholdBinIsReady(BinStatuses.Collecting, false, 0));
        Assert.True(KerbsideNight.HouseholdBinIsReady(BinStatuses.Collecting, true, 0));
    }

    [Fact]
    public void Runs_are_suburb_only_never_city_wide()
    {
        var rows = new (string Suburb, int Day, string Id)[]
        {
            ("MOOROOKA", 5, "a"),
            ("Moorooka", 5, "b"),
            ("ANNERLEY", 5, "c"),
            ("MOOROOKA", 1, "d"),
            ("BRISBANE", 5, "e"),
        };
        var groups = RunCluster.GroupByStreet(rows, r => r.Suburb, r => r.Day);
        Assert.Equal(2, groups.Count);
        Assert.Equal(3, groups.Single(g => g.Any(x => x.Id == "a")).Count);
        Assert.DoesNotContain(groups, g => g.Any(x => x.Id == "e"));
        Assert.Equal("Moorooka", RunCluster.AreaName("MOOROOKA", 5));
        Assert.Null(RunCluster.Key("BRISBANE", 5));
    }
}
