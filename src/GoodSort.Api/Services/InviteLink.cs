using GoodSort.Api.Data.Entities;

namespace GoodSort.Api.Services;

/// <summary>
/// Public street invite URL. Suburb + recycling day only — never a fake Moorooka
/// fallback, never a city-wide cluster.
/// </summary>
public static class InviteLink
{
    public const string Origin = "https://thegoodsort.org";

    private static readonly string[] DaySlugs =
        ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

    private static readonly string[] DayNames =
        ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    public static bool CanEditCluster(string? binStatus) =>
        binStatus == BinStatuses.Waitlisted;

    public static string? DaySlug(int? day) =>
        day is >= 0 and <= 6 ? DaySlugs[day.Value] : null;

    public static string? PublicDayName(int? day) =>
        day is >= 0 and <= 6 ? DayNames[day.Value] : null;

    public static int? ParseDay(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var s = raw.Trim().ToLowerInvariant();
        if (int.TryParse(s, out var n) && n is >= 0 and <= 6) return n;
        return s switch
        {
            "sun" or "sunday" => 0,
            "mon" or "monday" => 1,
            "tue" or "tues" or "tuesday" => 2,
            "wed" or "wednesday" => 3,
            "thu" or "thur" or "thurs" or "thursday" => 4,
            "fri" or "friday" => 5,
            "sat" or "saturday" => 6,
            _ => null,
        };
    }

    public static string StreetUrl(string? suburb, int? day = null, Guid? profileId = null)
    {
        var place = BinDayService.CanonicalSuburb(suburb);
        var path = string.IsNullOrWhiteSpace(place) ? "/" : $"/brisbane/{Slug(place)}";
        var parts = new List<string>();
        var daySlug = DaySlug(day);
        if (daySlug is not null) parts.Add($"day={daySlug}");
        if (profileId is Guid id) parts.Add($"r={id:D}");
        var query = parts.Count > 0 ? "?" + string.Join('&', parts) : "";
        return $"{Origin}{path}{query}";
    }

    private static string Slug(string suburb) =>
        string.Join('-', suburb.ToLowerInvariant()
            .Split([' ', '-'], StringSplitOptions.RemoveEmptyEntries));
}
