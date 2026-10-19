namespace GoodSort.Api.Services;

/// <summary>
/// Strict URI parser, documented-path allowlist, and redirect-rejecting HTTP
/// handler for the sole permitted external AI runtime endpoint
/// (<c>https://api.aukus.si/v1</c>).
///
/// Rejects prefix lookalikes (<c>/v1extra</c>), undocumented legacy provider
/// paths (<c>vision/classify/upload</c>, <c>api/v2/product/...</c>,
/// <c>explore/v2.1/catalog/...</c>, <c>trip/v1/driving/...</c>,
/// <c>openai/deployments/...</c>), non-default ports, query/fragment injection,
/// and any 3xx redirect response.
/// </summary>
public static class AukusBoundary
{
    public const string CanonicalBase = "https://api.aukus.si/v1";
    public const string CanonicalBaseWithSlash = "https://api.aukus.si/v1/";
    public const string ChatCompletionsRelativePath = "chat/completions";
    public static readonly Uri ChatCompletionsUri = new("https://api.aukus.si/v1/chat/completions");

    private static readonly HashSet<string> DocumentedPaths = new(StringComparer.Ordinal)
    {
        "/v1/chat/completions",
        "/v1/responses",
        "/v1/embeddings",
        "/v1/models",
    };

    /// <summary>
    /// Validates that <paramref name="raw"/> is the exact canonical base URI
    /// <c>https://api.aukus.si/v1</c> (with optional trailing slash), on default
    /// port 443, with no userinfo, query, fragment, or extra path segments.
    /// </summary>
    public static bool TryParseBaseUri(string? raw, out Uri? baseUri)
    {
        baseUri = null;
        if (string.IsNullOrWhiteSpace(raw)) return false;

        var trimmed = raw.Trim();
        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var parsed)) return false;
        if (!IsCanonicalAuthority(parsed)) return false;

        var path = parsed.AbsolutePath.TrimEnd('/');
        if (!string.Equals(path, "/v1", StringComparison.Ordinal)) return false;

        baseUri = new Uri(CanonicalBaseWithSlash);
        return true;
    }

    /// <summary>
    /// Validates that a full outbound request URI targets the exact scheme,
    /// host, port, and one of the documented <c>/v1/*</c> AI endpoints.
    /// </summary>
    public static bool IsAllowedRequestUri(Uri? uri)
    {
        if (uri is null || !uri.IsAbsoluteUri) return false;
        if (!IsCanonicalAuthority(uri)) return false;
        return DocumentedPaths.Contains(uri.AbsolutePath);
    }

    private static bool IsCanonicalAuthority(Uri uri) =>
        string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
        && string.Equals(uri.IdnHost, "api.aukus.si", StringComparison.OrdinalIgnoreCase)
        && string.Equals(uri.Host, "api.aukus.si", StringComparison.OrdinalIgnoreCase)
        && uri.IsDefaultPort
        && uri.Port == 443
        && string.IsNullOrEmpty(uri.UserInfo)
        && string.IsNullOrEmpty(uri.Query)
        && string.IsNullOrEmpty(uri.Fragment);
}

/// <summary>
/// Outbound <see cref="DelegatingHandler"/> that enforces <see cref="AukusBoundary.IsAllowedRequestUri"/>
/// before sending any request and rejects any 3xx redirect response so an
/// upstream redirect can never hop off <c>https://api.aukus.si/v1</c>.
/// </summary>
public sealed class AukusEnforcingHandler : DelegatingHandler
{
    public AukusEnforcingHandler()
    {
    }

    public AukusEnforcingHandler(HttpMessageHandler innerHandler) : base(innerHandler)
    {
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        if (!AukusBoundary.IsAllowedRequestUri(request.RequestUri))
        {
            throw new InvalidOperationException(
                $"Blocked outbound request to '{request.RequestUri}': only documented https://api.aukus.si/v1 AI endpoints are permitted.");
        }

        var response = await base.SendAsync(request, cancellationToken);
        var status = (int)response.StatusCode;
        if (status is >= 300 and < 400)
        {
            var location = response.Headers.Location?.ToString() ?? "<none>";
            response.Dispose();
            throw new InvalidOperationException(
                $"Rejected HTTP {status} redirect from '{request.RequestUri}' to '{location}': redirects are forbidden by the https://api.aukus.si/v1 runtime boundary.");
        }

        return response;
    }
}
