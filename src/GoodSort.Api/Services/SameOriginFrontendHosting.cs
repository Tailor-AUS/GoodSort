using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.StaticFiles;

namespace GoodSort.Api.Services;

/// <summary>
/// Serves the Next.js static export (`out/` staged into `wwwroot/`) from the
/// same origin as `/api/*` so the existing Azure Container App can host both
/// UI and API without upgrading Azure Static Web Apps from Free to paid Standard
/// or re-introducing cross-origin API fallbacks.
/// </summary>
public static class SameOriginFrontendHosting
{
    public const string ContentSecurityPolicy =
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' https://api.aukus.si/v1; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'";

    private static readonly FileExtensionContentTypeProvider ContentTypes = CreateContentTypeProvider();

    private static FileExtensionContentTypeProvider CreateContentTypeProvider()
    {
        var provider = new FileExtensionContentTypeProvider();
        provider.Mappings[".txt"] = "text/plain; charset=utf-8";
        provider.Mappings[".html"] = "text/html; charset=utf-8";
        provider.Mappings[".webmanifest"] = "application/manifest+json";
        return provider;
    }

    public static string? ResolveStaticRoot(string? webRootPath, string contentRootPath)
    {
        var candidates = new List<string>();
        if (!string.IsNullOrWhiteSpace(webRootPath))
        {
            candidates.Add(webRootPath);
        }

        if (!string.IsNullOrWhiteSpace(contentRootPath))
        {
            candidates.Add(Path.Combine(contentRootPath, "wwwroot"));
            candidates.Add(Path.Combine(contentRootPath, "..", "..", "out"));
        }

        foreach (var candidate in candidates)
        {
            try
            {
                var full = Path.GetFullPath(candidate);
                if (Directory.Exists(full) && File.Exists(Path.Combine(full, "index.html")))
                {
                    return full;
                }
            }
            catch
            {
                // Ignore invalid candidate paths.
            }
        }

        return null;
    }

    public static bool IsBackendRoute(PathString path)
    {
        return path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase)
            || path.StartsWithSegments("/health", StringComparison.OrdinalIgnoreCase)
            || path.StartsWithSegments("/alive", StringComparison.OrdinalIgnoreCase);
    }

    public static void ApplySecurityHeaders(IHeaderDictionary headers, PathString path, bool isStaticAsset)
    {
        headers.TryAdd("X-Frame-Options", "DENY");
        headers.TryAdd("X-Content-Type-Options", "nosniff");
        headers.TryAdd("Referrer-Policy", "strict-origin-when-cross-origin");
        headers.TryAdd("Permissions-Policy", "camera=(self), geolocation=(self), payment=(), usb=()");
        headers.TryAdd("Content-Security-Policy", ContentSecurityPolicy);

        if (!isStaticAsset)
        {
            return;
        }

        if (path.StartsWithSegments("/_next/static", StringComparison.Ordinal))
        {
            headers["Cache-Control"] = "public, max-age=31536000, immutable";
        }
        else if (string.Equals(path.Value, "/sw.js", StringComparison.Ordinal))
        {
            headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
        }
        else if (!headers.ContainsKey("Cache-Control"))
        {
            headers["Cache-Control"] = "no-cache, must-revalidate";
        }
    }

    public static string? TryResolveStaticFile(string staticRoot, PathString requestPath)
    {
        var rawPath = requestPath.Value ?? "/";
        if (rawPath.Contains("..", StringComparison.Ordinal)
            || rawPath.Contains('\\', StringComparison.Ordinal)
            || rawPath.Contains('\0', StringComparison.Ordinal))
        {
            return null;
        }

        var fullRoot = Path.GetFullPath(staticRoot);
        var rootWithSep = fullRoot.EndsWith(Path.DirectorySeparatorChar)
            ? fullRoot
            : fullRoot + Path.DirectorySeparatorChar;

        var relative = rawPath.TrimStart('/');
        if (relative.Length == 0)
        {
            var indexFile = Path.GetFullPath(Path.Combine(fullRoot, "index.html"));
            return indexFile.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase) && File.Exists(indexFile)
                ? indexFile
                : null;
        }

        var exactCandidate = Path.GetFullPath(
            Path.Combine(fullRoot, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (exactCandidate.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase) && File.Exists(exactCandidate))
        {
            return exactCandidate;
        }

        // Next.js 16 static export writes RSC segment payloads under nested
        // `__next.<root>/<child>/__PAGE__.txt` directories while the browser router
        // requests `__next.<root>.<child>.__PAGE__.txt`.
        var lastSlash = relative.LastIndexOf('/');
        var dirPrefix = lastSlash >= 0 ? relative[..(lastSlash + 1)] : string.Empty;
        var fileName = lastSlash >= 0 ? relative[(lastSlash + 1)..] : relative;
        if (fileName.StartsWith("__next.", StringComparison.Ordinal)
            && fileName.EndsWith(".txt", StringComparison.Ordinal)
            && fileName.Length > "__next..txt".Length)
        {
            var middle = fileName["__next.".Length..^".txt".Length];
            if (middle.Contains('.', StringComparison.Ordinal))
            {
                var rscRelative = $"{dirPrefix}__next.{middle.Replace('.', '/')}.txt";
                var rscCandidate = Path.GetFullPath(
                    Path.Combine(fullRoot, rscRelative.Replace('/', Path.DirectorySeparatorChar)));
                if (rscCandidate.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase) && File.Exists(rscCandidate))
                {
                    return rscCandidate;
                }
            }
        }

        var trimmed = relative.TrimEnd('/');
        if (trimmed.Length == 0)
        {
            return null;
        }

        var htmlCandidate = Path.GetFullPath(
            Path.Combine(fullRoot, (trimmed + ".html").Replace('/', Path.DirectorySeparatorChar)));
        if (htmlCandidate.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase) && File.Exists(htmlCandidate))
        {
            return htmlCandidate;
        }

        var dirIndexCandidate = Path.GetFullPath(
            Path.Combine(fullRoot, trimmed.Replace('/', Path.DirectorySeparatorChar), "index.html"));
        if (dirIndexCandidate.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase) && File.Exists(dirIndexCandidate))
        {
            return dirIndexCandidate;
        }

        return null;
    }

    public static string ResolveContentType(string filePath)
    {
        if (ContentTypes.TryGetContentType(filePath, out var contentType))
        {
            return contentType;
        }

        var fileName = Path.GetFileName(filePath);
        if (string.Equals(fileName, "opengraph-image", StringComparison.OrdinalIgnoreCase)
            || string.Equals(fileName, "twitter-image", StringComparison.OrdinalIgnoreCase))
        {
            return "image/png";
        }

        return "application/octet-stream";
    }

    public static void UseSameOriginFrontend(WebApplication app)
    {
        var staticRoot = ResolveStaticRoot(app.Environment.WebRootPath, app.Environment.ContentRootPath);

        app.Use(async (ctx, next) =>
        {
            var isBackend = IsBackendRoute(ctx.Request.Path);
            ctx.Response.OnStarting(() =>
            {
                ApplySecurityHeaders(ctx.Response.Headers, ctx.Request.Path, isStaticAsset: !isBackend);
                return Task.CompletedTask;
            });

            var isGetOrHead = HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method);
            if (!isBackend && isGetOrHead && staticRoot is not null)
            {
                var resolvedFile = TryResolveStaticFile(staticRoot, ctx.Request.Path);
                if (resolvedFile is not null)
                {
                    ctx.Response.StatusCode = StatusCodes.Status200OK;
                    ctx.Response.ContentType = ResolveContentType(resolvedFile);
                    ApplySecurityHeaders(ctx.Response.Headers, ctx.Request.Path, isStaticAsset: true);
                    if (HttpMethods.IsGet(ctx.Request.Method))
                    {
                        await ctx.Response.SendFileAsync(resolvedFile, ctx.RequestAborted);
                    }
                    return;
                }
            }

            await next();

            if (!isBackend
                && isGetOrHead
                && staticRoot is not null
                && ctx.Response.StatusCode == StatusCodes.Status404NotFound
                && !ctx.Response.HasStarted)
            {
                var notFoundFile = Path.Combine(staticRoot, "404.html");
                if (File.Exists(notFoundFile))
                {
                    ctx.Response.ContentType = "text/html; charset=utf-8";
                    ApplySecurityHeaders(ctx.Response.Headers, ctx.Request.Path, isStaticAsset: true);
                    if (HttpMethods.IsGet(ctx.Request.Method))
                    {
                        await ctx.Response.SendFileAsync(notFoundFile, ctx.RequestAborted);
                    }
                }
            }
        });
    }
}
