using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Services;

/// <summary>
/// Lets exactly one replica run a background pass.
///
/// Every hosted service registered with AddHostedService runs inside every
/// container instance, and this app scales to ten
/// (maxReplicas 10 on the api Container App). So at any scale above one,
/// RunGenerationService generates runs from ten instances at once. Each reads
/// the set of bins already in an active run, each finds the same candidates,
/// and each creates runs for them — duplicate runs over the same kerbs, which
/// means paying several drivers to collect the same containers and sending
/// vans to bins another driver already emptied. It is the same read-then-write
/// shape as the money races, and the most expensive one, because every
/// duplicate is a real trip.
///
/// PickupReminderHost has the milder version of it: ten copies of the same
/// reminder email.
///
/// None of this is happening today — the app sits at one replica — which is
/// exactly the problem. It starts the first time traffic scales the app, and
/// nothing about it looks wrong when it does.
///
/// The lease is a row per named pass. Acquiring is a conditional update: take
/// it only if it is unheld, expired, or already ours. Two replicas racing on
/// the same name update the same row, and only one update matches.
/// </summary>
public static class SingletonLease
{
    /// <summary>
    /// Identifies this process. A restarted replica gets a new id and simply
    /// waits for the old lease to expire rather than fighting over it.
    /// </summary>
    public static readonly Guid InstanceId = Guid.NewGuid();

    /// <summary>
    /// Tries to hold <paramref name="name"/> for <paramref name="ttl"/>.
    ///
    /// The TTL must outlast a pass, or a second replica takes over mid-run and
    /// both are inside it — but not by so much that a crashed holder blocks the
    /// pass for hours. Callers use roughly twice their interval.
    /// </summary>
    /// <param name="holder">
    /// Defaults to this process. Overridable so a test can stand in several
    /// replicas — without it every simulated instance shares one id, the
    /// already-ours branch matches for all of them, and a test would show
    /// unanimous success no matter what the code did.
    /// </param>
    public static async Task<bool> TryAcquire(
        GoodSortDbContext db, string name, TimeSpan ttl, DateTime? utcNow = null,
        Guid? holder = null, CancellationToken ct = default)
    {
        var me = holder ?? InstanceId;
        var now = utcNow ?? DateTime.UtcNow;
        var until = now + ttl;

        try
        {
            // Conditional update: only an unheld, expired or already-ours lease
            // matches, so a racing replica updates no rows and is turned away.
            var taken = await db.Set<SingletonLeaseRow>()
                .Where(l => l.Name == name && (l.ExpiresAt <= now || l.Holder == me))
                .ExecuteUpdateAsync(s => s
                    .SetProperty(l => l.Holder, me)
                    .SetProperty(l => l.ExpiresAt, until), ct);
            if (taken > 0) return true;
        }
        catch (InvalidOperationException)
        {
            // InMemory cannot translate ExecuteUpdate. Correct, not atomic; the
            // atomicity comes from the statement above and from the primary key
            // below. SqlConcurrencyTests exercises the real behaviour.
            var row = await db.Set<SingletonLeaseRow>().FirstOrDefaultAsync(l => l.Name == name, ct);
            if (row is not null)
            {
                if (row.ExpiresAt > now && row.Holder != me) return false;
                row.Holder = me;
                row.ExpiresAt = until;
                await db.SaveChangesAsync(ct);
                return true;
            }
        }

        // No row yet. The name is the primary key, so of several replicas
        // inserting at once exactly one commits and the rest are refused.
        db.Set<SingletonLeaseRow>().Add(new SingletonLeaseRow { Name = name, Holder = me, ExpiresAt = until });
        try
        {
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (Exception ex) when (ex is DbUpdateException or InvalidOperationException or ArgumentException)
        {
            db.ChangeTracker.Clear();
            return false;
        }
    }

    /// <summary>
    /// Gives the lease up early so the next pass is not delayed by the whole
    /// TTL. Expiry is the real safety net; this is politeness.
    /// </summary>
    public static async Task Release(
        GoodSortDbContext db, string name, Guid? holder = null, CancellationToken ct = default)
    {
        var me = holder ?? InstanceId;
        var now = DateTime.UtcNow;
        try
        {
            await db.Set<SingletonLeaseRow>()
                .Where(l => l.Name == name && l.Holder == me)
                .ExecuteUpdateAsync(s => s.SetProperty(l => l.ExpiresAt, now), ct);
        }
        catch (InvalidOperationException)
        {
            var row = await db.Set<SingletonLeaseRow>()
                .FirstOrDefaultAsync(l => l.Name == name && l.Holder == me, ct);
            if (row is null) return;
            row.ExpiresAt = now;
            await db.SaveChangesAsync(ct);
        }
    }
}
