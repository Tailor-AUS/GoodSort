using GoodSort.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Services;

/// <summary>
/// Claims a one-way status transition, so only one caller can perform the work
/// that follows it.
///
/// Settlement is guarded by a status check — a route must be "at_depot", a run
/// must be "completed" — and then the handler sets the status to "settled" and
/// credits money. Read, compare, write. Two requests arriving together both
/// read the old status, both pass the check, and both credit: the runner's
/// ClearedCents is incremented twice, and every picked-up stop moves its
/// household's pending credit to cleared twice. Unlike an over-payment, that
/// invents cash-out-eligible money that was never scanned.
///
/// A double-tap on a "Settle" button is enough to send two requests, so this is
/// not a theoretical concurrency puzzle.
///
/// The fix is to let the database decide who goes first: the status test lives
/// in the WHERE clause of the same statement that performs the transition, so
/// the second caller updates no rows and is turned away.
/// </summary>
public static class StatusClaim
{
    /// <summary>
    /// Moves a collection route from <paramref name="from"/> to
    /// <paramref name="to"/>. False means it was no longer in
    /// <paramref name="from"/> — someone else already claimed it.
    /// </summary>
    public static async Task<bool> TryClaimRoute(GoodSortDbContext db, Guid id, string from, string to)
    {
        var settledAt = DateTime.UtcNow;
        try
        {
            var rows = await db.Routes
                .Where(r => r.Id == id && r.Status == from)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(r => r.Status, to)
                    .SetProperty(r => r.SettledAt, settledAt));
            return rows > 0;
        }
        catch (InvalidOperationException)
        {
            return await FallbackClaim(db, async () =>
            {
                var route = await db.Routes.FirstOrDefaultAsync(r => r.Id == id && r.Status == from);
                if (route is null) return false;
                route.Status = to;
                route.SettledAt = settledAt;
                return true;
            });
        }
    }

    /// <summary>As above, for a marketplace run.</summary>
    public static async Task<bool> TryClaimRun(GoodSortDbContext db, Guid id, string from, string to)
    {
        var settledAt = DateTime.UtcNow;
        try
        {
            var rows = await db.Runs
                .Where(r => r.Id == id && r.Status == from)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(r => r.Status, to)
                    .SetProperty(r => r.SettledAt, settledAt));
            return rows > 0;
        }
        catch (InvalidOperationException)
        {
            return await FallbackClaim(db, async () =>
            {
                var run = await db.Runs.FirstOrDefaultAsync(r => r.Id == id && r.Status == from);
                if (run is null) return false;
                run.Status = to;
                run.SettledAt = settledAt;
                return true;
            });
        }
    }

    /// <summary>
    /// Atomically assigns an unclaimed, non-expired marketplace run to one runner,
    /// preventing two concurrent taps from dispatching two runners to the same kerbs.
    /// </summary>
    public static async Task<bool> TryAssignRunnerToRun(
        GoodSortDbContext db,
        Guid runId,
        Guid runnerId,
        int perContainerCents,
        int estimatedPayoutCents,
        int pricingTier)
    {
        var claimedAt = DateTime.UtcNow;
        try
        {
            var rows = await db.Runs
                .Where(r => r.Id == runId
                         && (r.Status == "available" || r.Status == "below_threshold")
                         && r.ExpiresAt > claimedAt)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(r => r.Status, "claimed")
                    .SetProperty(r => r.RunnerId, runnerId)
                    .SetProperty(r => r.ClaimedAt, claimedAt)
                    .SetProperty(r => r.PerContainerCents, perContainerCents)
                    .SetProperty(r => r.EstimatedPayoutCents, estimatedPayoutCents)
                    .SetProperty(r => r.PricingTier, pricingTier));
            return rows > 0;
        }
        catch (InvalidOperationException)
        {
            return await FallbackClaim(db, async () =>
            {
                var run = await db.Runs.FirstOrDefaultAsync(r =>
                    r.Id == runId
                    && (r.Status == "available" || r.Status == "below_threshold")
                    && r.ExpiresAt > claimedAt);
                if (run is null) return false;
                run.Status = "claimed";
                run.RunnerId = runnerId;
                run.ClaimedAt = claimedAt;
                run.PerContainerCents = perContainerCents;
                run.EstimatedPayoutCents = estimatedPayoutCents;
                run.PricingTier = pricingTier;
                return true;
            });
        }
    }

    /// <summary>
    /// The InMemory provider used by tests and local dev cannot translate
    /// ExecuteUpdate. Production atomicity across replicas comes from the single
    /// SQL Server UPDATE above; FallbackGate serialises in-process InMemory callers
    /// so local dev and integration tests observe the same single-winner contract.
    /// </summary>
    private static readonly SemaphoreSlim FallbackGate = new(1, 1);

    private static async Task<bool> FallbackClaim(GoodSortDbContext db, Func<Task<bool>> apply)
    {
        await FallbackGate.WaitAsync();
        try
        {
            if (!await apply()) return false;
            await db.SaveChangesAsync();
            return true;
        }
        finally
        {
            FallbackGate.Release();
        }
    }
}
