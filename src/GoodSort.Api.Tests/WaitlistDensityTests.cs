using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

public class WaitlistDensityTests
{
    [Fact]
    public void Eleven_on_one_day_does_not_unlock()
    {
        var rows = Friday("MOOROOKA", 11);
        var board = WaitlistDensity.Aggregate(rows);
        var suburb = Assert.Single(board.Suburbs);
        Assert.False(suburb.Live);
        Assert.Equal(1, suburb.Needed);
        Assert.Equal(11, suburb.Households);
        Assert.Equal(11, board.TotalHouseholds);
    }

    [Fact]
    public void Twelve_on_the_same_day_unlocks()
    {
        var board = WaitlistDensity.Aggregate(Friday("MOOROOKA", 12));
        var suburb = Assert.Single(board.Suburbs);
        Assert.True(suburb.Live);
        Assert.Equal(0, suburb.Needed);
        Assert.Equal(5, suburb.BestDay);
        Assert.Equal("Friday", suburb.BestDayName);
    }

    [Fact]
    public void Twelve_split_across_days_does_not_unlock()
    {
        var rows = Friday("MOOROOKA", 6).Concat(Day("MOOROOKA", 1, 6));
        var suburb = Assert.Single(WaitlistDensity.Aggregate(rows).Suburbs);
        Assert.False(suburb.Live);
        Assert.Equal(6, suburb.Needed);
        Assert.Equal(12, suburb.Households);
    }

    [Fact]
    public void City_wide_twelve_never_unlocks()
    {
        var rows = Friday("MOOROOKA", 4)
            .Concat(Friday("ANNERLEY", 4))
            .Concat(Friday("WEST END", 4));
        var board = WaitlistDensity.Aggregate(rows);
        Assert.Equal(12, board.TotalHouseholds);
        Assert.All(board.Suburbs, s => Assert.False(s.Live));
        Assert.DoesNotContain(board.Suburbs, s => s.Suburb == "BRISBANE");
    }

    [Fact]
    public void Brisbane_label_and_units_are_excluded()
    {
        var rows = new[]
        {
            new HouseholdClusterRow("BRISBANE", 5),
            new HouseholdClusterRow("Queensland", 5),
            new HouseholdClusterRow("MOOROOKA", 5, "unit_complex"),
            new HouseholdClusterRow("MOOROOKA", 5),
        };
        var board = WaitlistDensity.Aggregate(rows);
        Assert.Equal(1, board.TotalHouseholds);
        var suburb = Assert.Single(board.Suburbs);
        Assert.Equal("MOOROOKA", suburb.Suburb);
        Assert.Equal(1, suburb.Households);
        Assert.False(suburb.Live);
    }

    [Fact]
    public void Day_cluster_matches_join_email_count()
    {
        var board = WaitlistDensity.Aggregate(Friday("Moorooka", 12));
        var cluster = WaitlistDensity.DayCluster(board, "moorooka", 5);
        Assert.NotNull(cluster);
        Assert.Equal(12, cluster!.Households);
        Assert.True(cluster.Live);
        Assert.Equal(0, cluster.Needed);
    }

    [Fact]
    public void Admin_never_allocates_city_wide_or_unknown()
    {
        Assert.Equal("MOOROOKA", WaitlistDensity.AdminGroupKey("Moorooka"));
        Assert.Equal("UNKNOWN", WaitlistDensity.AdminGroupKey("BRISBANE"));
        Assert.Equal("UNKNOWN", WaitlistDensity.AdminGroupKey(null));
        Assert.True(WaitlistDensity.CanAllocateSuburb("Moorooka"));
        Assert.False(WaitlistDensity.CanAllocateSuburb("BRISBANE"));
        Assert.False(WaitlistDensity.CanAllocateSuburb("UNKNOWN"));
        Assert.False(WaitlistDensity.CanAllocateSuburb(null));
    }

    [Fact]
    public void Mixed_case_suburb_names_are_one_cluster()
    {
        var rows = new[]
        {
            new HouseholdClusterRow("Moorooka", 5),
            new HouseholdClusterRow("MOOROOKA", 5),
            new HouseholdClusterRow("moorooka", 5),
        };
        var suburb = Assert.Single(WaitlistDensity.Aggregate(rows).Suburbs);
        Assert.Equal("MOOROOKA", suburb.Suburb);
        Assert.Equal(3, suburb.Households);
    }

    private static IEnumerable<HouseholdClusterRow> Friday(string suburb, int n) => Day(suburb, 5, n);

    private static IEnumerable<HouseholdClusterRow> Day(string suburb, int day, int n) =>
        Enumerable.Range(0, n).Select(_ => new HouseholdClusterRow(suburb, day));
}
