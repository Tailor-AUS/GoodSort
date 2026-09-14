using System.Diagnostics;

namespace GoodSort.Api.Tests.Simulations.Harness;

/// <summary>
/// DelegatingHandler that intercepts and records all HTTP requests and responses
/// for end-to-end simulation audit logging.
/// </summary>
public class NetworkCaptureHandler : DelegatingHandler
{
    public List<NetworkExchange> Log { get; } = new();

    public NetworkCaptureHandler()
    {
    }

    public NetworkCaptureHandler(HttpMessageHandler innerHandler) : base(innerHandler)
    {
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var sw = Stopwatch.StartNew();
        var exchange = new NetworkExchange
        {
            Timestamp = DateTime.UtcNow,
            Method = request.Method.Method,
            Url = request.RequestUri?.ToString() ?? "",
            Path = request.RequestUri?.PathAndQuery ?? "",
            RequestHeaders = request.Headers.ToDictionary(h => h.Key, h => string.Join(", ", h.Value)),
        };

        if (request.Content != null)
        {
            exchange.RequestBody = await request.Content.ReadAsStringAsync(cancellationToken);
            foreach (var h in request.Content.Headers)
            {
                exchange.RequestHeaders[h.Key] = string.Join(", ", h.Value);
            }
        }

        var response = await base.SendAsync(request, cancellationToken);
        sw.Stop();

        exchange.DurationMs = sw.ElapsedMilliseconds;
        exchange.StatusCode = (int)response.StatusCode;
        exchange.StatusDescription = response.StatusCode.ToString();
        exchange.ResponseHeaders = response.Headers.ToDictionary(h => h.Key, h => string.Join(", ", h.Value));

        if (response.Content != null)
        {
            exchange.ResponseBody = await response.Content.ReadAsStringAsync(cancellationToken);
            foreach (var h in response.Content.Headers)
            {
                exchange.ResponseHeaders[h.Key] = string.Join(", ", h.Value);
            }
        }

        Log.Add(exchange);
        return response;
    }
}
