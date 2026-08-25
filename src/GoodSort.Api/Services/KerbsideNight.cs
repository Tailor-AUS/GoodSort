using System.Globalization;
using GoodSort.Api.Data.Entities;

namespace GoodSort.Api.Services;

/// <summary>
/// Brisbane kerbside clock. We collect the night before council recycling.
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
    /// Next collection night in Brisbane local time — the calendar day before
    /// council recycling. Households sort today; this is the night we tell them.
    /// If that night is today, we still say today (not next week).
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
    /// Tonight's run includes every collecting house on tomorrow's council day,
    /// plus any serviceable house that already put the purple bin out.
    /// </summary>
    public static bool HouseholdBinIsOnTonightRun(string? binStatus, bool binIsOut, int? councilDay, DateTime utc)
    {
        if (!BinStatuses.IsServiceable(binStatus)) return false;
        return binIsOut || IsTonightFor(councilDay, utc);
    }
}

/// <summary>
/// A run is one suburb + one recycling day. City-wide or mixed-day
/// clusters never become a run.
/// </summary>
public static class RunCluster
{
    public static string? Key(string? suburb, int? day)
    {
        var s = BinDayService.CanonicalSuburb(suburb);
        if (s is null || day is not int d || d is < 0 or > 6) return null;
        return $"{s}:{d}";
    }

    public static string AreaName(string? suburb, int? day)
    {
        var s = BinDayService.CanonicalSuburb(suburb) ?? "Nearby";
        var title = CultureInfo.InvariantCulture.TextInfo.ToTitleCase(s.ToLowerInvariant());
        if (day is int d && d is >= 0 and <= 6)
            return $"{title} {WaitlistDensity.DayNames[d]}";
        return title;
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
