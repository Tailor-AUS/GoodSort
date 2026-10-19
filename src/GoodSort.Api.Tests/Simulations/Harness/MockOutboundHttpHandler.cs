using System.Net;
using System.Text;
using System.Text.Json;
using GoodSort.Api.Services;

namespace GoodSort.Api.Tests.Simulations.Harness;

/// <summary>
/// Mocks outbound HTTP calls made by the server during the journey simulation
/// against the documented <c>https://api.aukus.si/v1/chat/completions</c> endpoint.
/// Enforces <see cref="AukusBoundary.IsAllowedRequestUri"/> so any attempt to call
/// a non-documented path or legacy host fails the test immediately.
/// </summary>
public class MockOutboundHttpHandler : HttpMessageHandler
{
    public static Func<HttpRequestMessage, HttpResponseMessage?>? CustomHandler { get; set; }
    public static string ActiveMaterial { get; set; } = "aluminium";
    public static string ActiveContainerType { get; set; } = "can";
    public static string ActiveDescription { get; set; } = "Coca-Cola 375ml can";

    public static void SetVisionClassification(string material, string containerType, string description)
    {
        ActiveMaterial = material;
        ActiveContainerType = containerType;
        ActiveDescription = description;
    }

    public static void Reset()
    {
        CustomHandler = null;
        ActiveMaterial = "aluminium";
        ActiveContainerType = "can";
        ActiveDescription = "Coca-Cola 375ml can";
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (!AukusBoundary.IsAllowedRequestUri(request.RequestUri))
        {
            throw new InvalidOperationException($"Disallowed outbound simulation URI: {request.RequestUri}");
        }

        if (CustomHandler != null)
        {
            var customResponse = CustomHandler(request);
            if (customResponse != null)
                return Task.FromResult(customResponse);
        }

        if (request.RequestUri == AukusBoundary.ChatCompletionsUri)
        {
            var innerVisionJson = JsonSerializer.Serialize(new
            {
                containers = new[]
                {
                    new
                    {
                        name = ActiveDescription,
                        material = ActiveMaterial,
                        count = 1,
                        eligible = true,
                        confidence = 0.98,
                    },
                },
                message = $"Found a {ActiveDescription} 🎉",
            });

            var openAiEnvelope = JsonSerializer.Serialize(new
            {
                id = "chatcmpl-sim-1",
                @object = "chat.completion",
                choices = new[]
                {
                    new
                    {
                        index = 0,
                        message = new
                        {
                            role = "assistant",
                            content = innerVisionJson,
                        },
                    },
                },
            });

            var resp = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(openAiEnvelope, Encoding.UTF8, "application/json"),
            };
            return Task.FromResult(resp);
        }

        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
    }
}

/// <summary>
/// Custom IHttpClientFactory returning the MockOutboundHttpHandler wrapped in
/// <see cref="AukusEnforcingHandler"/> for all clients.
/// </summary>
public class MockHttpClientFactory : IHttpClientFactory
{
    private readonly MockOutboundHttpHandler _handler = new();

    public HttpClient CreateClient(string name)
    {
        var enforcing = new AukusEnforcingHandler(_handler);
        return new HttpClient(enforcing, disposeHandler: false)
        {
            BaseAddress = new Uri(AukusBoundary.CanonicalBaseWithSlash),
        };
    }
}
