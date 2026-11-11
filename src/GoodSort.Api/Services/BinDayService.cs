using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace GoodSort.Api.Services;

/// <summary>
/// Looks up the day of the week (0=Sun..6=Sat) for council recycling at an
/// address using Brisbane City Council open data (OpenDataSoft). City-wide
/// labels must never unlock a run. Addresses outside BCC return null and the
/// UI asks the user to pick manually.
/// </summary>
public class BinDayService
{
    private readonly IHttpClientFactory _http;
    private readonly ILogger<BinDayService> _log;
    private const string Base = "https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets/waste-collection-days-collection-days/records";

    public BinDayService(IHttpClientFactory http, ILogger<BinDayService> log)
    {
        _http = http; _log = log;
    }

    public async Task<BinDayResult?> Lookup(double lat, double lng, string? address = null)
    {
        // IEEE-754 NaN comparisons (< and >) evaluate to false, so guard finiteness explicitly
        // before the rough BCC bounding box check.
        if (!double.IsFinite(lat) || !double.IsFinite(lng)
            || lat < -27.75 || lat > -27.20 || lng < 152.70 || lng > 153.30)
            return null;
        if (string.IsNullOrWhiteSpace(address) || address.Length > 300) return null;

        var parsed = ParseAddress(address);
        if (parsed is null) return null;

        try
        {
            var client = _http.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(6);

            // Try exact house number + street + suburb first
            var where = $"suburb=\"{Escape(parsed.Suburb)}\" AND street_name=\"{Escape(parsed.Street)}\" AND house_number=\"{Escape(parsed.HouseNumber)}\"";
            var day = await QueryDay(client, where);
            if (day is not null) return new BinDayResult(day.Value, "BCC", "bcc-opendata-address");

            // Fall back to street-level — most streets have a single collection day
            where = $"suburb=\"{Escape(parsed.Suburb)}\" AND street_name=\"{Escape(parsed.Street)}\"";
            day = await QueryDay(client, where);
            if (day is not null) return new BinDayResult(day.Value, "BCC", "bcc-opendata-street");

            // Final fall-back: whole suburb (some suburbs are split; majority rules)
            where = $"suburb=\"{Escape(parsed.Suburb)}\"";
            day = await QueryDay(client, where);
            if (day is not null) return new BinDayResult(day.Value, "BCC", "bcc-opendata-suburb");
        }
        catch (Exception ex)
        {
            _log.LogInformation(ex, "BCC bin-day lookup failed for '{Address}'", address);
        }
        return null;
    }

    private async Task<int?> QueryDay(HttpClient client, string where)
    {
        // Group by collection_day and pick the mode (most common day in the match set)
        var url = $"{Base}?select=collection_day,count(*)%20as%20c&group_by=collection_day&where={WebUtility.UrlEncode(where)}&limit=10";
        var res = await client.GetAsync(url);
        if (!res.IsSuccessStatusCode) return null;
        var json = await res.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("results", out var results)) return null;

        string? top = null; long max = 0;
        foreach (var r in results.EnumerateArray())
        {
            if (!r.TryGetProperty("collection_day", out var d) || d.ValueKind != JsonValueKind.String) continue;
            if (!r.TryGetProperty("c", out var cEl)) continue;
            var c = cEl.ValueKind == JsonValueKind.Number ? cEl.GetInt64() : 0;
            if (c > max) { max = c; top = d.GetString(); }
        }
        return top is null ? null : ParseDay(top);
    }

    public static string Escape(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");

    /// <summary>Parse "12 Beaudesert Rd, Moorooka QLD 4105, Australia" (including unit/lettered/ranged numbers) → (12, "BEAUDESERT RD", "MOOROOKA").</summary>
    public static ParsedAddress? ParseAddress(string address)
    {
        // Strip trailing ", Australia" and postcode / state tails
        var parts = address.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length < 2) return null;

        // First part is normally "12 Beaudesert Rd", "2/12 Beaudesert Rd", "Unit 2/12 Beaudesert Rd",
        // "12A Beaudesert Rd", or "12-14 Beaudesert Rd". For 3-part addresses like
        // "Unit 2, 12 Beaudesert Rd, Moorooka QLD 4105", parts[0] is the unit/building and parts[1] is the street.
        var streetParsed = TryParseStreetSegment(parts[0]);
        var suburbPart = parts[1];
        if (streetParsed is null && parts.Length >= 3)
        {
            streetParsed = TryParseStreetSegment(parts[1]);
            suburbPart = parts[2];
        }
        if (streetParsed is null) return null;

        var (houseNum, streetName) = streetParsed.Value;

        // Suburb: usually second part (or third when parts[0] was unit/building).
        var suburb = Regex.Replace(suburbPart, @"\b(QLD|NSW|VIC|SA|WA|TAS|NT|ACT|QUEENSLAND|AUSTRALIA)\b.*$", "", RegexOptions.IgnoreCase).Trim();
        suburb = Regex.Replace(suburb, @"\s+\d{4}\s*$", "").Trim();
        suburb = suburb.ToUpperInvariant();

        if (string.IsNullOrWhiteSpace(streetName) || string.IsNullOrWhiteSpace(suburb) || string.IsNullOrWhiteSpace(houseNum))
            return null;

        return new ParsedAddress(houseNum, streetName, suburb);
    }

    private static (string HouseNumber, string Street)? TryParseStreetSegment(string rawSegment)
    {
        var s = rawSegment.Trim();
        if (string.IsNullOrEmpty(s)) return null;

        // Strip slash-style unit prefixes: "2/12 ...", "2A/12 ...", "Unit 2/12 ...", "U2 / 12 ..."
        s = Regex.Replace(
            s,
            @"^(?:(?:unit|apt|apartment|flat|shop|lot|villa|townhouse|suite|u)\s*)?[A-Za-z0-9\-]+\s*/\s*",
            "",
            RegexOptions.IgnoreCase);

        // Strip space-style unit prefixes: "Unit 2 12 ...", "Flat 3B 12 ..."
        s = Regex.Replace(
            s,
            @"^(?:unit|apt|apartment|flat|shop|lot|villa|townhouse|suite)\s+[A-Za-z0-9\-]+\s+",
            "",
            RegexOptions.IgnoreCase);

        // Match primary house number (with optional letter suffix like 12A and optional range like 12-14) + street
        var m = Regex.Match(s, @"^(?<num>\d+[A-Za-z]?)(?:\s*[-–]\s*\d+[A-Za-z]?)?\s+(?<street>[A-Za-z].+)$");
        if (!m.Success) return null;

        var houseNum = m.Groups["num"].Value.ToUpperInvariant();
        var streetName = NormaliseStreet(m.Groups["street"].Value);
        if (string.IsNullOrWhiteSpace(houseNum) || string.IsNullOrWhiteSpace(streetName))
            return null;

        return (houseNum, streetName);
    }

    /// <summary>
    /// Photon often labels city/municipality as Brisbane or City of Brisbane.
    /// That must never be a density cluster — city-wide totals do not unlock a run.
    /// ("Brisbane City" CBD 4000 remains a valid suburb.)
    /// </summary>
    public static string? CanonicalSuburb(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var s = raw.Trim().ToUpperInvariant();
        if (s is "BRISBANE" or "CITY OF BRISBANE" or "BRISBANE CITY COUNCIL" or "GREATER BRISBANE" or "QLD" or "QUEENSLAND" or "AUSTRALIA")
            return null;
        return s;
    }

    private static string NormaliseStreet(string s)
    {
        s = s.Trim().ToUpperInvariant();
        // BCC data uses abbreviated street types (RD, ST, AVE, CRCT etc). Map common full words.
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

    private static int? ParseDay(string s) => s.Trim().ToUpperInvariant() switch
    {
        "SUNDAY" => 0, "MONDAY" => 1, "TUESDAY" => 2, "WEDNESDAY" => 3,
        "THURSDAY" => 4, "FRIDAY" => 5, "SATURDAY" => 6, _ => null,
    };
}

public record BinDayResult(int DayOfWeek, string CouncilArea, string Source);
public record ParsedAddress(string HouseNumber, string Street, string Suburb);
