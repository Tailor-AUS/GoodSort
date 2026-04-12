using System.ClientModel;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Azure.AI.OpenAI;
using OpenAI.Chat;

namespace GoodSort.Api.Services;

public class VisionService
{
    private readonly IConfiguration _config;
    private readonly ILogger<VisionService> _logger;
    private readonly IHttpClientFactory _httpFactory;

    public VisionService(IConfiguration config, ILogger<VisionService> logger, IHttpClientFactory httpFactory)
    {
        _config = config;
        _logger = logger;
        _httpFactory = httpFactory;
    }

    public async Task<List<IdentifiedContainer>> IdentifyContainers(string base64Image)
    {
        // Tailor Vision (TV) takes priority, Azure OpenAI as fallback
        var tvApiKey = _config["TAILOR_VISION_API_KEY"] ?? "";

        if (!string.IsNullOrEmpty(tvApiKey))
            return await IdentifyViaTailorVision(base64Image);

        return await IdentifyViaAzureOpenAI(base64Image);
    }

    // ── Tailor Vision API (api.tailor.au/api/vision/classify) ─────────────

    private async Task<List<IdentifiedContainer>> IdentifyViaTailorVision(string base64Image)
    {
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
                _logger.LogInformation("Falling back to Azure OpenAI");
                return await IdentifyViaAzureOpenAI(base64Image);
            }

            var responseJson = await response.Content.ReadAsStringAsync();
            var tvResponse = JsonSerializer.Deserialize<TailorVisionResponse>(responseJson, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });

            if (tvResponse?.Classification == null)
            {
                _logger.LogWarning("Tailor Vision returned null classification");
                return [];
            }

            _logger.LogInformation(
                "Tailor Vision classified: {Description} ({Material}, confidence={Confidence})",
                tvResponse.Classification.Description,
                tvResponse.Classification.Material,
                tvResponse.Classification.Confidence);

            // Map Tailor Vision response to GoodSort's IdentifiedContainer
            var container = new IdentifiedContainer
            {
                Name = tvResponse.Classification.Description,
                Material = MapMaterial(tvResponse.Classification.Material),
                Count = 1,
                Eligible = tvResponse.Cds?.Eligible ?? false,
                Confidence = tvResponse.Classification.Confidence,
                Barcode = tvResponse.Barcode?.Value,
            };

            return [container];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Tailor Vision API call failed — falling back to Azure");
            return await IdentifyViaAzureOpenAI(base64Image);
        }
    }

    /// <summary>
    /// Map Tailor Vision material names to GoodSort's 4-bag system.
    /// </summary>
    private static string MapMaterial(string tvMaterial) => tvMaterial.ToLower() switch
    {
        "aluminium" => "aluminium",
        "pet" => "pet",
        "glass" => "glass",
        "hdpe" => "other",
        "liquid_paperboard" => "other",
        _ => "other",
    };

    // ── Azure OpenAI — Direct fallback ────────────────────────────────────

    private static readonly string ContainerPrompt = @"You are a container recycling identification system for the QLD Container Refund Scheme (Containers for Change).

Analyze this photo and identify ALL beverage containers visible. Count each distinct container type.

For each container type found, return:
- name: product name and size (e.g. ""Coca-Cola 375ml can"", ""Mount Franklin 600ml bottle"")
- material: one of ""aluminium"", ""pet"", ""glass"", ""liquid_paperboard""
- count: how many of this exact item you see in the photo
- eligible: true if it's a beverage container between 150ml and 3L

Material classification rules:
- aluminium: metal cans (beer cans, soft drink cans, energy drink cans, premix cans)
- pet: plastic bottles (water bottles, soft drink bottles, juice bottles)
- glass: glass bottles (beer stubbies, wine bottles, spirit bottles)
- liquid_paperboard: cartons/poppers (juice boxes, flavoured milk cartons)

If you cannot identify the specific product, describe what you see (e.g. ""silver aluminium can 375ml"").
Only include items that are beverage containers. Ignore food, packaging, or non-container items.

Return ONLY a JSON array, no explanation or markdown. Example:
[{""name"":""Coca-Cola 375ml can"",""material"":""aluminium"",""count"":3,""eligible"":true},{""name"":""Mount Franklin 600ml bottle"",""material"":""pet"",""count"":2,""eligible"":true}]

If no containers are found, return: []";

    private async Task<List<IdentifiedContainer>> IdentifyViaAzureOpenAI(string base64Image)
    {
        var endpoint = _config["AZURE_OPENAI_ENDPOINT"] ?? "";
        var apiKey = _config["AZURE_OPENAI_KEY"] ?? "";
        var deploymentName = _config["AZURE_OPENAI_DEPLOYMENT"] ?? "gpt-4.1";

        if (string.IsNullOrEmpty(apiKey))
        {
            _logger.LogWarning("No vision API configured — returning mock data");
            return [new IdentifiedContainer { Name = "Unknown Container", Material = "aluminium", Count = 1, Eligible = true }];
        }

        try
        {
            var client = new AzureOpenAIClient(new Uri(endpoint), new ApiKeyCredential(apiKey));
            var chatClient = client.GetChatClient(deploymentName);

            var imageContent = ChatMessageContentPart.CreateImagePart(
                BinaryData.FromBytes(Convert.FromBase64String(base64Image)),
                "image/jpeg"
            );
            var promptPart = ChatMessageContentPart.CreateTextPart(ContainerPrompt);

            var messages = new List<ChatMessage>
            {
                new UserChatMessage(promptPart, imageContent)
            };

            _logger.LogInformation("Calling Azure OpenAI directly (fallback path)");
            var response = await chatClient.CompleteChatAsync(messages);
            var content = response.Value.Content[0].Text.Trim();

            // Strip markdown code fences if present
            if (content.StartsWith("```"))
            {
                content = content.Split('\n', 2).Length > 1 ? content.Split('\n', 2)[1] : content;
                if (content.EndsWith("```")) content = content[..^3];
                content = content.Trim();
            }

            var containers = JsonSerializer.Deserialize<List<IdentifiedContainer>>(content, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });

            _logger.LogInformation("Azure OpenAI identified {Count} container types", containers?.Count ?? 0);
            return containers ?? [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Azure OpenAI call failed");
            return [];
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

// ── GoodSort container result ─────────────────────────────────────────

public class IdentifiedContainer
{
    public string Name { get; set; } = "";
    public string Material { get; set; } = "aluminium";
    public int Count { get; set; } = 1;
    public bool Eligible { get; set; } = true;
    public double Confidence { get; set; }
    public string? Barcode { get; set; }
}
