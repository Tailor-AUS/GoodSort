using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace GoodSort.Api.Services;

/// <summary>
/// Looks up the day of the week (0=Sun..6=Sat) that a given address has its
/// yellow recycling bin collected, using Brisbane City Council's open data
/// portal (OpenDataSoft). For addresses outside BCC we fall through to null
/// and the UI asks the user to pick manually.
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
        // Rough BCC bounding box; outside of this we don't have data
        if (lat < -27.75 || lat > -27.20 || lng < 152.70 || lng > 153.30)
            return null;
        if (string.IsNullOrWhiteSpace(address)) return null;

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

    private static string Escape(string s) => s.Replace("\"", "\\\"");

    /// <summary>Parse "12 Beaudesert Rd, Moorooka QLD 4105, Australia" → (12, "BEAUDESERT RD", "MOOROOKA").</summary>
    internal static ParsedAddress? ParseAddress(string address)
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
        var suburb = Regex.Replace(suburbPart, @"\b(QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\b.*$", "", RegexOptions.IgnoreCase).Trim();
        suburb = suburb.ToUpperInvariant();

        if (string.IsNullOrWhiteSpace(streetName) || string.IsNullOrWhiteSpace(suburb) || string.IsNullOrWhiteSpace(houseNum))
            return null;

        return new ParsedAddress(houseNum, streetName, suburb);
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
internal record ParsedAddress(string HouseNumber, string Street, string Suburb);
