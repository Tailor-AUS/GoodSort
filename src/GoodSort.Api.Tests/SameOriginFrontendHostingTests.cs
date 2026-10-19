using System.Net;
using GoodSort.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace GoodSort.Api.Tests;

public class SameOriginFrontendHostingTests : IClassFixture<WebApplicationFactory<Program>>, IDisposable
{
    private readonly string _tempWebRoot;
    private readonly WebApplicationFactory<Program> _factory;

    public SameOriginFrontendHostingTests(WebApplicationFactory<Program> baseFactory)
    {
        _tempWebRoot = Path.Combine(Path.GetTempPath(), $"goodsort-wwwroot-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_tempWebRoot);
        Directory.CreateDirectory(Path.Combine(_tempWebRoot, "brisbane", "moorooka", "__next.brisbane", "$d$suburb"));
        Directory.CreateDirectory(Path.Combine(_tempWebRoot, "_next", "static", "chunks"));

        File.WriteAllText(Path.Combine(_tempWebRoot, "index.html"), "<!doctype html><html><body>GoodSort Root</body></html>");
        File.WriteAllText(Path.Combine(_tempWebRoot, "sort.html"), "<!doctype html><html><body>GoodSort Sort Flow</body></html>");
        File.WriteAllText(Path.Combine(_tempWebRoot, "404.html"), "<!doctype html><html><body>GoodSort Custom 404</body></html>");
        File.WriteAllText(Path.Combine(_tempWebRoot, "brisbane", "moorooka.html"), "<!doctype html><html><body>Moorooka Suburb Readiness</body></html>");
        File.WriteAllText(Path.Combine(_tempWebRoot, "brisbane", "moorooka", "__next.brisbane", "$d$suburb.txt"), "rsc-suburb-layout");
        File.WriteAllText(Path.Combine(_tempWebRoot, "brisbane", "moorooka", "__next.brisbane", "$d$suburb", "__PAGE__.txt"), "rsc-suburb-page");
        File.WriteAllText(Path.Combine(_tempWebRoot, "_next", "static", "chunks", "app.js"), "console.log('goodsort-chunk');");
        File.WriteAllText(Path.Combine(_tempWebRoot, "sw.js"), "self.addEventListener('fetch', () => {});");

        var dbName = $"SameOriginFrontendTests-{Guid.NewGuid():N}";
        _factory = baseFactory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseWebRoot(_tempWebRoot);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-secret-that-is-at-least-32-characters-long!!");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                services.RemoveAll<GoodSortDbContext>();
                services.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(dbName));
                services.RemoveAll<IHostedService>();
            });
        });
    }

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(_tempWebRoot))
                Directory.Delete(_tempWebRoot, recursive: true);
        }
        catch
        {
            // Best-effort temp cleanup.
        }
    }

    [Fact]
    public async Task RootPath_ServesExportedIndexHtml_WithSameOriginCspAndSecurityHeaders()
    {
        using var client = _factory.CreateClient();
        var response = await client.GetAsync("/");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/html; charset=utf-8", response.Content.Headers.ContentType?.ToString());
        var html = await response.Content.ReadAsStringAsync();
        Assert.Contains("GoodSort Root", html, StringComparison.Ordinal);

        Assert.True(response.Headers.TryGetValues("Content-Security-Policy", out var cspValues));
        var csp = string.Join(";", cspValues);
        Assert.Contains("default-src 'self'", csp, StringComparison.Ordinal);
        Assert.Contains("connect-src 'self' https://api.aukus.si/v1", csp, StringComparison.Ordinal);
        Assert.DoesNotContain("livelyfield", csp, StringComparison.OrdinalIgnoreCase);

        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
    }

    [Theory]
    [InlineData("/sort", "GoodSort Sort Flow")]
    [InlineData("/sort/", "GoodSort Sort Flow")]
    [InlineData("/brisbane/moorooka", "Moorooka Suburb Readiness")]
    public async Task CleanRoutes_ResolveExportedHtmlPages_OnSameOrigin(string path, string expectedMarker)
    {
        using var client = _factory.CreateClient();
        var response = await client.GetAsync(path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/html; charset=utf-8", response.Content.Headers.ContentType?.ToString());
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(expectedMarker, body, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("/brisbane/moorooka/__next.brisbane.$d$suburb.txt?_rsc=test", "rsc-suburb-layout")]
    [InlineData("/brisbane/moorooka/__next.brisbane.$d$suburb.__PAGE__.txt?_rsc=test", "rsc-suburb-page")]
    public async Task NextJsStaticExportRscFlightPayloads_ResolveNestedSegmentFiles(string path, string expectedMarker)
    {
        using var client = _factory.CreateClient();
        var response = await client.GetAsync(path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/plain; charset=utf-8", response.Content.Headers.ContentType?.ToString());
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(expectedMarker, body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task StaticAssets_AndServiceWorker_ReceiveExpectedCacheControlHeaders()
    {
        using var client = _factory.CreateClient();

        var chunkResponse = await client.GetAsync("/_next/static/chunks/app.js");
        Assert.Equal(HttpStatusCode.OK, chunkResponse.StatusCode);
        Assert.Contains("immutable", chunkResponse.Headers.CacheControl?.ToString() ?? string.Empty, StringComparison.Ordinal);

        var swResponse = await client.GetAsync("/sw.js");
        Assert.Equal(HttpStatusCode.OK, swResponse.StatusCode);
        var swCache = swResponse.Headers.CacheControl?.ToString() ?? string.Empty;
        Assert.Contains("no-store", swCache, StringComparison.Ordinal);
    }

    [Fact]
    public async Task UnknownFrontendRoute_Returns404Html_WhileApiRoutesStayApiResponses()
    {
        using var client = _factory.CreateClient();

        var frontendMissing = await client.GetAsync("/non-existent-suburb-page");
        Assert.Equal(HttpStatusCode.NotFound, frontendMissing.StatusCode);
        var missingHtml = await frontendMissing.Content.ReadAsStringAsync();
        Assert.Contains("GoodSort Custom 404", missingHtml, StringComparison.Ordinal);

        var apiMissing = await client.GetAsync("/api/non-existent-endpoint");
        Assert.Equal(HttpStatusCode.NotFound, apiMissing.StatusCode);
        var apiMissingBody = await apiMissing.Content.ReadAsStringAsync();
        Assert.DoesNotContain("GoodSort Custom 404", apiMissingBody, StringComparison.Ordinal);

        var apiHealth = await client.GetAsync("/api/health");
        Assert.Equal(HttpStatusCode.OK, apiHealth.StatusCode);

        var apiBrisbane = await client.GetAsync("/api/growth/brisbane");
        Assert.Equal(HttpStatusCode.OK, apiBrisbane.StatusCode);
    }

    [Fact]
    public void Dockerfile_AndWorkflows_BuildAndPackageSameOriginFrontendWithoutCrossOriginApiFallback()
    {
        var dockerfile = File.ReadAllText(FindRepoFile("Dockerfile"));
        Assert.Contains("FROM node:20-alpine AS web-build", dockerfile, StringComparison.Ordinal);
        Assert.Contains("ENV NEXT_PUBLIC_API_URL=\"\"", dockerfile, StringComparison.Ordinal);
        Assert.Contains("COPY --from=web-build /web/out ./wwwroot", dockerfile, StringComparison.Ordinal);

        var deployApi = File.ReadAllText(FindRepoFile(Path.Combine(".github", "workflows", "deploy-api.yml")));
        Assert.Contains("app/**", deployApi, StringComparison.Ordinal);
        Assert.Contains("lib/**", deployApi, StringComparison.Ordinal);
        Assert.Contains("public/**", deployApi, StringComparison.Ordinal);

        var swaWorkflow = File.ReadAllText(FindRepoFile(Path.Combine(".github", "workflows", "azure-static-web-apps-kind-mushroom-0fe89a200.yml")));
        Assert.DoesNotContain("livelyfield-64227152", swaWorkflow, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("NEXT_PUBLIC_API_URL: \"\"", swaWorkflow, StringComparison.Ordinal);
    }

    private static string FindRepoFile(string relative)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, relative)))
            dir = dir.Parent;
        Assert.NotNull(dir);
        return Path.Combine(dir!.FullName, relative);
    }
}
