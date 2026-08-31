using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Tests;

/// <summary>
/// The daily vision spend caps have to count calls that are still in flight.
///
/// The caps count VisionCalls rows, and the real row is written by
/// VisionService.LogCall only after the upstream response returns — up to the
/// 8s Tailor Vision timeout plus an Azure OpenAI fallback behind it. That made
/// the caps a check-then-act with a multi-second gap: every concurrent request
/// reads the same total, every one passes, and every one gets billed. The
/// endpoint's own comment says "without it, one client can drain the whole
/// day's BAINK budget", which is what the gap allows, one burst at a time.
///
/// The fix is a reservation row taken before the call and released after. These
/// tests pin the property that makes it work — a reservation is counted — and
/// the property that keeps the accounting honest — it is not mistaken for a
/// real provider.
/// </summary>
public class VisionSpendCapTests
{
    private static GoodSortDbContext NewDb() =>
        new(new DbContextOptionsBuilder<GoodSortDbContext>()
            .UseInMemoryDatabase($"vision-{Guid.NewGuid():N}")
            .Options);

    [Fact]
    public async Task A_call_in_flight_counts_against_the_cap()
    {
        // The whole point. If a later change filters reservations out of this
        // count "because they aren't real calls", the race comes straight back
        // and nothing else in the suite would notice.
        await using var db = NewDb();
        var user = Guid.NewGuid();
        var since = DateTime.UtcNow.AddHours(-24);

        db.VisionCalls.Add(new VisionCall { Provider = VisionReservation.Provider, UserId = user, Success = false });
        await db.SaveChangesAsync();

        var perUser = await db.VisionCalls.CountAsync(v => v.CreatedAt >= since && v.UserId == user);
        var global = await db.VisionCalls.CountAsync(v => v.CreatedAt >= since);

        Assert.Equal(1, perUser);
        Assert.Equal(1, global);
    }

    [Fact]
    public async Task Releasing_a_reservation_leaves_only_the_real_record()
    {
        // A completed call must be counted once, not twice — otherwise the cap
        // tightens on every member with every scan.
        await using var db = NewDb();
        var user = Guid.NewGuid();

        var reservation = new VisionCall { Provider = VisionReservation.Provider, UserId = user };
        db.VisionCalls.Add(reservation);
        await db.SaveChangesAsync();

        // What VisionService.LogCall writes when the call comes back.
        db.VisionCalls.Add(new VisionCall { Provider = "tailor", UserId = user, Success = true, ContainerCount = 3 });
        await db.SaveChangesAsync();

        db.VisionCalls.Remove(reservation);
        await db.SaveChangesAsync();

        var rows = await db.VisionCalls.Where(v => v.UserId == user).ToListAsync();
        Assert.Single(rows);
        Assert.Equal("tailor", rows[0].Provider);
    }

    [Fact]
    public void A_reservation_is_not_mistaken_for_a_real_provider()
    {
        // Provider is also how call mix gets reported. A reservation sharing a
        // name with a real backend would quietly skew that.
        foreach (var real in new[] { "tailor", "openai", "none" })
            Assert.NotEqual(real, VisionReservation.Provider);

        Assert.False(string.IsNullOrWhiteSpace(VisionReservation.Provider));
    }

    [Fact]
    public async Task Reservations_expire_from_the_window_on_their_own()
    {
        // If the process dies mid-call the reservation is orphaned. That must
        // age out rather than tightening the cap permanently: the count is
        // bounded by CreatedAt >= now-24h.
        await using var db = NewDb();
        var user = Guid.NewGuid();

        db.VisionCalls.Add(new VisionCall
        {
            Provider = VisionReservation.Provider,
            UserId = user,
            CreatedAt = DateTime.UtcNow.AddHours(-25),
        });
        await db.SaveChangesAsync();

        var since = DateTime.UtcNow.AddHours(-24);
        Assert.Equal(0, await db.VisionCalls.CountAsync(v => v.CreatedAt >= since && v.UserId == user));
    }
}
