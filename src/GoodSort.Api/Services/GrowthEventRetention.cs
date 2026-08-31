using GoodSort.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Services;

/// <summary>
/// Prunes funnel events past the retention window.
///
/// This exists because the obvious template did not have it: VisionCalls has
/// been append-only since it was introduced and is never pruned. An events
/// table grows far faster, so the sweep ships with the table rather than after
/// someone notices the bill.
/// </summary>
public static class GrowthEventRetention
{
    /// <summary>How long funnel rows are kept. Also caps the funnel query window.</summary>
    public const int RetentionDays = 90;

    public static async Task<int> SweepAsync(GoodSortDbContext db, CancellationToken ct = default)
    {
        var cutoff = DateTime.UtcNow.AddDays(-RetentionDays);
        var stale = db.GrowthEvents.Where(e => e.CreatedAt < cutoff);

        try
        {
            // Preferred: one set-based DELETE, no rows pulled into memory.
            return await stale.ExecuteDeleteAsync(ct);
        }
        catch (InvalidOperationException)
        {
            // The InMemory provider used by tests and local dev cannot
            // translate ExecuteDelete. Fall back so the sweep stays verifiable;
            // production runs SQL Server and takes the path above.
            var rows = await stale.ToListAsync(ct);
            if (rows.Count == 0) return 0;
            db.GrowthEvents.RemoveRange(rows);
            await db.SaveChangesAsync(ct);
            return rows.Count;
        }
    }
}

/// <summary>
/// Spent scan tokens only need to outlive the tokens themselves, which expire
/// ten minutes after issue. Seven days is far past any legitimate replay and
/// keeps the table from growing for the life of the product.
/// </summary>
public static class UsedScanTokenRetention
{
    public const int RetentionDays = 7;

    public static async Task<int> SweepAsync(GoodSortDbContext db, CancellationToken ct = default)
    {
        var cutoff = DateTime.UtcNow.AddDays(-RetentionDays);
        var stale = db.UsedScanTokens.Where(t => t.UsedAt < cutoff);

        try
        {
            return await stale.ExecuteDeleteAsync(ct);
        }
        catch (InvalidOperationException)
        {
            // Same InMemory limitation as the sweep above.
            var rows = await stale.ToListAsync(ct);
            if (rows.Count == 0) return 0;
            db.UsedScanTokens.RemoveRange(rows);
            await db.SaveChangesAsync(ct);
            return rows.Count;
        }
    }
}

/// <summary>
/// Daily sweep. Mirrors PickupReminderHost: resolve a scoped DbContext per
/// pass, log and continue on failure, never let a background fault take the
/// API down.
/// </summary>
public class GrowthEventRetentionHost(IServiceProvider services, ILogger<GrowthEventRetentionHost> log)
    : BackgroundService
{
    /// <summary>Own name, so it does not block the other passes' leases.</summary>
    private const string LeaseName = "growth-event-retention";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();

                // One replica only. This host mirrored PickupReminderHost in
                // every respect except the part that matters — it had no lease,
                // while the app scales to ten replicas, so all ten ran the same
                // delete sweep at once. The rows deleted are the same either
                // way, so nothing looked wrong; the cost is ten concurrent
                // bulk DELETEs over the same ranges of GrowthEvents and
                // UsedScanTokens, which is how you get lock contention on the
                // table the funnel writes to on every scan.
                if (!await SingletonLease.TryAcquire(db, LeaseName, TimeSpan.FromHours(6), ct: stoppingToken))
                {
                    try { await Task.Delay(TimeSpan.FromHours(1), stoppingToken); }
                    catch (TaskCanceledException) { break; }
                    continue;
                }

                var removed = await GrowthEventRetention.SweepAsync(db, stoppingToken);
                var spent = await UsedScanTokenRetention.SweepAsync(db, stoppingToken);
                if (spent > 0)
                    log.LogInformation("Pruned {Count} spent scan tokens older than {Days} days", spent, UsedScanTokenRetention.RetentionDays);
                if (removed > 0)
                    log.LogInformation("Pruned {Count} growth events older than {Days} days", removed, GrowthEventRetention.RetentionDays);
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "Growth event retention sweep failed");
            }

            try { await Task.Delay(TimeSpan.FromHours(24), stoppingToken); }
            catch (TaskCanceledException) { break; }
        }
    }
}
