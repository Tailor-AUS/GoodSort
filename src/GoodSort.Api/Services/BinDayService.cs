using System.Text.RegularExpressions;

namespace GoodSort.Api.Services;

/// <summary>
/// Parses Brisbane addresses and normalises suburb names. External Brisbane City
/// Council OpenDataSoft GIS calls (<c>explore/v2.1/catalog/...</c>) are explicitly
/// disabled under the runtime boundary without making any network attempt, and
/// callers fall back to manual collection-day selection.
/// </summary>
public class BinDayService
{
    private readonly ILogger<BinDayService> _log;

    public BinDayService(IHttpClientFactory _, ILogger<BinDayService> log)
    {
        _log = log;
    }

    public Task<BinDayResult?> Lookup(double lat, double lng, string? address = null)
    {
        // Rough BCC bounding box; outside of this we don't have data
        if (lat < -27.75 || lat > -27.20 || lng < 152.70 || lng > 153.30)
            return Task.FromResult<BinDayResult?>(null);
        if (string.IsNullOrWhiteSpace(address))
            return Task.FromResult<BinDayResult?>(null);

        var parsed = ParseAddress(address);
        if (parsed is null)
            return Task.FromResult<BinDayResult?>(null);

        // External BCC OpenDataSoft GIS capability is not provided by
        // https://api.aukus.si/v1 and is disabled before any network call.
        _log.LogInformation(
            "External BCC bin-day lookup is disabled under the runtime boundary for suburb '{Suburb}'; manual selection required.",
            parsed.Suburb);
        return Task.FromResult<BinDayResult?>(null);
    }

    /// <summary>Parse "12 Beaudesert Rd, Moorooka QLD 4105, Australia" → (12, "BEAUDESERT RD", "MOOROOKA").</summary>
    public static ParsedAddress? ParseAddress(string address)
    {
        // Strip trailing ", Australia" and postcode / state tails
        var parts = address.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length < 2) return null;

        // First part: "12 Beaudesert Rd" or "Unit 2/12 Beaudesert Rd"
        var streetPart = parts[0];
        var m = Regex.Match(streetPart, @"(?:(?<unit>[\w\-/]+)\s+)?(?<num>\d+)\s+(?<street>.+)$");
        if (!m.Success) return null;
        var houseNum = m.Groups["num"].Value;
        var streetName = NormaliseStreet(m.Groups["street"].Value);

        // Suburb: usually second part. If second part looks like "Moorooka QLD 4105", take just "Moorooka".
        var suburbPart = parts[1];
        var suburb = Regex.Replace(suburbPart, @"\b(QLD|NSW|VIC|SA|WA|TAS|NT|ACT|QUEENSLAND|AUSTRALIA)\b.*$", "", RegexOptions.IgnoreCase).Trim();
        suburb = Regex.Replace(suburb, @"\s+\d{4}\s*$", "").Trim();
        suburb = suburb.ToUpperInvariant();

        if (string.IsNullOrWhiteSpace(streetName) || string.IsNullOrWhiteSpace(suburb) || string.IsNullOrWhiteSpace(houseNum))
            return null;

        return new ParsedAddress(houseNum, streetName, suburb);
    }

    /// <summary>
    /// Photon often labels city as Brisbane. That must never be a density cluster —
    /// city-wide totals do not unlock a run.
    /// </summary>
    public static string? CanonicalSuburb(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var s = raw.Trim().ToUpperInvariant();
        if (s is "BRISBANE" or "QLD" or "QUEENSLAND" or "AUSTRALIA") return null;
        return s;
    }

    private static string NormaliseStreet(string s)
    {
        s = s.Trim().ToUpperInvariant();
        var abbreviations = new Dictionary<string, string>
        {
            ["ROAD"] = "RD", ["STREET"] = "ST", ["AVENUE"] = "AVE", ["DRIVE"] = "DR",
            ["COURT"] = "CT", ["CRESCENT"] = "CRES", ["PLACE"] = "PL", ["PARADE"] = "PDE",
            ["TERRACE"] = "TCE", ["LANE"] = "LN", ["HIGHWAY"] = "HWY", ["CIRCUIT"] = "CRCT",
            ["BOULEVARD"] = "BLVD", ["CLOSE"] = "CL", ["WAY"] = "WAY", ["ESPLANADE"] = "ESP",
        };
        var words = s.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (words.Length > 0 && abbreviations.TryGetValue(words[^1], out var abbr))
            words[^1] = abbr;
        return string.Join(' ', words);
    }
}

public record BinDayResult(int DayOfWeek, string CouncilArea, string Source);
public record ParsedAddress(string HouseNumber, string Street, string Suburb);
