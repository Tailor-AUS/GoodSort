using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Tests;

public class WaitlistDensityEfTests
{
    [Fact]
    public async Task LoadRows_then_aggregate_unlocks_at_suburb_volume()
    {
        await using var db = NewDb();
        for (var i = 0; i < 10; i++)
            db.Households.Add(House("MOOROOKA", 5, containers: 100));
        db.Households.Add(House("BRISBANE", 5, containers: 500));
        db.Households.Add(House("MOOROOKA", 5, containers: 500, type: "unit_complex"));
        await db.SaveChangesAsync();

        var board = WaitlistDensity.Aggregate(await WaitlistDensity.LoadRowsAsync(db));
        var suburb = Assert.Single(board.Suburbs);
        Assert.Equal("MOOROOKA", suburb.Suburb);
        Assert.True(suburb.Live);
        Assert.Equal(1000, suburb.Containers);
        Assert.Equal(10, board.TotalHouseholds);
    }

    [Fact]
    public async Task LoadRows_does_not_unlock_volume_split_across_suburbs()
    {
        await using var db = NewDb();
        for (var i = 0; i < 5; i++) db.Households.Add(House("MOOROOKA", 5, containers: 100));
        for (var i = 0; i < 5; i++) db.Households.Add(House("ANNERLEY", 1, containers: 100));
        await db.SaveChangesAsync();

        var board = WaitlistDensity.Aggregate(await WaitlistDensity.LoadRowsAsync(db));
        Assert.Equal(1000, board.TotalContainers);
        Assert.All(board.Suburbs, s => Assert.False(s.Live));
    }

    [Fact]
    public async Task Collecting_suburb_stays_live_after_settle_zeroes_containers()
    {
        // A run settled: PendingContainers is the credit ledger and was drained
        // to 0. The suburb is still an active collection route.
        await using var db = NewDb();
        for (var i = 0; i < 10; i++)
            db.Households.Add(House("MOOROOKA", 5, containers: 0, status: BinStatuses.Collecting));
        await db.SaveChangesAsync();

        var board = WaitlistDensity.Aggregate(await WaitlistDensity.LoadRowsAsync(db));
        var suburb = Assert.Single(board.Suburbs);
        Assert.True(suburb.Live, "a collecting suburb must not fall back to the waitlist board");
        Assert.Equal(0, suburb.Needed);
        Assert.True(suburb.Committed);
    }

    [Fact]
    public async Task Allocated_suburb_is_committed_and_never_re_announces()
    {
        await using var db = NewDb();
        db.Households.Add(House("MOOROOKA", 5, containers: 0, status: BinStatuses.Allocated));
        await db.SaveChangesAsync();

        var board = WaitlistDensity.Aggregate(await WaitlistDensity.LoadRowsAsync(db));
        var suburb = Assert.Single(board.Suburbs);
        Assert.True(suburb.Committed);
        // Even back over the threshold, ops must not be told to buy bins again.
        Assert.False(WaitlistDensity.ShouldAnnounceUnlock(suburb.Committed, 1200, 300));
    }

    [Fact]
    public async Task Waitlisted_suburb_under_threshold_is_not_live()
    {
        await using var db = NewDb();
        db.Households.Add(House("MOOROOKA", 5, containers: 300));
        await db.SaveChangesAsync();

        var board = WaitlistDensity.Aggregate(await WaitlistDensity.LoadRowsAsync(db));
        var suburb = Assert.Single(board.Suburbs);
        Assert.False(suburb.Live);
        Assert.False(suburb.Committed);
        Assert.Equal(700, suburb.Needed);
    }

    private static GoodSortDbContext NewDb()
    {
        var options = new DbContextOptionsBuilder<GoodSortDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new GoodSortDbContext(options);
    }

    private static Household House(string suburb, int day, int containers = 0, string type = "residential", string status = BinStatuses.Waitlisted) => new()
    {
        Name = $"{suburb} {day}",
        Address = "12 Beaudesert Road, Moorooka QLD 4105",
        Suburb = suburb,
        Type = type,
        CouncilCollectionDay = day,
        PendingContainers = containers,
        Lat = -27.527,
        Lng = 153.026,
        BinStatus = status,
    };
}
