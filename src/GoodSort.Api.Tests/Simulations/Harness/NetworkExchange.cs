using System.Text.Json.Serialization;

namespace GoodSort.Api.Tests.Simulations.Harness;

/// <summary>
/// Verbatim capture of a single HTTP network exchange during simulation.
/// </summary>
public class NetworkExchange
{
    public DateTime Timestamp { get; set; }
    public string Method { get; set; } = "";
    public string Url { get; set; } = "";
    public string Path { get; set; } = "";
    public Dictionary<string, string> RequestHeaders { get; set; } = new();
    public string? RequestBody { get; set; }
    public int StatusCode { get; set; }
    public string StatusDescription { get; set; } = "";
    public Dictionary<string, string> ResponseHeaders { get; set; } = new();
    public string? ResponseBody { get; set; }
    public long DurationMs { get; set; }
}
