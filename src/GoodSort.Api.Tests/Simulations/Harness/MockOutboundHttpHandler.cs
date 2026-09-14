using System.Net;
using System.Text;

namespace GoodSort.Api.Tests.Simulations.Harness;

/// <summary>
/// Mocks outbound HTTP calls made by the server during the journey simulation
/// (e.g. Tailor Vision container classification API and Brisbane City Council bin-day open data).
/// </summary>
public class MockOutboundHttpHandler : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var uri = request.RequestUri?.ToString() ?? "";

        // Tailor Vision classify upload mock
        if (uri.Contains("/api/vision/classify/upload") || uri.Contains("api.tailor.au"))
        {
            var json = """
            {
              "classification": {
                "material": "aluminium",
                "containerType": "can",
                "description": "Coca-Cola 375ml can",
                "bin": "yellow",
                "confidence": 0.98
              },
              "cds": {
                "eligible": true,
                "refundValue": 0.10,
                "currency": "AUD",
                "schemes": ["Containers for Change"]
              },
              "barcode": {
                "detected": false,
                "value": null,
                "catalogueMatch": false
              }
            }
            """;
            var resp = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
            return Task.FromResult(resp);
        }

        // Brisbane City Council bin day lookup mock
        if (uri.Contains("data.brisbane.qld.gov.au"))
        {
            var json = """
            {
              "total_count": 1,
              "results": [
                {
                  "collection_day": "Tuesday",
                  "c": 42
                }
              ]
            }
            """;
            var resp = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
            return Task.FromResult(resp);
        }

        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
    }
}

/// <summary>
/// Custom IHttpClientFactory returning the MockOutboundHttpHandler for all clients.
/// </summary>
public class MockHttpClientFactory : IHttpClientFactory
{
    private readonly MockOutboundHttpHandler _handler = new();

    public HttpClient CreateClient(string name)
    {
        var client = new HttpClient(_handler, disposeHandler: false);
        if (string.Equals(name, "TailorVision", StringComparison.OrdinalIgnoreCase))
        {
            client.BaseAddress = new Uri("https://api.tailor.au");
        }
        return client;
    }
}
