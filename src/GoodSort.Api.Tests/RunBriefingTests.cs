using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Tests;

/// <summary>
/// A runner gets tomorrow's briefing once, not every night until they act.
///
/// NotifyRunners selected every claimed run with no date bound, stamped no
/// marker, and never called SaveChanges. The household half of the same pass
/// did all three correctly against Household.LastPickupAt, so the two halves of
/// one method disagreed about whether idempotency mattered.
///
/// Nothing capped the repeat. A Run has ExpiresAt for the unclaimed window, but
/// once claimed there is no expiry and no reclaim — "claimed and abandoned" is
/// a state a row sits in forever, and the runner gets an email about it every
/// night forever. That reaches a real person's inbox, which is what makes it
/// worse than a wasted query.
///
/// These assert on RunBriefing's own expressions, which the service runs, so
/// the test cannot drift from the rule the way a re-typed predicate would.
/// </summary>
public class RunBriefingTests
{
    private static GoodSortDbContext NewDb() =>
        new(new DbContextOptionsBuilder<GoodSortDbContext>()
            .UseInMemoryDatabase($"briefing-{Guid.NewGuid():N}")
            .Options);

    private static Run Claimed(DateTime? lastBriefed) => new()
    {
        Status = "claimed",
        RunnerId = Guid.NewGuid(),
        DropPointId = Guid.NewGuid(),
        LastBriefedAt = lastBriefed,
    };

    [Fact]
    public async Task A_run_never_briefed_is_due()
    {
        await using var db = NewDb();
        var today = new DateTime(2026, 9, 2);
        db.Runs.Add(Claimed(lastBriefed: null));
        await db.SaveChangesAsync();

        Assert.Equal(1, await db.Runs.CountAsync(RunBriefing.Due(today)));
    }

    [Fact]
    public async Task A_run_already_briefed_today_is_not_due_again()
    {
        // The bug, stated directly.
        await using var db = NewDb();
        var today = new DateTime(2026, 9, 2);
        db.Runs.Add(Claimed(lastBriefed: today));
        await db.SaveChangesAsync();

        Assert.Equal(0, await db.Runs.CountAsync(RunBriefing.Due(today)));
    }

    [Fact]
    public async Task The_same_run_is_due_again_tomorrow()
    {
        // Idempotent per day, not permanently silenced — a run still claimed
        // tomorrow should still get tomorrow's briefing.
        await using var db = NewDb();
        var today = new DateTime(2026, 9, 2);
        db.Runs.Add(Claimed(lastBriefed: today));
        await db.SaveChangesAsync();

        Assert.Equal(1, await db.Runs.CountAsync(RunBriefing.Due(today.AddDays(1))));
    }

    [Fact]
    public async Task An_abandoned_run_is_briefed_once_per_day_not_once_per_pass()
    {
        // What the old code did: run the selection repeatedly within one day.
        // Before the fix this returned the run every time.
        await using var db = NewDb();
        var today = new DateTime(2026, 9, 2);
        db.Runs.Add(Claimed(lastBriefed: null));
        await db.SaveChangesAsync();

        var sentToday = 0;
        for (var pass = 0; pass < 5; pass++)
        {
            var due = await db.Runs.Where(RunBriefing.Due(today)).ToListAsync();
            foreach (var run in due) { run.LastBriefedAt = today; sentToday++; }
            await db.SaveChangesAsync();
        }

        Assert.Equal(1, sentToday);
    }

    [Fact]
    public async Task Unclaimed_and_unassigned_runs_are_never_briefed()
    {
        await using var db = NewDb();
        var today = new DateTime(2026, 9, 2);

        db.Runs.Add(new Run { Status = "available", RunnerId = null, DropPointId = Guid.NewGuid() });
        db.Runs.Add(new Run { Status = "settled", RunnerId = Guid.NewGuid(), DropPointId = Guid.NewGuid() });
        // Claimed but somehow unassigned — no one to email.
        db.Runs.Add(new Run { Status = "claimed", RunnerId = null, DropPointId = Guid.NewGuid() });
        await db.SaveChangesAsync();

        Assert.Equal(0, await db.Runs.CountAsync(RunBriefing.Due(today)));
    }

    [Fact]
    public async Task The_manual_trigger_still_reaches_an_already_briefed_run()
    {
        // TriggerNow is the "send it again now" control. It must not inherit the
        // daily guard, or ops loses the ability to re-send.
        await using var db = NewDb();
        var today = new DateTime(2026, 9, 2);
        db.Runs.Add(Claimed(lastBriefed: today));
        await db.SaveChangesAsync();

        Assert.Equal(0, await db.Runs.CountAsync(RunBriefing.Due(today)));
        Assert.Equal(1, await db.Runs.CountAsync(RunBriefing.All()));
    }
}
