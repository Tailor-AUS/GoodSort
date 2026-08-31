using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Tests;

/// <summary>
/// Prod carries at least one legacy household with no suburb and no recycling
/// day, created before join validation existed. A returning member is linked
/// straight back to it on login, so they look signed up while being invisible
/// to the demand board and uncollectable.
///
/// Observed 2026-08-31 on the first real production signup: the profile
/// returned householdId set, yet /api/growth/brisbane still reported
/// totalHouseholds 0. These lock in that the recovery path — completing the
/// existing household rather than creating a second one — actually works.
/// </summary>
public class LegacyHouseholdRecoveryTests
{
    static GoodSortDbContext NewDb() =>
        new(new DbContextOptionsBuilder<GoodSortDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    static Household Legacy() => new()
    {
        Name = "Legacy",
        Address = "",
        Suburb = null,               // the two fields that make it invisible
        CouncilCollectionDay = null,
        Type = "residential",
        BinStatus = BinStatuses.Waitlisted,
    };

    [Fact]
    public async Task A_legacy_household_is_invisible_to_the_demand_board()
    {
        await using var db = NewDb();
        db.Households.Add(Legacy());
        await db.SaveChangesAsync();

        var board = WaitlistDensity.Aggregate(await WaitlistDensity.LoadRowsAsync(db));

        // Signed up, but counts for nothing — this is the trap.
        Assert.Empty(board.Suburbs);
        Assert.Equal(0, board.TotalHouseholds);
    }

    [Fact]
    public async Task Completing_it_in_place_makes_the_member_count()
    {
        await using var db = NewDb();
        var hh = Legacy();
        db.Households.Add(hh);
        await db.SaveChangesAsync();

        // What PATCH /api/households/{id}/street does.
        hh.Suburb = BinDayService.CanonicalSuburb("Moorooka");
        hh.CouncilCollectionDay = 5;
        await db.SaveChangesAsync();

        var board = WaitlistDensity.Aggregate(await WaitlistDensity.LoadRowsAsync(db));
        var suburb = Assert.Single(board.Suburbs);
        Assert.Equal("MOOROOKA", suburb.Suburb);
        Assert.Equal(1, suburb.Households);
        Assert.Equal(1, board.TotalHouseholds);
    }

    [Fact]
    public async Task Recovery_must_not_leave_a_duplicate_household_behind()
    {
        // The failure we must never ship: completing onboarding creates a
        // SECOND household, so the member is counted twice and one of them can
        // never be collected from.
        await using var db = NewDb();
        var hh = Legacy();
        db.Households.Add(hh);
        await db.SaveChangesAsync();

        hh.Suburb = "MOOROOKA";
        hh.CouncilCollectionDay = 5;
        await db.SaveChangesAsync();

        Assert.Equal(1, await db.Households.CountAsync());
        Assert.Equal(1, WaitlistDensity.Aggregate(await WaitlistDensity.LoadRowsAsync(db)).TotalHouseholds);
    }

    [Fact]
    public async Task A_city_wide_suburb_does_not_rescue_it()
    {
        // "BRISBANE" is not a collectable cluster; completing with it leaves
        // the member just as invisible, which would be a confusing near-miss.
        await using var db = NewDb();
        var hh = Legacy();
        db.Households.Add(hh);
        await db.SaveChangesAsync();

        hh.Suburb = BinDayService.CanonicalSuburb("Brisbane");   // null
        hh.CouncilCollectionDay = 5;
        await db.SaveChangesAsync();

        Assert.Empty(WaitlistDensity.Aggregate(await WaitlistDensity.LoadRowsAsync(db)).Suburbs);
    }
}
