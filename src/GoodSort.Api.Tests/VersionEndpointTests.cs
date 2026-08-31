using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace GoodSort.Api.Tests;

/// <summary>
/// /api/version answers "which commit is actually serving".
///
/// The deploy workflow tags the image with the sha and points the container app
/// at it, so the sha exists — but only in the registry. From outside, a deploy
/// could only be confirmed by trusting that a green workflow run reached
/// production, and that inference has already been wrong: a run can go green
/// having taken a path that never shipped the component you changed. Asking the
/// running app is the one check a workflow cannot fake.
///
/// It is anonymous on purpose, so the tests that matter are that it answers
/// without a token and that it says nothing it should not.
/// </summary>
public class VersionEndpointTests : IClassFixture<VersionEndpointTests.Host>
{
    private readonly Host _factory;

    public VersionEndpointTests(Host factory) => _factory = factory;

    public class Host : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                services.RemoveAll<GoodSortDbContext>();
                services.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase($"version-{Guid.NewGuid():N}"));
                services.RemoveAll<IHostedService>();
            });
        }
    }

    [Fact]
    public async Task It_answers_without_a_token()
    {
        // An uptime probe or someone verifying a rollout has no token. A deploy
        // check behind auth is not usable by the thing most likely to need it.
        var client = _factory.CreateClient();
        var res = await client.GetAsync("/api/version");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task It_reports_a_sha_and_a_build_time()
    {
        var client = _factory.CreateClient();
        var body = await client.GetFromJsonAsync<JsonElement>("/api/version");

        Assert.True(body.TryGetProperty("sha", out var sha), "no sha in the response");
        Assert.True(body.TryGetProperty("buildTime", out _), "no buildTime in the response");

        // "unknown" is the honest answer for a local build with no build args,
        // and it must stay a real string rather than null — a null here would
        // read as "endpoint broken" to a probe rather than "not stamped".
        Assert.False(string.IsNullOrWhiteSpace(sha.GetString()));
    }

    [Fact]
    public async Task It_does_not_report_configuration_or_secrets()
    {
        // The temptation on an endpoint like this is to add the environment
        // name, then the connection target, then "just" a feature flag. It is
        // anonymous, so every field added here is published to everyone.
        var client = _factory.CreateClient();
        var raw = await client.GetStringAsync("/api/version");

        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "sha", "buildTime", "service",
        };

        using var doc = JsonDocument.Parse(raw);
        var actual = doc.RootElement.EnumerateObject().Select(p => p.Name).ToList();

        var unexpected = actual.Where(n => !allowed.Contains(n)).ToList();
        Assert.True(
            unexpected.Count == 0,
            "This endpoint is anonymous, so anything added here is public. Unexpected field(s): "
                + string.Join(", ", unexpected));
    }
}
