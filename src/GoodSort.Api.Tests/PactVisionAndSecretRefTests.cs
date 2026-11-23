using System.Net;
using System.Text;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using OpenAI.Chat;

namespace GoodSort.Api.Tests;

/// <summary>
/// Covers PACT/Sovrgn OpenAI-compatible vision routing (fail-closed, wire contract,
/// timeout/error fallback telemetry), non-reasoning vs reasoning model option hygiene,
/// and Container Apps secretRef regression guards across deploy-api.yml and scripts.
/// </summary>
public class PactVisionAndSecretRefTests
{
    private static readonly string ValidSampleBase64 =
        Convert.ToBase64String(Encoding.UTF8.GetBytes("synthetic-jpeg-bytes"));

    private static GoodSortDbContext NewDb() =>
        new(new DbContextOptionsBuilder<GoodSortDbContext>()
            .UseInMemoryDatabase($"pact-vision-{Guid.NewGuid():N}")
            .Options);

    [Theory]
    [InlineData("https://api.sovrgn.ai", "https://api.sovrgn.ai/v1/chat/completions")]
    [InlineData("https://api.sovrgn.ai/", "https://api.sovrgn.ai/v1/chat/completions")]
    [InlineData("https://api.sovrgn.ai/v1", "https://api.sovrgn.ai/v1/chat/completions")]
    [InlineData("https://api.sovrgn.ai/v1/", "https://api.sovrgn.ai/v1/chat/completions")]
    [InlineData("https://api.sovrgn.ai/v1/chat/completions", "https://api.sovrgn.ai/v1/chat/completions")]
    public void BuildPactChatCompletionsUri_normalizes_valid_urls(string input, string expected)
    {
        var uri = VisionService.BuildPactChatCompletionsUri(input);
        Assert.NotNull(uri);
        Assert.Equal(expected, uri!.ToString());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("/v1/chat/completions")]
    [InlineData("ftp://api.sovrgn.ai/v1")]
    [InlineData("file:///etc/passwd")]
    [InlineData("https://user:pass@api.sovrgn.ai/v1")]
    public void BuildPactChatCompletionsUri_rejects_invalid_or_unsafe_urls(string? input)
    {
        Assert.Null(VisionService.BuildPactChatCompletionsUri(input));
    }

    [Theory]
    [InlineData("gpt-4.1-mini", true)]
    [InlineData("gpt-4.1-nano", true)]
    [InlineData("gpt-4o-mini", true)]
    [InlineData("au-inregion-gpt-41-mini", true)]
    [InlineData("tailor-brain", true)]
    [InlineData("gemini-2.5-flash-lite", true)]
    [InlineData("gpt-5-mini", false)]
    [InlineData("gpt-5", false)]
    [InlineData("tailor-fast", false)]
    [InlineData("tailor-smart", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsNonReasoningFastModel_distinguishes_fast_models_from_reasoning_and_aliases(string? model, bool expected)
    {
        Assert.Equal(expected, VisionService.IsNonReasoningFastModel(model));
    }

    [Fact]
    public void BuildAzureChatOptions_caps_non_reasoning_models_and_protects_reasoning_models()
    {
        var fast = VisionService.BuildAzureChatOptions("gpt-4.1-mini");
        Assert.Equal(VisionDefaults.NonReasoningMaxOutputTokens, fast.MaxOutputTokenCount);
        Assert.NotNull(fast.Temperature);
        Assert.NotNull(fast.ResponseFormat);

        var reasoning = VisionService.BuildAzureChatOptions("gpt-5-mini");
        Assert.Null(reasoning.MaxOutputTokenCount);
        Assert.Null(reasoning.Temperature);
        Assert.NotNull(reasoning.ResponseFormat);
    }

    [Theory]
    [InlineData(null, "low")]
    [InlineData("", "low")]
    [InlineData("invalid", "low")]
    [InlineData("LOW", "low")]
    [InlineData("high", "high")]
    [InlineData("auto", "auto")]
    public void ResolveImageDetail_defaults_to_low_and_maps_azure_enum(string? raw, string expectedWire)
    {
        var expectedAzure = expectedWire switch
        {
            "high" => ChatImageDetailLevel.High,
            "auto" => ChatImageDetailLevel.Auto,
            _ => ChatImageDetailLevel.Low,
        };
        Assert.Equal(expectedWire, VisionService.ResolveImageDetail(raw));
        Assert.Equal(expectedAzure, VisionService.ResolveAzureImageDetail(raw));
    }

    [Theory]
    [InlineData(null, 15)]
    [InlineData("not-a-number", 15)]
    [InlineData("1", 3)]
    [InlineData("8", 8)]
    [InlineData("120", 60)]
    public void ResolveTimeout_clamps_to_safe_bounds(string? raw, int expectedSeconds)
    {
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["VISION_TIMEOUT_SECONDS"] = raw })
            .Build();
        Assert.Equal(TimeSpan.FromSeconds(expectedSeconds), VisionService.ResolveTimeout(cfg));
    }

    [Fact]
    public async Task Pact_vision_fails_closed_when_unset_or_malformed_and_never_uses_revoked_sovrgn_key()
    {
        var calls = 0;
        var factory = new StubHttpClientFactory(_ =>
        {
            calls++;
            return new HttpResponseMessage(HttpStatusCode.OK);
        });

        var cases = new[]
        {
            new Dictionary<string, string?> { ["PACT_VISION_URL"] = "https://api.sovrgn.ai/v1" },
            new Dictionary<string, string?> { ["PACT_VISION_API_KEY"] = "test-key", ["PACT_VISION_URL"] = "" },
            new Dictionary<string, string?> { ["PACT_VISION_API_KEY"] = "test-key", ["PACT_VISION_URL"] = "not-a-url" },
            new Dictionary<string, string?> { ["SOVRGN_API_KEY"] = "revoked-legacy-key", ["PACT_VISION_URL"] = "https://api.sovrgn.ai/v1" },
        };

        foreach (var dict in cases)
        {
            await using var db = NewDb();
            var cfg = new ConfigurationBuilder().AddInMemoryCollection(dict).Build();
            var svc = new VisionService(cfg, NullLogger<VisionService>.Instance, factory, db);

            var res = await svc.IdentifyContainers(ValidSampleBase64);
            Assert.Contains("temporarily unavailable", res.Message, StringComparison.OrdinalIgnoreCase);
            Assert.Equal(0, calls);
        }
    }

    [Fact]
    public async Task Pact_vision_sends_openai_multimodal_contract_and_logs_pact_provider()
    {
        HttpRequestMessage? capturedReq = null;
        string? capturedBody = null;

        var factory = new StubHttpClientFactory(async req =>
        {
            capturedReq = req;
            capturedBody = await req.Content!.ReadAsStringAsync();

            var reply = JsonSerializer.Serialize(new
            {
                choices = new[]
                {
                    new
                    {
                        message = new
                        {
                            content = JsonSerializer.Serialize(new
                            {
                                containers = new[]
                                {
                                    new { name = "Coca-Cola 375ml can", material = "aluminium", count = 2, eligible = true },
                                },
                                message = "2 Coke cans ready to sort!",
                            }),
                        },
                    },
                },
            });

            var resp = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(reply, Encoding.UTF8, "application/json"),
            };
            resp.Headers.TryAddWithoutValidation("X-Sovrgn-Model", "au-inregion-gpt-41-mini");
            resp.Headers.TryAddWithoutValidation("X-Sovrgn-Region", "australiaeast");
            resp.Headers.TryAddWithoutValidation("X-Sovrgn-Processing", "in-region");
            return resp;
        });

        await using var db = NewDb();
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["PACT_VISION_URL"] = "https://api.sovrgn.ai",
                ["PACT_VISION_API_KEY"] = "test-pact-bearer",
                ["PACT_VISION_MODEL"] = "gpt-4.1-mini",
            })
            .Build();

        var svc = new VisionService(cfg, NullLogger<VisionService>.Instance, factory, db);
        var userId = Guid.NewGuid();
        var result = await svc.IdentifyContainers($"data:image/jpeg;base64,{ValidSampleBase64}", userId);

        Assert.NotNull(capturedReq);
        Assert.Equal("https://api.sovrgn.ai/v1/chat/completions", capturedReq!.RequestUri!.ToString());
        Assert.Equal("Bearer", capturedReq.Headers.Authorization?.Scheme);
        Assert.Equal("test-pact-bearer", capturedReq.Headers.Authorization?.Parameter);
        Assert.Equal("goodsort", capturedReq.Headers.GetValues("X-Sovrgn-Tenant").Single());

        Assert.NotNull(capturedBody);
        using var payload = JsonDocument.Parse(capturedBody!);
        Assert.Equal("gpt-4.1-mini", payload.RootElement.GetProperty("model").GetString());
        Assert.Equal("json_object", payload.RootElement.GetProperty("response_format").GetProperty("type").GetString());
        Assert.Equal(VisionDefaults.NonReasoningMaxOutputTokens, payload.RootElement.GetProperty("max_tokens").GetInt32());

        var parts = payload.RootElement.GetProperty("messages")[0].GetProperty("content");
        Assert.Equal("image_url", parts[1].GetProperty("type").GetString());
        Assert.Equal("low", parts[1].GetProperty("image_url").GetProperty("detail").GetString());
        Assert.StartsWith("data:image/jpeg;base64,", parts[1].GetProperty("image_url").GetProperty("url").GetString());

        Assert.Single(result.Containers);
        Assert.Equal("aluminium", result.Containers[0].Material);
        Assert.Equal(2, result.Containers[0].Count);
        Assert.True(result.Containers[0].Eligible);

        var logged = await db.VisionCalls.SingleAsync();
        Assert.Equal("pact", logged.Provider);
        Assert.True(logged.Success);
        Assert.Equal(2, logged.ContainerCount);
        Assert.Equal(userId, logged.UserId);
    }

    [Fact]
    public async Task Pact_vision_error_and_timeout_log_telemetry_and_fall_back_to_azure_openai()
    {
        var factory = new StubHttpClientFactory(_ =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
            {
                Content = new StringContent("upstream unavailable"),
            }));

        await using var db = NewDb();
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["PACT_VISION_URL"] = "https://api.sovrgn.ai/v1",
                ["PACT_VISION_API_KEY"] = "test-pact-bearer",
                ["PACT_VISION_MODEL"] = "tailor-fast",
            })
            .Build();

        var svc = new VisionService(cfg, NullLogger<VisionService>.Instance, factory, db);
        var result = await svc.IdentifyContainers(ValidSampleBase64);

        Assert.Empty(result.Containers);
        Assert.Contains("temporarily unavailable", result.Message, StringComparison.OrdinalIgnoreCase);

        var rows = await db.VisionCalls.OrderBy(v => v.CreatedAt).ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.Equal("pact", rows[0].Provider);
        Assert.False(rows[0].Success);
        Assert.Contains("HTTP 503", rows[0].ErrorSummary);
        Assert.Equal("none", rows[1].Provider);
    }

    [Fact]
    public async Task Pact_vision_timeout_logs_timeout_summary_and_falls_back()
    {
        var factory = new StubHttpClientFactory((_, ct) =>
            Task.FromException<HttpResponseMessage>(new TaskCanceledException("simulated timeout")));

        await using var db = NewDb();
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["PACT_VISION_URL"] = "https://api.sovrgn.ai/v1",
                ["PACT_VISION_API_KEY"] = "test-pact-bearer",
                ["VISION_TIMEOUT_SECONDS"] = "5",
            })
            .Build();

        var svc = new VisionService(cfg, NullLogger<VisionService>.Instance, factory, db);
        var result = await svc.IdentifyContainers(ValidSampleBase64);

        Assert.Contains("temporarily unavailable", result.Message, StringComparison.OrdinalIgnoreCase);

        var pactRow = await db.VisionCalls.FirstAsync(v => v.Provider == "pact");
        Assert.False(pactRow.Success);
        Assert.Equal("Timeout after 5s", pactRow.ErrorSummary);
    }

    [Fact]
    public void SecretRef_hygiene_and_deploy_guards_are_wired_with_LF_endings_and_zero_plaintext_secrets()
    {
        var checkScript = File.ReadAllText(FindRepoFile(Path.Combine("scripts", "check-secretref-hygiene.sh")));
        var restoreScript = File.ReadAllText(FindRepoFile(Path.Combine("infra", "restore-secrets.sh")));
        var openaiScript = File.ReadAllText(FindRepoFile(Path.Combine("scripts", "ensure-openai-provisioned.sh")));
        var deployYml = File.ReadAllText(FindRepoFile(Path.Combine(".github", "workflows", "deploy-api.yml")));

        // Shell scripts must keep LF endings so Ubuntu Actions / bash never choke on \r.
        Assert.DoesNotContain("\r", checkScript, StringComparison.Ordinal);
        Assert.DoesNotContain("\r", restoreScript, StringComparison.Ordinal);
        Assert.DoesNotContain("\r", openaiScript, StringComparison.Ordinal);

        // Strip shell comments before asserting on executable script lines (CLAUDE.md rule).
        var checkCode = StripShellComments(checkScript);
        var openaiCode = StripShellComments(openaiScript);
        var deployCode = StripShellComments(deployYml);

        // Hygiene script queries only names where secretRef is null — never .value.
        Assert.Contains("JWT_SECRET", checkCode, StringComparison.Ordinal);
        Assert.Contains("ConnectionStrings__goodsortdb", checkCode, StringComparison.Ordinal);
        Assert.Contains("PACT_VISION_API_KEY", checkCode, StringComparison.Ordinal);
        Assert.DoesNotContain(".value", checkCode, StringComparison.Ordinal);

        // restore-secrets.sh conditionally guards optional secrets and enforces strict hygiene check.
        Assert.Contains("if [ -n \"$TAILOR_VISION_API_KEY\" ]", restoreScript, StringComparison.Ordinal);
        Assert.Contains("if [ -n \"$PACT_VISION_API_KEY\" ] && [ -n \"$PACT_VISION_URL\" ]", restoreScript, StringComparison.Ordinal);
        Assert.Contains("check-secretref-hygiene.sh\" --strict", restoreScript, StringComparison.Ordinal);

        // ensure-openai-provisioned.sh preserves live deployment and supports gpt-4.1-mini.
        Assert.Contains("LIVE_DEPLOYMENT", openaiCode, StringComparison.Ordinal);
        Assert.Contains("gpt-4.1-mini", openaiCode, StringComparison.Ordinal);
        Assert.Contains("AZURE_OPENAI_KEY=secretref:azure-openai-key", openaiCode, StringComparison.Ordinal);
        Assert.DoesNotContain("PACT_VISION_API_KEY", openaiCode, StringComparison.Ordinal);

        // deploy-api.yml masks SQL_CS, supports goodsortdb-connection-string, keeps secretref:sql-cs, and runs hygiene guard.
        Assert.Contains("::add-mask::$SQL_CS", deployCode, StringComparison.Ordinal);
        Assert.Contains("goodsortdb-connection-string", deployCode, StringComparison.Ordinal);
        Assert.Contains("ConnectionStrings__goodsortdb=secretref:sql-cs", deployCode, StringComparison.Ordinal);
        Assert.Contains("scripts/check-secretref-hygiene.sh", deployCode, StringComparison.Ordinal);
        Assert.DoesNotContain("JWT_SECRET=$", deployCode, StringComparison.Ordinal);
        Assert.DoesNotContain("ConnectionStrings__goodsortdb=$", deployCode, StringComparison.Ordinal);
    }

    private static string StripShellComments(string text) =>
        string.Join("\n", text.Split('\n').Where(l => !l.TrimStart().StartsWith('#')));

    private static string FindRepoFile(string relative)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, relative)))
            dir = dir.Parent;
        Assert.NotNull(dir);
        return Path.Combine(dir!.FullName, relative);
    }

    private sealed class StubHttpClientFactory : IHttpClientFactory
    {
        private readonly Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> _handler;

        public StubHttpClientFactory(Func<HttpRequestMessage, HttpResponseMessage> syncHandler)
            : this((req, _) => Task.FromResult(syncHandler(req))) { }

        public StubHttpClientFactory(Func<HttpRequestMessage, Task<HttpResponseMessage>> asyncHandler)
            : this((req, _) => asyncHandler(req)) { }

        public StubHttpClientFactory(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> handler)
            => _handler = handler;

        public HttpClient CreateClient(string name) => new(new DelegateHandler(_handler));

        private sealed class DelegateHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> handler)
            : HttpMessageHandler
        {
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
                => handler(request, cancellationToken);
        }
    }
}
