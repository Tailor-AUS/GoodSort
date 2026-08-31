using System.ClientModel;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Azure.AI.OpenAI;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using OpenAI.Chat;

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
        // Tailor Vision (TV) takes priority; LLM fallback routes via Sovrgn
        // when configured, then Azure OpenAI.
        var tvApiKey = _config["TAILOR_VISION_API_KEY"] ?? "";

        if (!string.IsNullOrEmpty(tvApiKey))
            return await IdentifyViaTailorVision(base64Image, userId);

        return await IdentifyViaLlmFallback(base64Image, userId);
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

    // ── Tailor Vision API (api.tailor.au/api/vision/classify) ─────────────

    private async Task<VisionResult> IdentifyViaTailorVision(string base64Image, Guid? userId)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            var client = _httpFactory.CreateClient("TailorVision");

            // Strip data URI prefix if present to get raw base64
            var rawBase64 = base64Image.Contains(",")
                ? base64Image.Split(',')[1]
                : base64Image;

            // Use multipart upload (recommended by Tailor Vision)
            var imageBytes = Convert.FromBase64String(rawBase64);
            var formContent = new MultipartFormDataContent();
            var fileContent = new ByteArrayContent(imageBytes);
            fileContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/jpeg");
            formContent.Add(fileContent, "file", "scan.jpg");

            _logger.LogInformation("Calling Tailor Vision API (multipart upload)");
            var response = await client.PostAsync("/api/vision/classify/upload", formContent);

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                _logger.LogWarning("Tailor Vision returned {Status}: {Body}", (int)response.StatusCode, errorBody);
                await LogCall("tailor", success: false, containerCount: 0, sw.ElapsedMilliseconds, userId,
                    errorSummary: $"HTTP {(int)response.StatusCode}: {errorBody}");
                _logger.LogInformation("Falling back to Azure OpenAI");
                return await IdentifyViaLlmFallback(base64Image, userId);
            }

            var responseJson = await response.Content.ReadAsStringAsync();
            var tvResponse = JsonSerializer.Deserialize<TailorVisionResponse>(responseJson, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });

            if (tvResponse?.Classification == null)
            {
                _logger.LogWarning("Tailor Vision returned null classification");
                await LogCall("tailor", success: true, containerCount: 0, sw.ElapsedMilliseconds, userId);
                return new VisionResult { Message = "Hmm, couldn't quite figure that one out. Try a clearer photo!" };
            }

            _logger.LogInformation(
                "Tailor Vision classified: {Description} ({Material}, confidence={Confidence})",
                tvResponse.Classification.Description,
                tvResponse.Classification.Material,
                tvResponse.Classification.Confidence);

            var container = new IdentifiedContainer
            {
                Name = tvResponse.Classification.Description,
                Material = MapMaterial(tvResponse.Classification.Material),
                Count = 1,
                Eligible = tvResponse.Cds?.Eligible ?? false,
                Confidence = tvResponse.Classification.Confidence,
                Barcode = tvResponse.Barcode?.Value,
            };

            var msg = container.Eligible
                ? $"Found a {container.Name} 🎉"
                : $"Spotted a {container.Name}, but it's not CDS eligible unfortunately.";

            await LogCall("tailor", success: true, containerCount: 1, sw.ElapsedMilliseconds, userId);
            return new VisionResult { Containers = [container], Message = msg };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Tailor Vision API call failed — falling back to Azure");
            await LogCall("tailor", success: false, containerCount: 0, sw.ElapsedMilliseconds, userId,
                errorSummary: ex.Message);
            return await IdentifyViaLlmFallback(base64Image, userId);
        }
    }

    /// <summary>
    /// Map Tailor Vision material names to GoodSort's material system.
    /// </summary>
    private static string MapMaterial(string tvMaterial) => tvMaterial.ToLower() switch
    {
        "aluminium" => "aluminium",
        "pet" => "pet",
        "glass" => "glass",
        "steel" => "steel",
        "hdpe" => "hdpe",
        "liquid_paperboard" => "liquid_paperboard",
        _ => "other",
    };

    // ── LLM fallback: Sovrgn (preferred) → Azure OpenAI ───────────────────

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

Material classification rules:
- aluminium: metal cans (beer cans, soft drink cans, energy drink cans, premix cans)
- pet: plastic bottles (water bottles, soft drink bottles, juice bottles)
- glass: glass bottles (beer stubbies, wine bottles, spirit bottles)
- liquid_paperboard: cartons/poppers (juice boxes, flavoured milk cartons)

If you cannot identify the specific product, describe what you see (e.g. ""silver aluminium can 375ml"").

MESSAGE GUIDELINES:
- If containers found: be encouraging, and NEVER mention money, cents, dollars or refunds. E.g. ""Nice haul! 3 cans ready to sort."" or ""Spotted some VB stubbies — classic choice, even better recycled.
- If no containers but you can see what's in the photo: be witty and Australian. E.g.:
  - Person/selfie: ""Looking good, but I can't recycle you! Try pointing the camera at a can or bottle.""
  - Food: ""That looks delicious but I'm more of a cans-and-bottles sort of AI. Show me your empties!""
  - Pet/animal: ""What a legend! But I can only sort containers, not critters. Got any cans nearby?""
  - Scenery/nature: ""Beautiful spot! If you've got any empties from enjoying the view, point the camera at those.""
  - Random object: ""Interesting! But that's not quite what I'm after. I'm looking for cans, bottles or cartons.""
  - Blurry/dark: ""I can't quite make that out — try getting a bit closer with better lighting.""
- Keep messages under 30 words. Be warm, Aussie, and a little cheeky.
- NEVER state or imply any amount of money, cents, dollars or a refund value. The app shows the credit itself.

Return ONLY a JSON object, no explanation or markdown. Examples:

With containers:
{""containers"":[{""name"":""Coca-Cola 375ml can"",""material"":""aluminium"",""count"":3,""eligible"":true}],""message"":""3 Coke cans spotted — nice one 🎉""}

No containers (selfie):
{""containers"":[],""message"":""Can't recycle you mate! Try pointing at a can or bottle 😄""}

No containers (food):
{""containers"":[],""message"":""Looks tasty! But I'm after the empties, not the snacks. Got any cans nearby?""}

No containers (blurry):
{""containers"":[],""message"":""Bit blurry — try getting closer with the camera steady. I'll sort it once I can see it!""}
";

    private async Task<VisionResult> IdentifyViaLlmFallback(string base64Image, Guid? userId)
    {
        // Direct Sovrgn consumers were revoked (TailorAU/tailor-app#5223).
        // A leftover SOVRGN_API_KEY must not be sent at api.sovrgn.ai.
        if (!string.IsNullOrEmpty(_config["SOVRGN_API_KEY"]))
        {
            _logger.LogWarning("SOVRGN_API_KEY is set but The Good Sort is not a Sovrgn consumer — using Azure OpenAI");
        }
        return await IdentifyViaAzureOpenAI(base64Image, userId);
    }

    private async Task<VisionResult> IdentifyViaAzureOpenAI(string base64Image, Guid? userId)
    {
        var endpoint = _config["AZURE_OPENAI_ENDPOINT"] ?? "";
        var apiKey = _config["AZURE_OPENAI_KEY"] ?? "";
        // gpt-5-mini, not gpt-4.1. infra/restore-secrets.sh says it plainly:
        // "gpt-5-mini is the only deployment in oai-tailor-app-prod verified to
        // work for the vision fallback (gpt-4.1 does not exist there)". The
        // default here named the one that does not exist.
        //
        // Harmless while the setting is present, and production does set it —
        // but `azd deploy` strips env vars, which is the whole reason
        // restore-secrets.sh exists. Lose this one and every photo scan falls
        // through to "Something went wrong analysing that photo", with the
        // cause buried in an Azure OpenAI 404. A fallback should name something
        // that exists.
        var deploymentName = _config["AZURE_OPENAI_DEPLOYMENT"] ?? VisionDefaults.OpenAiDeployment;

        if (string.IsNullOrEmpty(apiKey))
        {
            _logger.LogError("No vision API configured (neither Tailor Vision nor Azure OpenAI)");
            await LogCall("none", success: false, containerCount: 0, 0, userId,
                errorSummary: "No vision provider configured");
            return new VisionResult { Message = "Photo scan is temporarily unavailable. Please try again later." };
        }

        var client = new AzureOpenAIClient(new Uri(endpoint), new ApiKeyCredential(apiKey));
        var result = await RunChatVision(client.GetChatClient(deploymentName), "openai", base64Image, userId);
        return result ?? new VisionResult { Message = "Something went wrong analysing that photo. Give it another go!" };
    }

    // Shared chat-vision path for OpenAI-compatible providers (Azure OpenAI).
    // Returns null on failure; the failure is logged to VisionCalls under the
    // given provider name.
    private async Task<VisionResult?> RunChatVision(ChatClient chatClient, string provider, string base64Image, Guid? userId)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            // Defensively strip any data-URI prefix (the Tailor path does this too)
            // so Convert.FromBase64String doesn't choke on a "data:image/jpeg;..." head.
            var rawBase64 = base64Image.Contains(',') ? base64Image.Split(',')[1] : base64Image;
            var imageContent = ChatMessageContentPart.CreateImagePart(
                BinaryData.FromBytes(Convert.FromBase64String(rawBase64)),
                "image/jpeg"
            );
            var promptPart = ChatMessageContentPart.CreateTextPart(ContainerPrompt);

            var messages = new List<ChatMessage>
            {
                new UserChatMessage(promptPart, imageContent)
            };

            _logger.LogInformation("Calling {Provider} chat vision (fallback path)", provider);
            var response = await chatClient.CompleteChatAsync(messages);
            var content = response.Value.Content[0].Text.Trim();

            // Strip markdown code fences if present
            if (content.StartsWith("```"))
            {
                content = content.Split('\n', 2).Length > 1 ? content.Split('\n', 2)[1] : content;
                if (content.EndsWith("```")) content = content[..^3];
                content = content.Trim();
            }

            // New format returns { containers: [], message: "" }
            var result = JsonSerializer.Deserialize<VisionResult>(content, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });

            if (result != null)
            {
                _logger.LogInformation("{Provider} identified {Count} container types, message: {Message}",
                    provider, result.Containers.Count, result.Message);
                await LogCall(provider, success: true, containerCount: result.Containers.Sum(c => c.Count), sw.ElapsedMilliseconds, userId);
                return result;
            }

            // Fallback: try parsing as old format (plain array)
            var containers = JsonSerializer.Deserialize<List<IdentifiedContainer>>(content, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });

            _logger.LogInformation("{Provider} identified {Count} container types (legacy format)", provider, containers?.Count ?? 0);
            await LogCall(provider, success: true, containerCount: containers?.Sum(c => c.Count) ?? 0, sw.ElapsedMilliseconds, userId);
            return new VisionResult
            {
                Containers = containers ?? [],
                Message = containers?.Count > 0
                    ? $"Found {containers.Count} container{(containers.Count != 1 ? "s" : "")}!"
                    : "No containers spotted — try pointing the camera at a can or bottle!",
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "{Provider} chat vision call failed", provider);
            await LogCall(provider, success: false, containerCount: 0, sw.ElapsedMilliseconds, userId,
                errorSummary: ex.Message);
            return null;
        }
    }
}

// ── Tailor Vision API contract (api.tailor.au/api/vision/classify) ─────

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
