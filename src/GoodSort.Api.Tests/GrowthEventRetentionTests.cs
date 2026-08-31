using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Tests;

/// <summary>
/// The table this was modelled on — VisionCalls — has been append-only since it
/// shipped and is never pruned. An events table grows far faster, so the sweep
/// ships with it.
/// </summary>
public class GrowthEventRetentionTests
{
    static GoodSortDbContext NewDb() =>
        new(new DbContextOptionsBuilder<GoodSortDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    static GrowthEvent Aged(int daysOld) => new()
    {
        Name = "scan_credited",
        CreatedAt = DateTime.UtcNow.AddDays(-daysOld),
    };

    [Fact]
    public async Task Events_past_the_window_are_removed_and_recent_ones_kept()
    {
        await using var db = NewDb();
        db.GrowthEvents.AddRange(
            Aged(GrowthEventRetention.RetentionDays + 5),
            Aged(GrowthEventRetention.RetentionDays + 1),
            Aged(1),
            Aged(0));
        await db.SaveChangesAsync();

        await GrowthEventRetention.SweepAsync(db);

        var left = await db.GrowthEvents.ToListAsync();
        Assert.Equal(2, left.Count);
        Assert.All(left, e => Assert.True(e.CreatedAt > DateTime.UtcNow.AddDays(-GrowthEventRetention.RetentionDays)));
    }

    [Fact]
    public async Task A_sweep_with_nothing_to_do_is_harmless()
    {
        await using var db = NewDb();
        db.GrowthEvents.Add(Aged(0));
        await db.SaveChangesAsync();

        await GrowthEventRetention.SweepAsync(db);

        Assert.Equal(1, await db.GrowthEvents.CountAsync());
    }

    [Fact]
    public void The_retention_window_is_bounded()
    {
        Assert.InRange(GrowthEventRetention.RetentionDays, 30, 365);
    }
}
