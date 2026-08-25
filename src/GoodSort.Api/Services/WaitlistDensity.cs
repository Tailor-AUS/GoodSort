using GoodSort.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Services;

/// <summary>
/// Public waitlist board. A run unlocks at 12 residential households on the
/// same recycling day in the same suburb. City-wide totals never unlock.
/// </summary>
public static class WaitlistDensity
{
    public const int LiveThreshold = 12;
    public static readonly string[] DayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    /// <summary>
    /// EF-safe load: project to anonymous types first. A record constructor
    /// inside <c>Select</c> can 500 on SQL Server.
    /// </summary>
    public static async Task<List<HouseholdClusterRow>> LoadRowsAsync(GoodSortDbContext db, CancellationToken ct = default)
    {
        var raw = await db.Households.AsNoTracking()
            .Select(h => new { h.Suburb, h.CouncilCollectionDay, h.Type })
            .ToListAsync(ct);
        return raw.ConvertAll(r => new HouseholdClusterRow(r.Suburb, r.CouncilCollectionDay, r.Type));
    }

    public static bool CountsTowardCluster(string? type, string? suburb)
    {
        if (!string.Equals(type, "residential", StringComparison.OrdinalIgnoreCase)) return false;
        var key = BinDayService.CanonicalSuburb(suburb);
        return key is not null;
    }

    /// <summary>
    /// Admin board grouping. City-wide labels collapse to UNKNOWN and must
    /// never show a Buy bins action — 12 UNKNOWN houses is not a street.
    /// </summary>
    public static string AdminGroupKey(string? suburb) =>
        BinDayService.CanonicalSuburb(suburb) ?? "UNKNOWN";

    public static bool CanAllocateSuburb(string? suburb)
    {
        var key = BinDayService.CanonicalSuburb(suburb);
        return key is not null && key != "UNKNOWN";
    }

    /// <summary>Buy bins only when that suburb+day already has 12 houses. Thin streets stay waitlisted.</summary>
    public static bool CanPurchase(int householdsOnDay) => householdsOnDay >= LiveThreshold;

    public static GrowthResponse Aggregate(IEnumerable<HouseholdClusterRow> rows)
    {
        var counted = rows
            .Where(r => CountsTowardCluster(r.Type, r.Suburb))
            .Select(r => new HouseholdClusterRow(
                BinDayService.CanonicalSuburb(r.Suburb)!,
                r.CouncilCollectionDay,
                "residential"))
            .ToList();

        var suburbs = counted
            .GroupBy(r => r.Suburb)
            .Select(g =>
            {
                var byDay = g.Where(x => x.CouncilCollectionDay != null)
                    .GroupBy(x => x.CouncilCollectionDay!.Value)
                    .Select(d =>
                    {
                        var n = d.Count();
                        return new GrowthDayDto(
                            d.Key,
                            d.Key is >= 0 and <= 6 ? DayNames[d.Key] : "recycling day",
                            n,
                            n >= LiveThreshold,
                            Math.Max(0, LiveThreshold - n));
                    })
                    .OrderByDescending(d => d.Households)
                    .ThenBy(d => d.Day)
                    .ToList();
                var best = byDay.FirstOrDefault();
                return new GrowthSuburbDto(
                    g.Key!,
                    g.Count(),
                    byDay.Any(d => d.Live),
                    best?.Needed ?? LiveThreshold,
                    best?.Day,
                    best?.DayName,
                    byDay);
            })
            .OrderBy(s => s.Needed)
            .ThenByDescending(s => s.ByDay.FirstOrDefault()?.Households ?? 0)
            .ThenBy(s => s.Suburb)
            .ToList();

        return new GrowthResponse(LiveThreshold, counted.Count, suburbs);
    }

    public static GrowthDayDto? DayCluster(GrowthResponse board, string? suburb, int? day)
    {
        var key = BinDayService.CanonicalSuburb(suburb);
        if (key is null) return null;
        var match = board.Suburbs.FirstOrDefault(s => s.Suburb == key);
        if (match is null) return null;
        if (day is int d) return match.ByDay.FirstOrDefault(x => x.Day == d);
        return match.ByDay.FirstOrDefault();
    }
}

public record HouseholdClusterRow(string? Suburb, int? CouncilCollectionDay, string Type = "residential");

public record GrowthDayDto(int Day, string DayName, int Households, bool Live, int Needed);

public record GrowthSuburbDto(
    string Suburb,
    int Households,
    bool Live,
    int Needed,
    int? BestDay,
    string? BestDayName,
    IReadOnlyList<GrowthDayDto> ByDay);

public record GrowthResponse(int LiveThreshold, int TotalHouseholds, IReadOnlyList<GrowthSuburbDto> Suburbs);
