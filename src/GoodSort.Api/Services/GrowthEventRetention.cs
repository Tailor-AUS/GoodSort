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
/// Daily sweep. Mirrors PickupReminderHost: resolve a scoped DbContext per
/// pass, log and continue on failure, never let a background fault take the
/// API down.
/// </summary>
public class GrowthEventRetentionHost(IServiceProvider services, ILogger<GrowthEventRetentionHost> log)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
                var removed = await GrowthEventRetention.SweepAsync(db, stoppingToken);
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
