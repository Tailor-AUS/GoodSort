using System.ClientModel;
using System.Text.Json;
using Azure.AI.OpenAI;
using OpenAI.Chat;

namespace GoodSort.Api.Services;

public class VisionService
{
    private readonly IConfiguration _config;
    private readonly ILogger<VisionService> _logger;

    public VisionService(IConfiguration config, ILogger<VisionService> logger)
    {
        _config = config;
        _logger = logger;
    }

    public async Task<List<IdentifiedContainer>> IdentifyContainers(string base64Image)
    {
        var endpoint = _config["AZURE_OPENAI_ENDPOINT"] ?? "https://oai-tailor-app-prod.openai.azure.com/";
        var apiKey = _config["AZURE_OPENAI_KEY"] ?? "";
        var deploymentName = _config["AZURE_OPENAI_DEPLOYMENT"] ?? "gpt-4.1";

        if (string.IsNullOrEmpty(apiKey))
        {
            _logger.LogWarning("AZURE_OPENAI_KEY not set — returning mock data");
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

            var prompt = ChatMessageContentPart.CreateTextPart(@"You are a container recycling identification system for the QLD Container Refund Scheme (Containers for Change).

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

If no containers are found, return: []");

            var messages = new List<ChatMessage>
            {
                new UserChatMessage(prompt, imageContent)
            };

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

            _logger.LogInformation("Vision identified {Count} container types from photo", containers?.Count ?? 0);
            return containers ?? [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Vision API call failed");
            return [];
        }
    }
}

public class IdentifiedContainer
{
    public string Name { get; set; } = "";
    public string Material { get; set; } = "aluminium";
    public int Count { get; set; } = 1;
    public bool Eligible { get; set; } = true;
}
