using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Tests;

public class StreetLifecycleTests
{
    [Fact]
    public async Task Suburb_volume_unlocks_then_collecting_joins_run()
    {
        await using var db = NewDb();
        for (var i = 0; i < 10; i++)
            db.Households.Add(House("MOOROOKA", 5, containers: 100));
        await db.SaveChangesAsync();

        var board = WaitlistDensity.Aggregate(await WaitlistDensity.LoadRowsAsync(db));
        Assert.True(Assert.Single(board.Suburbs).Live);
        Assert.False(WaitlistDensity.CanAllocateSuburb("BRISBANE"));
        Assert.True(WaitlistDensity.CanAllocateSuburb("MOOROOKA"));
        Assert.True(WaitlistDensity.CanPurchase(1000));

        foreach (var h in db.Households)
            h.BinStatus = BinStatuses.Collecting;
        await db.SaveChangesAsync();

        var anyUtc = new DateTime(2026, 8, 27, 8, 0, 0, DateTimeKind.Utc);
        Assert.All(db.Households, h =>
            Assert.True(KerbsideNight.HouseholdBinIsOnTonightRun(h.BinStatus, h.BinIsOut, h.CouncilCollectionDay, anyUtc)));

        var owner = new Profile { Name = "Owner" };
        var credit = HouseholdCredit.ApplyPickup([owner], [], 40);
        Assert.Equal(200, credit);
        Assert.Equal(200, owner.ClearedCents);
        Assert.False(CashoutService.PayoutsAreOpen(null, "062-000", "12345678", "301500"));
        Assert.DoesNotContain("yellow", HouseholdCredit.PickupInstruction(null), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Split_suburbs_never_share_a_run_or_unlock()
    {
        await using var db = NewDb();
        for (var i = 0; i < 10; i++)
            db.Households.Add(House(i < 5 ? "MOOROOKA" : "ANNERLEY", i < 5 ? 5 : 1, containers: 100));
        await db.SaveChangesAsync();

        var board = WaitlistDensity.Aggregate(await WaitlistDensity.LoadRowsAsync(db));
        Assert.All(board.Suburbs, s => Assert.False(s.Live));

        var groups = RunCluster.GroupByStreet(db.Households, h => h.Suburb, h => h.CouncilCollectionDay);
        Assert.Equal(2, groups.Count);
        Assert.All(groups, g => Assert.Equal(5, g.Count));
    }

    private static GoodSortDbContext NewDb()
    {
        var options = new DbContextOptionsBuilder<GoodSortDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new GoodSortDbContext(options);
    }

    private static Household House(string suburb, int day, int containers = 0) => new()
    {
        Name = $"{suburb} {day}",
        Address = "12 Beaudesert Road, Moorooka QLD 4105",
        Suburb = suburb,
        Type = "residential",
        CouncilCollectionDay = day,
        PendingContainers = containers,
        Lat = -27.527,
        Lng = 153.026,
        BinStatus = BinStatuses.Waitlisted,
    };
}
