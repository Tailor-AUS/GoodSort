using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Services;

/// <summary>
/// Public waitlist board. A suburb run unlocks when residential households
/// there have enough eligible container volume (scan tally) to cover a
/// single driver trip. See docs/collection-economics.md — break-even at
/// 1,000 containers if the trip is $50. City-wide totals never unlock.
/// </summary>
public static class WaitlistDensity
{
    /// <summary>Container volume that opens a suburb run ($50 ÷ 5¢ household share).</summary>
    public const int LiveThreshold = 1000;

    public static readonly string[] DayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    /// <summary>
    /// EF-safe load: project to anonymous types first. A record constructor
    /// inside <c>Select</c> can 500 on SQL Server.
    /// </summary>
    public static async Task<List<HouseholdClusterRow>> LoadRowsAsync(GoodSortDbContext db, CancellationToken ct = default)
    {
        var unreconciledHouseholds = await db.Scans.AsNoTracking()
            .Where(s => s.HouseholdId != null && s.Status == "pending_unreconciled")
            .Select(s => s.HouseholdId!.Value)
            .Distinct()
            .ToListAsync(ct);
        var unreconciledSet = unreconciledHouseholds.ToHashSet();

        var raw = await db.Households.AsNoTracking()
            .Select(h => new
            {
                h.Id,
                h.Suburb,
                h.CouncilCollectionDay,
                h.Type,
                h.PendingContainers,
                h.BinStatus,
                Aluminium = h.Materials.Aluminium,
                Pet = h.Materials.Pet,
                Glass = h.Materials.Glass,
                Other = h.Materials.Other,
            })
            .ToListAsync(ct);

        return raw.ConvertAll(r =>
        {
            var pending = Math.Max(0, r.PendingContainers);
            var matTotal = Math.Max(0, r.Aluminium) + Math.Max(0, r.Pet) + Math.Max(0, r.Glass) + Math.Max(0, r.Other);
            // If a household has pending_unreconciled scans OR its material breakdown
            // exceeds the remaining pending ledger (e.g. a partial pickup decremented
            // PendingContainers without reconciling Materials), do not infer aluminium.
            var unknown = pending > 0 && (unreconciledSet.Contains(r.Id) || r.Aluminium > pending || matTotal > pending);
            var alu = unknown ? 0 : Math.Max(0, r.Aluminium);
            return new HouseholdClusterRow(r.Suburb, r.CouncilCollectionDay, r.Type, r.PendingContainers, r.BinStatus, alu, unknown);
        });
    }

    /// <summary>
    /// A household is a unit complex only if it says so; everything else is a
    /// house. Matching on == "residential" instead looked equivalent and was
    /// not: the migration that introduced Type used defaultValue "", so every
    /// household predating it has an empty Type.
    /// </summary>
    public static bool IsResidential(string? type) =>
        !string.Equals(type, "unit_complex", StringComparison.OrdinalIgnoreCase);

    public static bool CountsTowardCluster(string? type, string? suburb)
    {
        if (!IsResidential(type)) return false;
        var key = BinDayService.CanonicalSuburb(suburb);
        return key is not null;
    }

    public static bool IsIncompleteResidential(string? type, string? suburb) =>
        IsResidential(type) && BinDayService.CanonicalSuburb(suburb) is null;

    public static string AdminGroupKey(string? suburb) =>
        BinDayService.CanonicalSuburb(suburb) ?? "UNKNOWN";

    public static bool CanAllocateSuburb(string? suburb)
    {
        var key = BinDayService.CanonicalSuburb(suburb);
        return key is not null && key != "UNKNOWN";
    }

    /// <summary>
    /// Ops may allocate only when operator aluminium readiness is configured
    /// and suburb aluminium volume reaches that configured threshold.
    /// </summary>
    public static int EffectiveThreshold(CollectionReadinessConfig? readiness = null) =>
        readiness is { Configured: true, AluminiumThreshold: int threshold and > 0 } ? threshold : 0;

    public static bool CanPurchase(int aluminiumInSuburb, CollectionReadinessConfig? readiness = null) =>
        readiness is { Configured: true, AluminiumThreshold: int threshold and > 0 } && aluminiumInSuburb >= threshold;

    /// <summary>
    /// A driver trip needs doors, not just a number. One household reporting the
    /// whole threshold is a data fault or an attack, not a collectable suburb.
    /// </summary>
    public const int MinHouseholdsForRun = 3;

    public static bool CanDispatch(int aluminiumInSuburb, int householdsInSuburb, CollectionReadinessConfig? readiness = null) =>
        CanPurchase(aluminiumInSuburb, readiness) && householdsInSuburb >= MinHouseholdsForRun;

    /// <summary>
    /// Ops have committed bins to this household: allocated, delivered or
    /// collecting. PendingContainers is a credit ledger and is drained at
    /// settle, so volume alone cannot tell us a suburb is already served.
    /// </summary>
    public static bool IsCommitted(string? binStatus) =>
        binStatus == BinStatuses.Allocated || BinStatuses.IsServiceable(binStatus);

    /// <summary>
    /// Announce a suburb unlock to residents and ops. Fires once: only when
    /// operator aluminium readiness is configured, no household there has bins
    /// committed, and this household's aluminium delta crossed the threshold.
    /// </summary>
    public static bool ShouldAnnounceUnlock(
        bool suburbCommitted,
        int suburbAluminium,
        int householdAluminiumDelta,
        CollectionReadinessConfig? readiness = null)
    {
        if (suburbCommitted) return false;
        if (readiness is not { Configured: true, AluminiumThreshold: int threshold and > 0 }) return false;
        if (suburbAluminium < threshold) return false;
        return suburbAluminium - Math.Max(0, householdAluminiumDelta) < threshold;
    }

    public static GrowthResponse Aggregate(
        IEnumerable<HouseholdClusterRow> rows,
        int launchBonusContainers = 0,
        CollectionReadinessConfig? readinessConfig = null)
    {
        var readiness = readinessConfig ?? CollectionReadinessConfig.Pending;
        var materialised = rows as IReadOnlyCollection<HouseholdClusterRow> ?? rows.ToList();
        var incomplete = materialised.Count(r => IsIncompleteResidential(r.Type, r.Suburb));

        var counted = materialised
            .Where(r => CountsTowardCluster(r.Type, r.Suburb))
            .Select(r =>
            {
                var pending = Math.Max(0, r.PendingContainers);
                // If AluminiumContainers exceeds PendingContainers or is flagged
                // as unknown composition, never infer aluminium by clamping.
                var unknown = r.MaterialCompositionUnknown || (pending > 0 && (r.AluminiumContainers > pending || r.AluminiumContainers < 0));
                var alu = unknown || pending == 0 ? 0 : r.AluminiumContainers;
                return new HouseholdClusterRow(
                    BinDayService.CanonicalSuburb(r.Suburb)!,
                    r.CouncilCollectionDay,
                    "residential",
                    pending,
                    r.BinStatus,
                    alu,
                    unknown);
            })
            .ToList();

        var suburbs = counted
            .GroupBy(r => r.Suburb)
            .Select(g =>
            {
                var households = g.Count();
                var containers = g.Sum(x => x.PendingContainers);
                var aluminium = g.Sum(x => x.AluminiumContainers);
                var compositionUnknown = g.Any(x => x.MaterialCompositionUnknown);
                var committed = g.Any(x => IsCommitted(x.BinStatus));
                var suburbReadiness = CollectionReadiness.ForSuburb(readiness, aluminium, committed, compositionUnknown);
                var live = committed || (readiness is { Configured: true, AluminiumThreshold: int t and > 0 } && aluminium >= t);
                var needed = live
                    ? 0
                    : readiness is { Configured: true, AluminiumThreshold: int threshold and > 0 }
                        ? Math.Max(0, threshold - aluminium)
                        : 0;

                var byDay = g.Where(x => x.CouncilCollectionDay != null)
                    .GroupBy(x => x.CouncilCollectionDay!.Value)
                    .Select(d =>
                    {
                        var dayContainers = d.Sum(x => x.PendingContainers);
                        var n = d.Count();
                        return new GrowthDayDto(
                            d.Key,
                            d.Key is >= 0 and <= 6 ? DayNames[d.Key] : "recycling day",
                            n,
                            dayContainers,
                            live,
                            needed);
                    })
                    .OrderByDescending(d => d.Containers)
                    .ThenByDescending(d => d.Households)
                    .ThenBy(d => d.Day)
                    .ToList();
                var best = byDay.FirstOrDefault();
                return new GrowthSuburbDto(
                    g.Key!,
                    households,
                    containers,
                    live,
                    committed,
                    needed,
                    best?.Day,
                    best?.DayName,
                    byDay,
                    aluminium,
                    suburbReadiness);
            })
            .OrderByDescending(s => s.Live)
            .ThenByDescending(s => s.AluminiumContainers)
            .ThenByDescending(s => s.Containers)
            .ThenBy(s => s.Suburb)
            .ToList();

        var effectiveThreshold = readiness is { Configured: true, AluminiumThreshold: int configuredThreshold and > 0 }
            ? configuredThreshold
            : 0;

        return new GrowthResponse(
            effectiveThreshold,
            launchBonusContainers,
            incomplete,
            counted.Count,
            counted.Sum(r => r.PendingContainers),
            suburbs,
            readiness);
    }

    public static GrowthSuburbDto? SuburbCluster(GrowthResponse board, string? suburb)
    {
        var key = BinDayService.CanonicalSuburb(suburb);
        if (key is null) return null;
        return board.Suburbs.FirstOrDefault(s => s.Suburb == key);
    }

    public static GrowthDayDto? DayCluster(GrowthResponse board, string? suburb, int? day)
    {
        var match = SuburbCluster(board, suburb);
        if (match is null) return null;
        if (day is int d)
        {
            var onDay = match.ByDay.FirstOrDefault(x => x.Day == d);
            if (onDay is not null) return onDay;
        }
        return new GrowthDayDto(
            day ?? match.BestDay ?? -1,
            match.BestDayName ?? "suburb",
            match.Households,
            match.Containers,
            match.Live,
            match.Needed);
    }
}

public record HouseholdClusterRow(
    string? Suburb,
    int? CouncilCollectionDay,
    string Type = "residential",
    int PendingContainers = 0,
    string? BinStatus = null,
    int AluminiumContainers = 0,
    bool MaterialCompositionUnknown = false);

public record GrowthDayDto(int Day, string DayName, int Households, int Containers, bool Live, int Needed);

public record GrowthSuburbDto(
    string Suburb,
    int Households,
    int Containers,
    bool Live,
    bool Committed,
    int Needed,
    int? BestDay,
    string? BestDayName,
    IReadOnlyList<GrowthDayDto> ByDay,
    /// <summary>Pending eligible aluminium containers scanned in the suburb.</summary>
    int AluminiumContainers = 0,
    /// <summary>Honest collection readiness; see CollectionReadiness.</summary>
    SuburbReadinessDto? Readiness = null);

public record GrowthResponse(
    int LiveThreshold,
    int LaunchBonusContainers,
    int IncompleteHouseholds,
    int TotalHouseholds,
    int TotalContainers,
    IReadOnlyList<GrowthSuburbDto> Suburbs,
    CollectionReadinessConfig? CollectionReadiness = null);
