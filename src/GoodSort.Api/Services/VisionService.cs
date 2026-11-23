using System.ClientModel;
using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Azure.AI.OpenAI;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using OpenAI.Chat;

namespace GoodSort.Api.Services;

public class VisionService
{
    public const string PactHttpClientName = "PactVision";

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
        // Priority:
        //   1. Tailor Vision API (TAILOR_VISION_API_KEY) if configured
        //   2. PACT / Sovrgn OpenAI-compatible vision gateway (PACT_VISION_URL + PACT_VISION_API_KEY)
        //      — fail-closed when unset or malformed, falls back to Azure OpenAI on error/timeout
        //   3. Standalone Azure OpenAI (AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_KEY + AZURE_OPENAI_DEPLOYMENT)
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

            var container = NormalizeContainer(new IdentifiedContainer
            {
                Name = tvResponse.Classification.Description,
                Material = MapMaterial(tvResponse.Classification.Material),
                Count = 1,
                Eligible = tvResponse.Cds?.Eligible ?? false,
                Confidence = tvResponse.Classification.Confidence,
                Barcode = tvResponse.Barcode?.Value,
            });

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
    /// Map Tailor Vision and LLM material names to GoodSort's canonical material system.
    /// </summary>
    public static string MapMaterial(string? tvMaterial) => (tvMaterial ?? "").Trim().ToLowerInvariant() switch
    {
        "aluminium" or "aluminum" or "can" or "cans" or "alu" => "aluminium",
        "pet_coloured" or "pet_colored" or "coloured_pet" or "colored_pet" => "pet_coloured",
        "pet" or "pet_clear" or "clear_pet" or "plastic" => "pet",
        "glass" or "glass_clear" or "glass_brown" or "glass_green" => "glass",
        "steel" => "steel",
        "hdpe" => "hdpe",
        "liquid_paperboard" or "carton" or "popper" or "tetra_pak" => "liquid_paperboard",
        _ => "other",
    };

    public static string NormalizeContainerName(string? name)
    {
        var trimmed = (name ?? "").Trim();
        if (trimmed.Length == 0) return "Beverage container";
        return trimmed.Length <= 200 ? trimmed : trimmed[..200];
    }

    public static IdentifiedContainer NormalizeContainer(IdentifiedContainer c)
    {
        c.Name = NormalizeContainerName(c.Name);
        c.Material = MapMaterial(c.Material);
        c.Count = Math.Clamp(c.Count, 0, 100);
        if (!double.IsFinite(c.Confidence) || c.Confidence < 0 || c.Confidence > 1)
            c.Confidence = 0;
        if (!string.IsNullOrEmpty(c.Barcode))
            c.Barcode = Truncate(c.Barcode.Trim(), 64);
        return c;
    }

    // ── LLM fallback: PACT/Sovrgn gateway (opt-in, fail-closed) → Azure OpenAI ──

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

    private static readonly HashSet<string> NonReasoningFastModels = new(StringComparer.OrdinalIgnoreCase)
    {
        "gpt-4.1",
        "gpt-4.1-mini",
        "gpt-4.1-nano",
        "gpt-4o",
        "gpt-4o-mini",
        "tailor-brain",
        "au-inregion-gpt-41-mini",
        "au-inregion-gpt-4o",
        "gemini-2.5-flash-lite",
        "gemini-2.5-flash",
        "gemini-2.0-flash",
    };

    /// <summary>
    /// True when <paramref name="model"/> is a known non-reasoning vision model
    /// where a tight output token ceiling and low temperature are safe and speed up
    /// inference. Reasoning models (gpt-5*, o1/o3/o4) and capability aliases that
    /// may resolve to reasoning models (e.g. tailor-fast) return false so we never
    /// send an unsupported temperature or starve reasoning tokens.
    /// </summary>
    public static bool IsNonReasoningFastModel(string? model) =>
        !string.IsNullOrWhiteSpace(model) && NonReasoningFastModels.Contains(model.Trim());

    /// <summary>
    /// Validates and normalizes <c>PACT_VISION_URL</c> into an OpenAI-compatible
    /// <c>/v1/chat/completions</c> URI. Returns null (fail-closed) when missing,
    /// non-HTTP(S), or carrying embedded credentials.
    /// </summary>
    public static Uri? BuildPactChatCompletionsUri(string? rawUrl)
    {
        if (string.IsNullOrWhiteSpace(rawUrl))
            return null;

        if (!Uri.TryCreate(rawUrl.Trim(), UriKind.Absolute, out var baseUri))
            return null;

        if (baseUri.Scheme != Uri.UriSchemeHttps && baseUri.Scheme != Uri.UriSchemeHttp)
            return null;

        if (string.IsNullOrWhiteSpace(baseUri.Host) || !string.IsNullOrEmpty(baseUri.UserInfo))
            return null;

        var trimmed = baseUri.GetLeftPart(UriPartial.Path).TrimEnd('/');
        if (trimmed.EndsWith("/chat/completions", StringComparison.OrdinalIgnoreCase))
            return new Uri(trimmed);
        if (trimmed.EndsWith("/v1", StringComparison.OrdinalIgnoreCase))
            return new Uri($"{trimmed}/chat/completions");

        return new Uri($"{trimmed}/v1/chat/completions");
    }

    public static bool IsPactConfigured(IConfiguration config) =>
        !string.IsNullOrWhiteSpace(config["PACT_VISION_API_KEY"])
        && BuildPactChatCompletionsUri(config["PACT_VISION_URL"]) is not null;

    public static string ResolveImageDetail(string? configured) =>
        (configured ?? "").Trim().ToLowerInvariant() switch
        {
            "low" => "low",
            "high" => "high",
            "auto" => "auto",
            _ => VisionDefaults.ImageDetail,
        };

    public static ChatImageDetailLevel ResolveAzureImageDetail(string? configured) =>
        ResolveImageDetail(configured) switch
        {
            "high" => ChatImageDetailLevel.High,
            "auto" => ChatImageDetailLevel.Auto,
            _ => ChatImageDetailLevel.Low,
        };

    public static TimeSpan ResolveTimeout(IConfiguration config)
    {
        var seconds = int.TryParse(config["VISION_TIMEOUT_SECONDS"], out var parsed)
            ? parsed
            : VisionDefaults.TimeoutSeconds;
        return TimeSpan.FromSeconds(Math.Clamp(seconds, 3, 60));
    }

    public static ChatCompletionOptions BuildAzureChatOptions(string deploymentName)
    {
        var options = new ChatCompletionOptions
        {
            ResponseFormat = ChatResponseFormat.CreateJsonObjectFormat(),
        };

        if (IsNonReasoningFastModel(deploymentName))
        {
            options.MaxOutputTokenCount = VisionDefaults.NonReasoningMaxOutputTokens;
            options.Temperature = 0.2f;
        }

        return options;
    }

    public static string BuildPactChatPayload(string model, string base64Image, string imageDetail)
    {
        var dataUri = NormalizeImageDataUri(base64Image);
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("model", model);

            writer.WritePropertyName("messages");
            writer.WriteStartArray();
            writer.WriteStartObject();
            writer.WriteString("role", "user");
            writer.WritePropertyName("content");
            writer.WriteStartArray();

            writer.WriteStartObject();
            writer.WriteString("type", "text");
            writer.WriteString("text", ContainerPrompt);
            writer.WriteEndObject();

            writer.WriteStartObject();
            writer.WriteString("type", "image_url");
            writer.WritePropertyName("image_url");
            writer.WriteStartObject();
            writer.WriteString("url", dataUri);
            writer.WriteString("detail", ResolveImageDetail(imageDetail));
            writer.WriteEndObject();
            writer.WriteEndObject();

            writer.WriteEndArray();
            writer.WriteEndObject();
            writer.WriteEndArray();

            writer.WritePropertyName("response_format");
            writer.WriteStartObject();
            writer.WriteString("type", "json_object");
            writer.WriteEndObject();

            if (IsNonReasoningFastModel(model))
            {
                writer.WriteNumber("temperature", 0.2);
                writer.WriteNumber("max_tokens", VisionDefaults.NonReasoningMaxOutputTokens);
            }

            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(buffer.ToArray());
    }

    public static string? ExtractOpenAiCompletionText(string responseJson)
    {
        if (string.IsNullOrWhiteSpace(responseJson))
            return null;

        using var doc = JsonDocument.Parse(responseJson);
        if (!doc.RootElement.TryGetProperty("choices", out var choices)
            || choices.ValueKind != JsonValueKind.Array
            || choices.GetArrayLength() == 0)
        {
            return null;
        }

        var first = choices[0];
        if (!first.TryGetProperty("message", out var message)
            || message.ValueKind != JsonValueKind.Object
            || !message.TryGetProperty("content", out var content))
        {
            return null;
        }

        if (content.ValueKind == JsonValueKind.String)
            return content.GetString();

        if (content.ValueKind == JsonValueKind.Array)
        {
            var sb = new StringBuilder();
            foreach (var part in content.EnumerateArray())
            {
                if (part.ValueKind == JsonValueKind.Object
                    && part.TryGetProperty("text", out var text)
                    && text.ValueKind == JsonValueKind.String)
                {
                    if (sb.Length > 0) sb.Append('\n');
                    sb.Append(text.GetString());
                }
            }
            return sb.Length > 0 ? sb.ToString() : null;
        }

        return null;
    }

    private static string NormalizeImageDataUri(string base64Image)
    {
        var trimmed = (base64Image ?? "").Trim();
        var mime = "image/jpeg";
        var raw = trimmed;
        if (trimmed.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            var comma = trimmed.IndexOf(',');
            if (comma > 5)
            {
                var header = trimmed[5..comma];
                var semi = header.IndexOf(';');
                var parsedMime = (semi > 0 ? header[..semi] : header).Trim().ToLowerInvariant();
                if (parsedMime is "image/jpeg" or "image/png" or "image/webp")
                    mime = parsedMime;
                raw = trimmed[(comma + 1)..];
            }
        }
        // Validate base64 cleanly so malformed input never leaves our boundary.
        _ = Convert.FromBase64String(raw);
        return $"data:{mime};base64,{raw}";
    }

    private async Task<VisionResult> IdentifyViaLlmFallback(string base64Image, Guid? userId)
    {
        // Legacy direct Sovrgn consumer keys were revoked (TailorAU/tailor-app#5223).
        // A leftover SOVRGN_API_KEY must never be sent or promoted to PACT_VISION_API_KEY.
        if (!string.IsNullOrEmpty(_config["SOVRGN_API_KEY"]))
        {
            _logger.LogWarning("SOVRGN_API_KEY is set but revoked (TailorAU/tailor-app#5223) — ignoring legacy key");
        }

        // Opt-in PACT / Sovrgn OpenAI-compatible vision router (fail-closed when unset/invalid).
        var pactApiKey = (_config["PACT_VISION_API_KEY"] ?? "").Trim();
        var pactRawUrl = _config["PACT_VISION_URL"];
        if (!string.IsNullOrEmpty(pactApiKey))
        {
            var pactUri = BuildPactChatCompletionsUri(pactRawUrl);
            if (pactUri is null)
            {
                _logger.LogWarning("PACT_VISION_API_KEY is set but PACT_VISION_URL is missing or invalid — fail-closed, falling back to Azure OpenAI");
            }
            else
            {
                var pactModel = string.IsNullOrWhiteSpace(_config["PACT_VISION_MODEL"])
                    ? VisionDefaults.PactModel
                    : _config["PACT_VISION_MODEL"]!.Trim();
                var pactResult = await IdentifyViaPactGateway(pactUri, pactApiKey, pactModel, base64Image, userId);
                if (pactResult is not null)
                    return pactResult;

                _logger.LogInformation("PACT vision gateway failed — falling back to standalone Azure OpenAI");
            }
        }

        return await IdentifyViaAzureOpenAI(base64Image, userId);
    }

    private async Task<VisionResult?> IdentifyViaPactGateway(
        Uri endpointUri,
        string apiKey,
        string model,
        string base64Image,
        Guid? userId)
    {
        var sw = Stopwatch.StartNew();
        var timeout = ResolveTimeout(_config);
        var imageDetail = ResolveImageDetail(_config["VISION_IMAGE_DETAIL"]);
        try
        {
            var payload = BuildPactChatPayload(model, base64Image, imageDetail);
            var client = _httpFactory.CreateClient(PactHttpClientName);

            using var request = new HttpRequestMessage(HttpMethod.Post, endpointUri)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json"),
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            request.Headers.TryAddWithoutValidation("X-Sovrgn-Tenant", "goodsort");

            using var cts = new CancellationTokenSource(timeout);
            _logger.LogInformation("Calling PACT vision gateway ({Host}, model={Model}, detail={Detail}, timeout={TimeoutSec}s)",
                endpointUri.Host, model, imageDetail, (int)timeout.TotalSeconds);

            using var response = await client.SendAsync(request, cts.Token);
            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync(cts.Token);
                _logger.LogWarning("PACT vision gateway returned HTTP {Status} in {ElapsedMs}ms: {Body}",
                    (int)response.StatusCode, sw.ElapsedMilliseconds, Truncate(errorBody, 200));
                await LogCall("pact", success: false, containerCount: 0, sw.ElapsedMilliseconds, userId,
                    errorSummary: $"HTTP {(int)response.StatusCode}: {errorBody}");
                return null;
            }

            var responseJson = await response.Content.ReadAsStringAsync(cts.Token);
            var servedModel = response.Headers.TryGetValues("X-Sovrgn-Model", out var mVals) ? mVals.FirstOrDefault() : null;
            var servedRegion = response.Headers.TryGetValues("X-Sovrgn-Region", out var rVals) ? rVals.FirstOrDefault() : null;
            var servedProcessing = response.Headers.TryGetValues("X-Sovrgn-Processing", out var pVals) ? pVals.FirstOrDefault() : null;

            var text = ExtractOpenAiCompletionText(responseJson);
            if (string.IsNullOrWhiteSpace(text))
            {
                _logger.LogWarning("PACT vision gateway returned empty content in {ElapsedMs}ms (servedModel={ServedModel})",
                    sw.ElapsedMilliseconds, servedModel ?? model);
                await LogCall("pact", success: false, containerCount: 0, sw.ElapsedMilliseconds, userId,
                    errorSummary: "Empty completion content");
                return null;
            }

            var parsed = ParseChatVisionJson(text);
            if (parsed is null)
            {
                await LogCall("pact", success: false, containerCount: 0, sw.ElapsedMilliseconds, userId,
                    errorSummary: "Unparseable completion JSON");
                return null;
            }

            _logger.LogInformation(
                "PACT vision identified {Count} container types in {ElapsedMs}ms (servedModel={ServedModel}, region={Region}, processing={Processing})",
                parsed.Containers.Count, sw.ElapsedMilliseconds,
                servedModel ?? model, servedRegion ?? "unknown", servedProcessing ?? "unknown");
            await LogCall("pact", success: true, containerCount: parsed.Containers.Sum(c => c.Count), sw.ElapsedMilliseconds, userId);
            return parsed;
        }
        catch (OperationCanceledException)
        {
            _logger.LogWarning("PACT vision gateway timed out after {TimeoutSec}s ({ElapsedMs}ms)",
                (int)timeout.TotalSeconds, sw.ElapsedMilliseconds);
            await LogCall("pact", success: false, containerCount: 0, sw.ElapsedMilliseconds, userId,
                errorSummary: $"Timeout after {(int)timeout.TotalSeconds}s");
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PACT vision gateway call failed in {ElapsedMs}ms", sw.ElapsedMilliseconds);
            await LogCall("pact", success: false, containerCount: 0, sw.ElapsedMilliseconds, userId,
                errorSummary: ex.Message);
            return null;
        }
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
        var deploymentName = string.IsNullOrWhiteSpace(_config["AZURE_OPENAI_DEPLOYMENT"])
            ? VisionDefaults.OpenAiDeployment
            : _config["AZURE_OPENAI_DEPLOYMENT"]!.Trim();

        if (string.IsNullOrWhiteSpace(apiKey)
            || !Uri.TryCreate(endpoint, UriKind.Absolute, out var endpointUri)
            || (endpointUri.Scheme != Uri.UriSchemeHttps && endpointUri.Scheme != Uri.UriSchemeHttp))
        {
            _logger.LogError("No valid vision API configured (neither Tailor Vision, PACT gateway, nor valid Azure OpenAI endpoint/key)");
            await LogCall("none", success: false, containerCount: 0, 0, userId,
                errorSummary: "No vision provider configured");
            return new VisionResult { Message = "Photo scan is temporarily unavailable. Please try again later." };
        }

        var client = new AzureOpenAIClient(endpointUri, new ApiKeyCredential(apiKey));
        var result = await RunChatVision(client.GetChatClient(deploymentName), "openai", deploymentName, base64Image, userId);
        return result ?? new VisionResult { Message = "Something went wrong analysing that photo. Give it another go!" };
    }

    // Shared chat-vision path for OpenAI-compatible providers (Azure OpenAI).
    // Returns null on failure; the failure is logged to VisionCalls under the
    // given provider name.
    private async Task<VisionResult?> RunChatVision(
        ChatClient chatClient,
        string provider,
        string deploymentName,
        string base64Image,
        Guid? userId)
    {
        var sw = Stopwatch.StartNew();
        var timeout = ResolveTimeout(_config);
        var detail = ResolveAzureImageDetail(_config["VISION_IMAGE_DETAIL"]);
        try
        {
            // Defensively strip any data-URI prefix (the Tailor path does this too)
            // so Convert.FromBase64String doesn't choke on a "data:image/jpeg;..." head.
            var rawBase64 = base64Image.Contains(',') ? base64Image.Split(',')[1] : base64Image;
            var imageContent = ChatMessageContentPart.CreateImagePart(
                BinaryData.FromBytes(Convert.FromBase64String(rawBase64)),
                "image/jpeg",
                detail
            );
            var promptPart = ChatMessageContentPart.CreateTextPart(ContainerPrompt);

            var messages = new List<ChatMessage>
            {
                new UserChatMessage(promptPart, imageContent)
            };

            var options = BuildAzureChatOptions(deploymentName);
            using var cts = new CancellationTokenSource(timeout);

            _logger.LogInformation("Calling {Provider} chat vision (deployment={Deployment}, detail={Detail}, timeout={TimeoutSec}s)",
                provider, deploymentName, detail, (int)timeout.TotalSeconds);
            var response = await chatClient.CompleteChatAsync(messages, options, cts.Token);
            if (response.Value.Content.Count == 0 || string.IsNullOrWhiteSpace(response.Value.Content[0].Text))
            {
                await LogCall(provider, success: true, containerCount: 0, sw.ElapsedMilliseconds, userId);
                return new VisionResult
                {
                    Containers = [],
                    Message = "I couldn't quite make that out — try getting closer with better lighting.",
                };
            }
            var parsed = ParseChatVisionJson(response.Value.Content[0].Text);
            if (parsed != null)
            {
                _logger.LogInformation("{Provider} ({Deployment}) identified {Count} container types in {ElapsedMs}ms, message: {Message}",
                    provider, deploymentName, parsed.Containers.Count, sw.ElapsedMilliseconds, parsed.Message);
                await LogCall(provider, success: true, containerCount: parsed.Containers.Sum(c => c.Count), sw.ElapsedMilliseconds, userId);
                return parsed;
            }

            await LogCall(provider, success: true, containerCount: 0, sw.ElapsedMilliseconds, userId);
            return new VisionResult
            {
                Containers = [],
                Message = "No containers spotted — try pointing the camera at a can or bottle!",
            };
        }
        catch (OperationCanceledException)
        {
            _logger.LogWarning("{Provider} ({Deployment}) chat vision timed out after {TimeoutSec}s ({ElapsedMs}ms)",
                provider, deploymentName, (int)timeout.TotalSeconds, sw.ElapsedMilliseconds);
            await LogCall(provider, success: false, containerCount: 0, sw.ElapsedMilliseconds, userId,
                errorSummary: $"Timeout after {(int)timeout.TotalSeconds}s");
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "{Provider} ({Deployment}) chat vision call failed in {ElapsedMs}ms",
                provider, deploymentName, sw.ElapsedMilliseconds);
            await LogCall(provider, success: false, containerCount: 0, sw.ElapsedMilliseconds, userId,
                errorSummary: ex.Message);
            return null;
        }
    }

    public static VisionResult? ParseChatVisionJson(string? rawContent)
    {
        if (string.IsNullOrWhiteSpace(rawContent)) return null;
        var content = rawContent.Trim();

        // Strip markdown code fences if present
        if (content.StartsWith("```"))
        {
            content = content.Split('\n', 2).Length > 1 ? content.Split('\n', 2)[1] : content;
            if (content.EndsWith("```")) content = content[..^3];
            content = content.Trim();
        }

        var jsonOpts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };

        // Legacy plain-array format [...] must be checked before VisionResult object deserialization,
        // otherwise JsonSerializer.Deserialize<VisionResult> throws JsonException.
        if (!content.StartsWith('['))
        {
            var result = JsonSerializer.Deserialize<VisionResult>(content, jsonOpts);
            if (result != null)
            {
                result.Containers = (result.Containers ?? []).Select(NormalizeContainer).ToList();
                return result;
            }
        }

        // Fallback: try parsing as old format (plain array)
        var containers = JsonSerializer.Deserialize<List<IdentifiedContainer>>(content, jsonOpts);
        var normalized = (containers ?? []).Select(NormalizeContainer).ToList();
        var totalSpotted = normalized.Sum(c => c.Count);
        return new VisionResult
        {
            Containers = normalized,
            Message = totalSpotted > 0
                ? $"Found {totalSpotted} container{(totalSpotted != 1 ? "s" : "")}!"
                : "No containers spotted — try pointing the camera at a can or bottle!",
        };
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
    /// must never author money copy: the scheme refund is 10c and our domestic
    /// sorting credit is separate from a direct Containers for Change pass-through.
    /// Any money-like token replaces the whole message with product-authored text
    /// rather than being redacted in place.
    /// </summary>
    public string Message
    {
        get => _message;
        set => _message = Sanitise(value);
    }

    private static readonly string[] MoneyWords = ["cent", "dollar", "refund", "$", "¢"];
    private static readonly Regex AttachedCentAmount =
        new(@"\b\d+(?:\.\d+)?c\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    /// <summary>True if the text makes any money claim we have not authored.</summary>
    internal static bool LooksLikeMoney(string text)
    {
        foreach (var w in MoneyWords)
            if (text.Contains(w, StringComparison.OrdinalIgnoreCase)) return true;
        if (AttachedCentAmount.IsMatch(text)) return true;
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
