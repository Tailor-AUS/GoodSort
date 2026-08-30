using System.Globalization;
using GoodSort.Api.Data.Entities;

namespace GoodSort.Api.Services;

/// <summary>
/// Brisbane local clock helpers. Suburb runs are scheduled when volume covers
/// a trip — suburb volume unlocks scheduling, not a fixed council night.
/// </summary>
public static class KerbsideNight
{
    public static readonly TimeSpan BrisbaneOffset = TimeSpan.FromHours(10);

    public static DateTime BrisbaneLocal(DateTime utc) => utc.Kind == DateTimeKind.Utc
        ? utc + BrisbaneOffset
        : DateTime.SpecifyKind(utc, DateTimeKind.Utc) + BrisbaneOffset;

    public static int TomorrowCouncilDay(DateTime utc) =>
        (int)BrisbaneLocal(utc).Date.AddDays(1).DayOfWeek;

    public static bool IsTonightFor(int? councilDay, DateTime utc) =>
        councilDay is int day && day == TomorrowCouncilDay(utc);

    /// <summary>
    /// Optional planning date from a household's council day. Product copy no
    /// longer promises collection on this night — prefer ops-announced runs.
    /// </summary>
    public static DateTime? NextRunnerLocalDate(int? councilDay, DateTime utc)
    {
        if (councilDay is not int day || day is < 0 or > 6) return null;
        var brisbane = BrisbaneLocal(utc).Date;
        var runnerDay = (day + 6) % 7;
        var daysAhead = (runnerDay - (int)brisbane.DayOfWeek + 7) % 7;
        return brisbane.AddDays(daysAhead);
    }

    /// <summary>
    /// Serviceable houses are eligible for a suburb volume run. Council night
    /// is not the gate. Prefer <see cref="HouseholdBinIsReady"/> when pending
    /// container counts are available.
    /// </summary>
    public static bool HouseholdBinIsOnTonightRun(string? binStatus, bool binIsOut, int? councilDay, DateTime utc)
    {
        _ = binIsOut;
        _ = councilDay;
        _ = utc;
        return BinStatuses.IsServiceable(binStatus);
    }

    /// <summary>Serviceable and either bags/bin out or pending containers on the books.</summary>
    public static bool HouseholdBinIsReady(string? binStatus, bool binIsOut, int pendingContainers)
    {
        if (!BinStatuses.IsServiceable(binStatus)) return false;
        return binIsOut || pendingContainers >= 1;
    }
}

/// <summary>
/// A run is one suburb. City-wide clusters never become a run.
/// </summary>
public static class RunCluster
{
    public static string? Key(string? suburb, int? day = null)
    {
        return BinDayService.CanonicalSuburb(suburb);
    }

    public static string AreaName(string? suburb, int? day = null)
    {
        var s = BinDayService.CanonicalSuburb(suburb) ?? "Nearby";
        return CultureInfo.InvariantCulture.TextInfo.ToTitleCase(s.ToLowerInvariant());
    }

    public static IReadOnlyList<IReadOnlyList<T>> GroupByStreet<T>(
        IEnumerable<T> items,
        Func<T, string?> suburb,
        Func<T, int?> day)
    {
        return items
            .GroupBy(x => Key(suburb(x), day(x)))
            .Where(g => g.Key is not null)
            .Select(g => (IReadOnlyList<T>)g.ToList())
            .ToList();
    }
}
