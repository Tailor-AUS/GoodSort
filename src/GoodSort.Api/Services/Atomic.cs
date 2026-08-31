using GoodSort.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace GoodSort.Api.Services;

/// <summary>
/// Runs a claim and the work it authorises inside one transaction.
///
/// The exclusive-claim pattern used across the money paths — a conditional
/// UPDATE, or a primary key only one caller can win — has a second half that
/// is easy to miss. The claim commits on its own statement. Everything after
/// it sits in the change tracker until a later SaveChangesAsync. If anything
/// in between throws, the claim stands and the work does not.
///
/// I introduced exactly that in #37. Settling a run claims the status
/// transition first, then generates a rating, updates runner stats, credits
/// the runner and moves every household's credit from pending to cleared. A
/// throw anywhere in that sequence leaves the run marked "settled" with nobody
/// paid — and unretryable, because the status guard now rejects it. That is
/// worse than the double-settle it was written to prevent: settling twice
/// overpays and can be reconciled, settling zero times owes money to a driver
/// with no way to reach it.
///
/// The same shape exists wherever a claim precedes its work: a spent scan
/// token with no scan credited, a debited balance with no payout row.
///
/// A transaction makes it all-or-nothing. The InMemory provider has no real
/// transactions and returns a no-op, which is honest: it cannot demonstrate
/// atomicity, and the guarantee comes from SQL Server in production.
/// </summary>
public static class Atomic
{
    /// <summary>
    /// Executes <paramref name="work"/> in a transaction and commits it. Any
    /// exception rolls back the claim along with everything else, so the
    /// operation can be retried.
    /// </summary>
    public static async Task<T> RunAsync<T>(
        GoodSortDbContext db, Func<Task<T>> work, CancellationToken ct = default)
    {
        IDbContextTransaction? tx = null;
        try
        {
            // Throws on InMemory, which has no transactions. Nothing to roll
            // back there either — it is a single in-process store.
            tx = await db.Database.BeginTransactionAsync(ct);
        }
        catch (InvalidOperationException)
        {
            return await work();
        }

        await using (tx)
        {
            var result = await work();
            await tx.CommitAsync(ct);
            return result;
        }
    }
}
