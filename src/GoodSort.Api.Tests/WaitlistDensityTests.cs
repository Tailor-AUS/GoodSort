using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

public class WaitlistDensityTests
{
    private static readonly CollectionReadinessConfig Configured1000 =
        new(Configured: true, AluminiumThreshold: 1000, Source: "operator_config", FixtureLabel: null);

    [Fact]
    public void Unconfigured_readiness_never_unlocks_even_with_thousand_containers()
    {
        var board = WaitlistDensity.Aggregate(SuburbVolume("MOOROOKA", households: 10, containersEach: 100));
        var suburb = Assert.Single(board.Suburbs);
        Assert.False(suburb.Live);
        Assert.Equal(0, suburb.Needed);
        Assert.Equal(1000, suburb.Containers);
        Assert.Equal(1000, suburb.AluminiumContainers);
        Assert.Equal(0, board.LiveThreshold);
        Assert.False(WaitlistDensity.ShouldAnnounceUnlock(suburb.Committed, suburb.AluminiumContainers, 100));
    }

    [Fact]
    public void Below_threshold_does_not_unlock()
    {
        var rows = SuburbVolume("MOOROOKA", households: 5, containersEach: 100);
        var board = WaitlistDensity.Aggregate(rows, readinessConfig: Configured1000);
        var suburb = Assert.Single(board.Suburbs);
        Assert.False(suburb.Live);
        Assert.Equal(500, suburb.Containers);
        Assert.Equal(500, suburb.Needed);
        Assert.Equal(5, suburb.Households);
        Assert.Equal(500, board.TotalContainers);
    }

    [Fact]
    public void Thousand_containers_in_one_suburb_unlocks_when_configured()
    {
        var board = WaitlistDensity.Aggregate(SuburbVolume("MOOROOKA", households: 10, containersEach: 100), readinessConfig: Configured1000);
        var suburb = Assert.Single(board.Suburbs);
        Assert.True(suburb.Live);
        Assert.Equal(0, suburb.Needed);
        Assert.Equal(1000, suburb.Containers);
        Assert.Equal(1000, board.LiveThreshold);
    }

    [Fact]
    public void Volume_split_across_suburbs_does_not_unlock()
    {
        var rows = SuburbVolume("MOOROOKA", 5, 100)
            .Concat(SuburbVolume("ANNERLEY", 5, 100));
        var board = WaitlistDensity.Aggregate(rows, readinessConfig: Configured1000);
        Assert.Equal(1000, board.TotalContainers);
        Assert.All(board.Suburbs, s => Assert.False(s.Live));
    }

    [Fact]
    public void City_wide_labels_never_unlock()
    {
        var rows = SuburbVolume("MOOROOKA", 4, 200)
            .Concat(SuburbVolume("ANNERLEY", 4, 200))
            .Concat(SuburbVolume("WEST END", 4, 200));
        var board = WaitlistDensity.Aggregate(rows, readinessConfig: Configured1000);
        Assert.Equal(2400, board.TotalContainers);
        Assert.All(board.Suburbs, s => Assert.False(s.Live));
        Assert.DoesNotContain(board.Suburbs, s => s.Suburb == "BRISBANE");
    }

    [Fact]
    public void Brisbane_label_and_units_are_excluded()
    {
        var rows = new[]
        {
            new HouseholdClusterRow("BRISBANE", 5, PendingContainers: 500, AluminiumContainers: 500),
            new HouseholdClusterRow("Queensland", 5, PendingContainers: 500, AluminiumContainers: 500),
            new HouseholdClusterRow("MOOROOKA", 5, "unit_complex", 500, AluminiumContainers: 500),
            new HouseholdClusterRow("MOOROOKA", 5, PendingContainers: 50, AluminiumContainers: 50),
        };
        var board = WaitlistDensity.Aggregate(rows, readinessConfig: Configured1000);
        Assert.Equal(1, board.TotalHouseholds);
        var suburb = Assert.Single(board.Suburbs);
        Assert.Equal("MOOROOKA", suburb.Suburb);
        Assert.Equal(50, suburb.Containers);
        Assert.False(suburb.Live);
    }

    [Fact]
    public void Day_cluster_exposes_suburb_volume()
    {
        var board = WaitlistDensity.Aggregate(SuburbVolume("Moorooka", 10, 100), readinessConfig: Configured1000);
        var cluster = WaitlistDensity.DayCluster(board, "moorooka", 5);
        Assert.NotNull(cluster);
        Assert.Equal(1000, cluster!.Containers);
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
        Assert.False(WaitlistDensity.CanPurchase(1000));
        Assert.True(WaitlistDensity.CanPurchase(1000, Configured1000));
        Assert.False(WaitlistDensity.CanPurchase(999, Configured1000));
    }

    [Fact]
    public void Mixed_case_suburb_names_are_one_cluster()
    {
        var rows = new[]
        {
            new HouseholdClusterRow("Moorooka", 5, PendingContainers: 400, AluminiumContainers: 400),
            new HouseholdClusterRow("MOOROOKA", 5, PendingContainers: 400, AluminiumContainers: 400),
            new HouseholdClusterRow("moorooka", 5, PendingContainers: 200, AluminiumContainers: 200),
        };
        var suburb = Assert.Single(WaitlistDensity.Aggregate(rows, readinessConfig: Configured1000).Suburbs);
        Assert.Equal("MOOROOKA", suburb.Suburb);
        Assert.Equal(3, suburb.Households);
        Assert.Equal(1000, suburb.Containers);
        Assert.True(suburb.Live);
    }

    [Fact]
    public void Unlock_announces_when_volume_is_split_across_recycling_days()
    {
        // The pivot unlocks on SUBURB aluminium volume when configured.
        var rows = new[]
        {
            new HouseholdClusterRow("MOOROOKA", 5, PendingContainers: 600, AluminiumContainers: 600),
            new HouseholdClusterRow("MOOROOKA", 1, PendingContainers: 400, AluminiumContainers: 400),
        };
        var suburb = Assert.Single(WaitlistDensity.Aggregate(rows, readinessConfig: Configured1000).Suburbs);
        Assert.True(suburb.Live);
        Assert.All(suburb.ByDay, d => Assert.True(d.Containers < 1000));

        // The 400-container household tipped it over.
        Assert.True(WaitlistDensity.ShouldAnnounceUnlock(suburb.Committed, suburb.AluminiumContainers, 400, Configured1000));
    }

    [Fact]
    public void Unlock_does_not_announce_below_threshold()
    {
        Assert.False(WaitlistDensity.ShouldAnnounceUnlock(false, 999, 400, Configured1000));
    }

    [Fact]
    public void Unlock_does_not_announce_when_household_did_not_cross_it()
    {
        // Suburb was already over 1000 without this household's 10 containers.
        Assert.False(WaitlistDensity.ShouldAnnounceUnlock(false, 1500, 10, Configured1000));
    }

    [Fact]
    public void Unlock_never_announces_twice_once_bins_are_committed()
    {
        Assert.False(WaitlistDensity.ShouldAnnounceUnlock(true, 1200, 400, Configured1000));
    }

    private static IEnumerable<HouseholdClusterRow> SuburbVolume(string suburb, int households, int containersEach) =>
        Enumerable.Range(0, households).Select(_ => new HouseholdClusterRow(suburb, 5, PendingContainers: containersEach, AluminiumContainers: containersEach));
}
