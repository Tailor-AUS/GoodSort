using System.Text.Json;

namespace GoodSort.Api.Services;

/// <summary>
/// Looks up the day of the week (0=Sun..6=Sat) that a given address has its
/// yellow recycling bin collected, along with the council area name.
///
/// Brisbane City Council publishes this as an ArcGIS FeatureService. Other SEQ
/// councils (Logan, Moreton Bay, Redland, Gold Coast) each have their own
/// endpoint; for now we only call BCC and fall through to a best-effort guess
/// based on postcode. Caller can always let the user override in onboarding.
/// </summary>
public class BinDayService
{
    private readonly IHttpClientFactory _http;
    private readonly ILogger<BinDayService> _log;

    public BinDayService(IHttpClientFactory http, ILogger<BinDayService> log)
    {
        _http = http;
        _log = log;
    }

    public async Task<BinDayResult?> Lookup(double lat, double lng, string? address = null)
    {
        // Rough BCC bounding box (covers metro Brisbane; callers outside fall through)
        if (lat < -27.75 || lat > -27.20 || lng < 152.70 || lng > 153.30)
            return await FallbackByPostcode(address);

        try
        {
            var client = _http.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(5);
            // BCC ArcGIS "General Waste Collection" feature service — point-in-polygon query
            // Returns a WasteCollectionDay attribute when the point falls in a collection zone.
            var url = "https://services.ccgis.brisbane.qld.gov.au/arcgis/rest/services/PUB/WasteCollectionDay/MapServer/0/query" +
                      $"?geometry={lng},{lat}&geometryType=esriGeometryPoint&inSR=4326" +
                      "&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json";
            var res = await client.GetAsync(url);
            if (!res.IsSuccessStatusCode)
            {
                _log.LogInformation("BCC bin-day lookup HTTP {Status} for {Lat},{Lng}", (int)res.StatusCode, lat, lng);
                return await FallbackByPostcode(address);
            }
            var json = await res.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("features", out var features) || features.GetArrayLength() == 0)
                return await FallbackByPostcode(address);

            var attrs = features[0].GetProperty("attributes");
            // Field names vary — try common ones
            string? dayName = null;
            foreach (var key in new[] { "DAY", "Day", "COLLECTIONDAY", "CollectionDay", "WasteCollectionDay", "WASTEDAY" })
            {
                if (attrs.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String)
                {
                    dayName = v.GetString();
                    break;
                }
            }
            if (dayName is null) return await FallbackByPostcode(address);

            var dow = ParseDay(dayName);
            if (dow is null) return await FallbackByPostcode(address);

            return new BinDayResult(dow.Value, "BCC", "brisbane-gis");
        }
        catch (Exception ex)
        {
            _log.LogInformation(ex, "BCC bin-day lookup failed for {Lat},{Lng}", lat, lng);
            return await FallbackByPostcode(address);
        }
    }

    private Task<BinDayResult?> FallbackByPostcode(string? address)
    {
        // Very rough: nothing reliable without a real lookup. Return null so the UI
        // shows the day picker and the user confirms manually.
        return Task.FromResult<BinDayResult?>(null);
    }

    private static int? ParseDay(string s) => s.Trim().ToLower() switch
    {
        "sunday" or "sun" => 0,
        "monday" or "mon" => 1,
        "tuesday" or "tue" or "tues" => 2,
        "wednesday" or "wed" => 3,
        "thursday" or "thu" or "thur" or "thurs" => 4,
        "friday" or "fri" => 5,
        "saturday" or "sat" => 6,
        _ => null,
    };
}

public record BinDayResult(int DayOfWeek, string CouncilArea, string Source);
