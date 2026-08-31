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
        var raw = await db.Households.AsNoTracking()
            .Select(h => new { h.Suburb, h.CouncilCollectionDay, h.Type, h.PendingContainers, h.BinStatus })
            .ToListAsync(ct);
        return raw.ConvertAll(r => new HouseholdClusterRow(r.Suburb, r.CouncilCollectionDay, r.Type, r.PendingContainers, r.BinStatus));
    }

    /// <summary>
    /// A household is a unit complex only if it says so; everything else is a
    /// house. Matching on == "residential" instead looked equivalent and was
    /// not: the migration that introduced Type used defaultValue "", so every
    /// household predating it has an empty Type. Those rows were rejected by
    /// BOTH this and IsIncompleteResidential — counted nowhere and flagged
    /// nowhere, which is how the one household in production stayed invisible
    /// even after we added a count specifically to surface it.
    ///
    /// This also matches residentialNeedsStreet in lib/brisbane.ts, which has
    /// always treated not-a-unit as residential.
    /// </summary>
    public static bool IsResidential(string? type) =>
        !string.Equals(type, "unit_complex", StringComparison.OrdinalIgnoreCase);

    public static bool CountsTowardCluster(string? type, string? suburb)
    {
        if (!IsResidential(type)) return false;
        var key = BinDayService.CanonicalSuburb(suburb);
        return key is not null;
    }

    /// <summary>
    /// A member who joined but cannot be counted or collected from: residential,
    /// yet with no canonical suburb. Distinct from a unit complex, which is a
    /// deliberate category rather than an unfinished one.
    ///
    /// Aggregate used to drop these silently, so the board could not tell
    /// "nobody joined" from "people joined and we cannot see them" — a real
    /// production state on 2026-08-31, when the only household was one of these.
    /// </summary>
    public static bool IsIncompleteResidential(string? type, string? suburb) =>
        IsResidential(type) && BinDayService.CanonicalSuburb(suburb) is null;

    /// <summary>
    /// Admin board grouping. City-wide labels collapse to UNKNOWN and must
    /// never show a Buy bins action.
    /// </summary>
    public static string AdminGroupKey(string? suburb) =>
        BinDayService.CanonicalSuburb(suburb) ?? "UNKNOWN";

    public static bool CanAllocateSuburb(string? suburb)
    {
        var key = BinDayService.CanonicalSuburb(suburb);
        return key is not null && key != "UNKNOWN";
    }

    /// <summary>Ops may allocate when suburb container volume hits the trip threshold.</summary>
    public static bool CanPurchase(int containersInSuburb) => containersInSuburb >= LiveThreshold;

    /// <summary>
    /// A driver trip needs doors, not just a number. One household reporting the
    /// whole threshold is a data fault or an attack, not a collectable suburb —
    /// a runner sent to a single address earns per container and eats the trip.
    /// </summary>
    public const int MinHouseholdsForRun = 3;

    public static bool CanDispatch(int containersInSuburb, int householdsInSuburb) =>
        CanPurchase(containersInSuburb) && householdsInSuburb >= MinHouseholdsForRun;

    /// <summary>
    /// Ops have committed bins to this household: allocated, delivered or
    /// collecting. PendingContainers is a credit ledger and is drained at
    /// settle, so volume alone cannot tell us a suburb is already served.
    /// </summary>
    public static bool IsCommitted(string? binStatus) =>
        binStatus == BinStatuses.Allocated || BinStatuses.IsServiceable(binStatus);

    /// <summary>
    /// Announce a suburb unlock to residents and ops. Fires once: only while
    /// no household there has bins committed, and only for the household whose
    /// containers crossed the threshold. Compares SUBURB volume — a suburb
    /// splitting 600/400 across two recycling days still unlocks.
    /// </summary>
    public static bool ShouldAnnounceUnlock(bool suburbCommitted, int suburbContainers, int householdContainers)
    {
        if (suburbCommitted) return false;
        if (suburbContainers < LiveThreshold) return false;
        return suburbContainers - Math.Max(0, householdContainers) < LiveThreshold;
    }

    public static GrowthResponse Aggregate(IEnumerable<HouseholdClusterRow> rows, int launchBonusContainers = 0)
    {
        var materialised = rows as IReadOnlyCollection<HouseholdClusterRow> ?? rows.ToList();
        var incomplete = materialised.Count(r => IsIncompleteResidential(r.Type, r.Suburb));

        var counted = materialised
            .Where(r => CountsTowardCluster(r.Type, r.Suburb))
            .Select(r => new HouseholdClusterRow(
                BinDayService.CanonicalSuburb(r.Suburb)!,
                r.CouncilCollectionDay,
                "residential",
                Math.Max(0, r.PendingContainers),
                r.BinStatus))
            .ToList();

        var suburbs = counted
            .GroupBy(r => r.Suburb)
            .Select(g =>
            {
                var households = g.Count();
                var containers = g.Sum(x => x.PendingContainers);
                // Once ops commit bins the suburb stays live. Settling a run
                // drains PendingContainers to 0; that must not push an active
                // collection route back onto the waitlist board.
                var committed = g.Any(x => IsCommitted(x.BinStatus));
                var live = committed || containers >= LiveThreshold;
                var needed = live ? 0 : Math.Max(0, LiveThreshold - containers);

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
                    byDay);
            })
            .OrderBy(s => s.Needed)
            .ThenByDescending(s => s.Containers)
            .ThenBy(s => s.Suburb)
            .ToList();

        return new GrowthResponse(
            LiveThreshold,
            launchBonusContainers,
            incomplete,
            counted.Count,
            counted.Sum(r => r.PendingContainers),
            suburbs);
    }

    public static GrowthSuburbDto? SuburbCluster(GrowthResponse board, string? suburb)
    {
        var key = BinDayService.CanonicalSuburb(suburb);
        if (key is null) return null;
        return board.Suburbs.FirstOrDefault(s => s.Suburb == key);
    }

    /// <summary>
    /// Progress for join/email. Unlock is suburb volume, not same-day house count.
    /// Day is retained only as an optional label.
    /// </summary>
    public static GrowthDayDto? DayCluster(GrowthResponse board, string? suburb, int? day)
    {
        var match = SuburbCluster(board, suburb);
        if (match is null) return null;
        if (day is int d)
        {
            var onDay = match.ByDay.FirstOrDefault(x => x.Day == d);
            if (onDay is not null) return onDay;
        }
        // Suburb-level progress exposed as a synthetic day row for callers that
        // still read Households/Needed/Live off GrowthDayDto.
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
    string? BinStatus = null);

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
    IReadOnlyList<GrowthDayDto> ByDay);

public record GrowthResponse(
    int LiveThreshold,
    int LaunchBonusContainers,
    /// <summary>Joined but uncountable — residential with no canonical suburb. A
    /// count only: who they are stays behind AdminPolicy.</summary>
    int IncompleteHouseholds,
    int TotalHouseholds,
    int TotalContainers,
    IReadOnlyList<GrowthSuburbDto> Suburbs);
