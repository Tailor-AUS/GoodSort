using System.Text.RegularExpressions;

namespace GoodSort.Api.Services;

public sealed record BuildingAnalysis(
    string? BuildingKey,
    string DisplayName,
    string ChannelSlug,
    string Suburb,
    string BuildingKind,
    bool IsMultiUnitOrCommercial);

/// <summary>
/// Normalises Australian street addresses into a canonical building key by
/// stripping unit / apartment / suite / level / floor prefixes so every sorter
/// in the same office tower or residential complex matches the same anonymous
/// BuildingSyndicate without ever exposing apartment or floor numbers.
/// </summary>
public static partial class BuildingAddress
{
    private static readonly Dictionary<string, string> StreetSuffixes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["street"] = "st",
        ["road"] = "rd",
        ["avenue"] = "ave",
        ["terrace"] = "tce",
        ["drive"] = "dr",
        ["parade"] = "pde",
        ["crescent"] = "cres",
        ["place"] = "pl",
        ["court"] = "ct",
        ["lane"] = "ln",
        ["esplanade"] = "esp",
        ["boulevard"] = "blvd",
        ["highway"] = "hwy",
        ["circuit"] = "cct",
        ["close"] = "cl",
        ["way"] = "way",
    };

    [GeneratedRegex(@"^\s*(?:(?:unit|u|apt|apartment|flat|suite|ste|level|lvl|l|floor|fl|shop|tenancy|room|rm|office|lot|ground|gnd|tower|twr|bldg|building)\s*[a-z0-9\-]*\s*[,/:\-]\s*)+", RegexOptions.IgnoreCase)]
    private static partial Regex LeadingUnitWordPrefix();

    [GeneratedRegex(@"^\s*(?:unit|apt|apartment|flat|suite|ste|level|lvl|floor|fl|shop|tenancy|office|lot)\s+[a-z0-9\-]+\s+(?=\d+[a-z]?\s+[a-z])", RegexOptions.IgnoreCase)]
    private static partial Regex LeadingSpaceUnitPrefix();

    [GeneratedRegex(@"^\s*[a-z]?\d+[a-z]?\s*/\s*(\d+[a-z]?(?:-\d+[a-z]?)?\s+.+)$", RegexOptions.IgnoreCase)]
    private static partial Regex LeadingSlashUnitPrefix();

    [GeneratedRegex(@"\b(?:level|lvl|floor|suite|ste|office|tenancy|shop|tower|plaza|chambers|commercial|centre|center)\b", RegexOptions.IgnoreCase)]
    private static partial Regex CommercialSignalRegex();

    [GeneratedRegex(@"\b(?:unit|apt|apartment|flat|villa|townhouse|residences|apartments|complex|lot)\b", RegexOptions.IgnoreCase)]
    private static partial Regex ResidentialMultiUnitRegex();

    [GeneratedRegex(@"^\s*(\d+[a-z]?(?:-\d+[a-z]?)?)\s+(.+)$", RegexOptions.IgnoreCase)]
    private static partial Regex StreetNumberAndNameRegex();

    [GeneratedRegex(@"\b(?:qld|nsw|vic|sa|wa|tas|nt|act)\b(?:\s+\d{4})?.*$", RegexOptions.IgnoreCase)]
    private static partial Regex StatePostcodeTailRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex MultiSpaceRegex();

    [GeneratedRegex(@"[^a-z0-9]+")]
    private static partial Regex NonSlugRegex();

    public static BuildingAnalysis Analyze(
        string? address,
        string? suburb,
        string? householdType = null,
        string? buildingName = null)
    {
        var rawAddress = (address ?? "").Trim();
        var cleanSuburb = (suburb ?? "").Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(rawAddress))
        {
            return new BuildingAnalysis(null, "", "building", cleanSuburb, "residential", false);
        }

        var isUnitComplexType = string.Equals(householdType, "unit_complex", StringComparison.OrdinalIgnoreCase);
        var hasWordUnitPrefix = LeadingUnitWordPrefix().IsMatch(rawAddress) || LeadingSpaceUnitPrefix().IsMatch(rawAddress);
        var hasSlashUnitPrefix = LeadingSlashUnitPrefix().IsMatch(rawAddress);
        var hasCommercialHint = CommercialSignalRegex().IsMatch(rawAddress)
            || (!string.IsNullOrWhiteSpace(buildingName) && CommercialSignalRegex().IsMatch(buildingName))
            || cleanSuburb is "BRISBANE CITY" or "BRISBANE" or "SOUTH BRISBANE" or "FORTITUDE VALLEY" or "MILTON" or "SPRING HILL";
        var hasResidentialMultiHint = isUnitComplexType
            || ResidentialMultiUnitRegex().IsMatch(rawAddress)
            || (!string.IsNullOrWhiteSpace(buildingName) && ResidentialMultiUnitRegex().IsMatch(buildingName));

        var isMultiUnitOrCommercial = isUnitComplexType || hasWordUnitPrefix || hasSlashUnitPrefix || hasResidentialMultiHint || CommercialSignalRegex().IsMatch(rawAddress);

        // Strip leading unit / level / suite / slash designators to isolate the building street line
        var stripped = rawAddress;
        var prev = "";
        while (stripped != prev)
        {
            prev = stripped;
            stripped = LeadingUnitWordPrefix().Replace(stripped, "").Trim();
            stripped = LeadingSpaceUnitPrefix().Replace(stripped, "").Trim();
            var slash = LeadingSlashUnitPrefix().Match(stripped);
            if (slash.Success)
            {
                stripped = slash.Groups[1].Value.Trim();
            }
        }

        // First comma segment is normally "<number> <street name>"
        var streetPart = stripped.Split(',')[0].Trim();
        streetPart = StatePostcodeTailRegex().Replace(streetPart, "").Trim();
        streetPart = MultiSpaceRegex().Replace(streetPart, " ");

        var numMatch = StreetNumberAndNameRegex().Match(streetPart);
        if (!numMatch.Success)
        {
            return new BuildingAnalysis(null, "", "building", cleanSuburb, "residential", isMultiUnitOrCommercial);
        }

        var streetNumber = numMatch.Groups[1].Value.ToLowerInvariant();
        var streetWords = numMatch.Groups[2].Value
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(w =>
            {
                var cleaned = Regex.Replace(w, @"[^a-zA-Z0-9\-]", "");
                return StreetSuffixes.TryGetValue(cleaned, out var abbr) ? abbr : cleaned.ToLowerInvariant();
            })
            .Where(w => w.Length > 0)
            .ToArray();

        if (streetWords.Length == 0)
        {
            return new BuildingAnalysis(null, "", "building", cleanSuburb, "residential", isMultiUnitOrCommercial);
        }

        var canonicalStreet = $"{streetNumber} {string.Join(' ', streetWords)}";
        var effectiveSuburb = cleanSuburb;
        if (string.IsNullOrWhiteSpace(effectiveSuburb))
        {
            var commaParts = rawAddress.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (commaParts.Length >= 2)
            {
                effectiveSuburb = StatePostcodeTailRegex().Replace(commaParts[1], "").Trim().ToUpperInvariant();
            }
        }

        var buildingKey = string.IsNullOrWhiteSpace(effectiveSuburb)
            ? canonicalStreet
            : $"{canonicalStreet}|{effectiveSuburb.ToLowerInvariant()}";

        var displayStreet = TitleCaseStreet(canonicalStreet);
        var displayName = !string.IsNullOrWhiteSpace(buildingName)
            ? buildingName.Trim()
            : displayStreet;

        var kind = CommercialSignalRegex().IsMatch(rawAddress)
            || (!string.IsNullOrWhiteSpace(buildingName) && CommercialSignalRegex().IsMatch(buildingName))
            || (hasCommercialHint && !hasResidentialMultiHint && (hasWordUnitPrefix || hasSlashUnitPrefix))
                ? "commercial"
                : "residential";

        var slug = Slugify(displayName);

        return new BuildingAnalysis(
            BuildingKey: buildingKey,
            DisplayName: displayName,
            ChannelSlug: slug,
            Suburb: effectiveSuburb,
            BuildingKind: kind,
            IsMultiUnitOrCommercial: isMultiUnitOrCommercial);
    }

    public static string Slugify(string? name)
    {
        var slug = NonSlugRegex().Replace((name ?? "").Trim().ToLowerInvariant(), "-").Trim('-');
        if (string.IsNullOrWhiteSpace(slug)) return "building-pool";
        return slug.Length > 36 ? slug[..36].TrimEnd('-') : slug;
    }

    public static string? SanitizeMessage(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var withoutControls = new string(raw.Where(c => !char.IsControl(c) || c == ' ').ToArray());
        var collapsed = MultiSpaceRegex().Replace(withoutControls, " ").Trim();
        if (collapsed.Length == 0) return null;
        return collapsed.Length > 280 ? collapsed[..280] : collapsed;
    }

    private static string TitleCaseStreet(string canonical)
    {
        return string.Join(' ', canonical.Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(w =>
            w.Length == 0 ? w : char.ToUpperInvariant(w[0]) + w[1..]));
    }
}
