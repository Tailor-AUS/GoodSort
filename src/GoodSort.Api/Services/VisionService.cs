using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;

namespace GoodSort.Api.Services;

public class VisionService
{
    private readonly IConfiguration _config;
    private readonly ILogger<VisionService> _logger;
    private readonly IHttpClientFactory _httpFactory;
    private readonly GoodSortDbContext _db;

    public VisionService(IConfiguration config, ILogger<VisionService> logger, IHttpClientFactory httpFactory, GoodSortDbContext db)
    {
        _config = config;
        _logger = logger;
        _httpFactory = httpFactory;
        _db = db;
    }

    public async Task<VisionResult> IdentifyContainers(string base64Image, Guid? userId = null)
    {
        // Legacy Tailor Vision (/vision/classify/upload), Sovrgn, and Azure OpenAI
        // (/openai/deployments/...) are disabled under the runtime boundary without
        // making any network attempt. Only the documented https://api.aukus.si/v1/chat/completions
        // contract is permitted when explicitly configured.
        if (!string.IsNullOrEmpty(_config["TAILOR_VISION_API_KEY"])
            || !string.IsNullOrEmpty(_config["SOVRGN_API_KEY"])
            || !string.IsNullOrEmpty(_config["AZURE_OPENAI_KEY"])
            || !string.IsNullOrEmpty(_config["AZURE_OPENAI_ENDPOINT"]))
        {
            _logger.LogWarning("Legacy vision provider settings are disabled under the https://api.aukus.si/v1 runtime boundary.");
        }

        return await IdentifyViaAukusChatCompletions(base64Image, userId);
    }

    private async Task LogCall(string provider, bool success, int containerCount, long durationMs, Guid? userId, string? errorSummary = null)
    {
        try
        {
            _db.VisionCalls.Add(new VisionCall
            {
                Provider = provider,
                Success = success,
                ContainerCount = containerCount,
                DurationMs = (int)durationMs,
                UserId = userId,
                ErrorSummary = Truncate(errorSummary, 200),
            });
            await _db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to log vision call");
        }
    }

    private static string? Truncate(string? s, int max) =>
        string.IsNullOrEmpty(s) ? null : (s.Length <= max ? s : s[..max]);

    private static readonly string ContainerPrompt = @"You are a fun, friendly container recycling identification system for the QLD Container Refund Scheme (Containers for Change), called The Good Sort.

Analyze this photo and identify ALL beverage containers visible. Count each distinct container type.

ALWAYS return a JSON object with two fields:
1. ""containers"": array of identified containers
2. ""message"": a short, friendly message about what you see (ALWAYS include this, even if no containers found)

For each container in the array, include:
- name: product name and size (e.g. ""Coca-Cola 375ml can"", ""Mount Franklin 600ml bottle"")
- material: one of ""aluminium"", ""pet"", ""glass"", ""liquid_paperboard""
- count: how many of this exact item you see
- eligible: true if it's a beverage container between 150ml and 3L

Return ONLY a JSON object, no explanation or markdown.";

    private async Task<VisionResult> IdentifyViaAukusChatCompletions(string base64Image, Guid? userId)
    {
        var rawUrl = _config["AUKUS_API_URL"];
        var apiKey = (_config["AUKUS_API_KEY"] ?? "").Trim();
        var model = (_config["AUKUS_MODEL"] ?? _config["AZURE_OPENAI_DEPLOYMENT"] ?? VisionDefaults.OpenAiDeployment).Trim();

        if (string.IsNullOrEmpty(apiKey) || !AukusBoundary.TryParseBaseUri(rawUrl, out _))
        {
            _logger.LogError("No allowed vision API configured (requires exact AUKUS_API_URL=https://api.aukus.si/v1 and AUKUS_API_KEY)");
            await LogCall("none", success: false, containerCount: 0, 0, userId,
                errorSummary: "No vision provider configured");
            return new VisionResult { Message = "Photo scan is temporarily unavailable. Please try again later." };
        }

        var sw = Stopwatch.StartNew();
        try
        {
            var rawBase64 = base64Image.Contains(',') ? base64Image.Split(',', 2)[1] : base64Image;
            _ = Convert.FromBase64String(rawBase64);

            var requestUri = AukusBoundary.ChatCompletionsUri;
            if (!AukusBoundary.IsAllowedRequestUri(requestUri))
            {
                throw new InvalidOperationException($"Disallowed Aukus request URI: {requestUri}");
            }

            var payload = new
            {
                model,
                messages = new object[]
                {
                    new
                    {
                        role = "user",
                        content = new object[]
                        {
                            new { type = "text", text = ContainerPrompt },
                            new
                            {
                                type = "image_url",
                                image_url = new { url = $"data:image/jpeg;base64,{rawBase64}" },
                            },
                        },
                    },
                },
            };

            using var request = new HttpRequestMessage(HttpMethod.Post, requestUri)
            {
                Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

            var client = _httpFactory.CreateClient("AukusAi");
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseContentRead);

            var statusCode = (int)response.StatusCode;
            if (statusCode is >= 300 and < 400)
            {
                throw new InvalidOperationException($"Rejected HTTP {statusCode} redirect from {requestUri}.");
            }

            var responseBody = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Aukus chat completions returned {Status}: {Body}", statusCode, responseBody);
                await LogCall("aukus", success: false, containerCount: 0, sw.ElapsedMilliseconds, userId,
                    errorSummary: $"HTTP {statusCode}: {responseBody}");
                return new VisionResult { Message = "Something went wrong analysing that photo. Give it another go!" };
            }

            using var doc = JsonDocument.Parse(responseBody);
            var content = doc.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString()?
                .Trim() ?? "";

            if (content.StartsWith("```"))
            {
                content = content.Split('\n', 2).Length > 1 ? content.Split('\n', 2)[1] : content;
                if (content.EndsWith("```")) content = content[..^3];
                content = content.Trim();
            }

            var result = JsonSerializer.Deserialize<VisionResult>(content, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });

            if (result != null)
            {
                foreach (var c in result.Containers)
                {
                    c.Material = MapMaterial(c.Material);
                }
                await LogCall("aukus", success: true, containerCount: result.Containers.Sum(c => c.Count), sw.ElapsedMilliseconds, userId);
                return result;
            }

            await LogCall("aukus", success: false, containerCount: 0, sw.ElapsedMilliseconds, userId,
                errorSummary: "Empty or unparseable vision JSON");
            return new VisionResult { Message = "Something went wrong analysing that photo. Give it another go!" };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Aukus chat vision call failed");
            await LogCall("aukus", success: false, containerCount: 0, sw.ElapsedMilliseconds, userId,
                errorSummary: ex.Message);
            return new VisionResult { Message = "Something went wrong analysing that photo. Give it another go!" };
        }
    }

    private static string MapMaterial(string? rawMaterial) => (rawMaterial ?? "").Trim().ToLowerInvariant() switch
    {
        "aluminium" => "aluminium",
        "pet" => "pet",
        "glass" => "glass",
        "steel" => "steel",
        "hdpe" => "hdpe",
        "liquid_paperboard" => "liquid_paperboard",
        _ => "other",
    };
}

public class TailorVisionResponse
{
    public TailorVisionClassification? Classification { get; set; }
    public TailorVisionCds? Cds { get; set; }
    public TailorVisionBarcode? Barcode { get; set; }
}

public class TailorVisionClassification
{
    public string Material { get; set; } = "";
    public string ContainerType { get; set; } = "";
    public string Description { get; set; } = "";
    public string Bin { get; set; } = "";
    public double Confidence { get; set; }
}

public class TailorVisionCds
{
    public bool Eligible { get; set; }
    public decimal RefundValue { get; set; }
    public string Currency { get; set; } = "AUD";
    public List<string> Schemes { get; set; } = [];
}

public class TailorVisionBarcode
{
    public bool Detected { get; set; }
    public string? Value { get; set; }
    public bool CatalogueMatch { get; set; }
}

// ── Vision result (containers + message) ──────────────────────────────

public class VisionResult
{
    public List<IdentifiedContainer> Containers { get; set; } = [];

    private string _message = "";

    /// <summary>
    /// Model-authored text shown at the top of the results screen. The model
    /// must never author money copy: the scheme refund is 10c and the product
    /// credit is 5c, and conflating them would imply we pass through the
    /// Containers for Change refund. Any money-like token replaces the whole
    /// message with product-authored text rather than being redacted in place.
    /// </summary>
    public string Message
    {
        get => _message;
        set => _message = Sanitise(value);
    }

    private static readonly string[] MoneyWords = ["cent", "dollar", "refund", "$", "¢"];

    /// <summary>True if the text makes any money claim we have not authored.</summary>
    internal static bool LooksLikeMoney(string text)
    {
        foreach (var w in MoneyWords)
            if (text.Contains(w, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    public static string Sanitise(string? message)
    {
        if (string.IsNullOrWhiteSpace(message)) return "";
        return LooksLikeMoney(message)
            ? "Point the camera at cans or bottles to add them to your sort."
            : message;
    }
}

public class IdentifiedContainer
{
    public string Name { get; set; } = "";
    public string Material { get; set; } = "aluminium";
    public int Count { get; set; } = 1;
    public bool Eligible { get; set; } // default false: a malformed response must not mint credit
    public double Confidence { get; set; }
    public string? Barcode { get; set; }
}
