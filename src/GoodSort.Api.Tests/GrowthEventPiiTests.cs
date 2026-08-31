using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Tests;

/// <summary>
/// The funnel answers "how many people reached this step", never "who". Every
/// identifier it must not carry sits one localStorage read away at the call
/// sites — profile id, household id, email, address — so keeping them out is an
/// active choice that needs a test, not a convention that needs remembering.
///
/// The load-bearing detail: the client sends `location.pathname`, not `href`.
/// Referral links are `?r={profileGuid}`, so switching to `href` would leak a
/// user identifier into every event on a referral landing.
/// </summary>
public class GrowthEventPiiTests
{
    static GoodSortDbContext NewDb() =>
        new(new DbContextOptionsBuilder<GoodSortDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    [Fact]
    public void The_row_has_no_field_capable_of_identifying_a_person()
    {
        // If someone adds UserId/ProfileId/Email to this entity, this fails.
        var fields = typeof(GrowthEvent).GetProperties().Select(p => p.Name).ToArray();
        Assert.Equal(new[] { "Id", "Name", "Suburb", "Path", "CreatedAt" }.OrderBy(x => x), fields.OrderBy(x => x));

        foreach (var banned in new[] { "user", "profile", "email", "household", "lat", "lng", "barcode", "address" })
            Assert.DoesNotContain(fields, f => f.Contains(banned, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task A_stored_event_never_contains_a_guid()
    {
        // A referral landing is the realistic leak: ?r={profileGuid}.
        await using var db = NewDb();
        db.GrowthEvents.Add(new GrowthEvent
        {
            Name = "invite_landed",
            Suburb = BinDayService.CanonicalSuburb("Moorooka"),
            Path = "/brisbane/moorooka",
        });
        await db.SaveChangesAsync();

        var row = await db.GrowthEvents.SingleAsync();
        foreach (var value in new[] { row.Name, row.Suburb, row.Path })
            Assert.False(Guid.TryParse(value, out _));
        Assert.DoesNotContain("r=", row.Path);
        Assert.DoesNotContain("@", row.Path ?? "");
    }

    [Fact]
    public void City_wide_suburbs_are_coarsened_away_on_write()
    {
        // Canonicalisation happens on write now, not only on the log line.
        Assert.Null(BinDayService.CanonicalSuburb("Brisbane"));
        Assert.Null(BinDayService.CanonicalSuburb("Queensland"));
        Assert.Equal("MOOROOKA", BinDayService.CanonicalSuburb("Moorooka"));
    }
}
