using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Tests;

public class WaitlistDensityEfTests
{
    [Fact]
    public async Task LoadRows_then_aggregate_unlocks_twelve_friday_moorooka()
    {
        await using var db = NewDb();
        for (var i = 0; i < 12; i++)
            db.Households.Add(House("MOOROOKA", 5));
        db.Households.Add(House("BRISBANE", 5));
        db.Households.Add(House("MOOROOKA", 5, "unit_complex"));
        await db.SaveChangesAsync();

        var board = WaitlistDensity.Aggregate(await WaitlistDensity.LoadRowsAsync(db));
        var suburb = Assert.Single(board.Suburbs);
        Assert.Equal("MOOROOKA", suburb.Suburb);
        Assert.True(suburb.Live);
        Assert.Equal(12, board.TotalHouseholds);
    }

    [Fact]
    public async Task LoadRows_does_not_unlock_twelve_split_days()
    {
        await using var db = NewDb();
        for (var i = 0; i < 6; i++) db.Households.Add(House("MOOROOKA", 5));
        for (var i = 0; i < 6; i++) db.Households.Add(House("MOOROOKA", 1));
        await db.SaveChangesAsync();

        var suburb = Assert.Single(WaitlistDensity.Aggregate(await WaitlistDensity.LoadRowsAsync(db)).Suburbs);
        Assert.False(suburb.Live);
        Assert.Equal(6, suburb.Needed);
    }

    private static GoodSortDbContext NewDb()
    {
        var options = new DbContextOptionsBuilder<GoodSortDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new GoodSortDbContext(options);
    }

    private static Household House(string suburb, int day, string type = "residential") => new()
    {
        Name = $"{suburb} {day}",
        Address = "12 Beaudesert Road, Moorooka QLD 4105",
        Suburb = suburb,
        Type = type,
        CouncilCollectionDay = day,
        Lat = -27.527,
        Lng = 153.026,
        BinStatus = BinStatuses.Waitlisted,
    };
}
