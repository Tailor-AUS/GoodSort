using System.Net.Http.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace GoodSort.Api.Tests;

/// <summary>
/// Every endpoint must either require authorization or be named here as
/// deliberately public. There is no third state.
///
/// This exists because the default is wrong in the dangerous direction: a
/// minimal-API route is anonymous unless someone remembers .RequireAuthorization(),
/// so forgetting it produces a working endpoint that leaks, with nothing in a
/// build, a test run or a code review that looks unusual.
///
/// It has already happened twice. Runner endpoints were publishing pickup
/// coordinates, and GET /api/routes plus /api/routes/{id} were returning whole
/// CollectionRoute graphs — every RouteStop's HouseholdName, full street
/// Address and exact Lat/Lng — to anonymous callers. That one read as harmless
/// because it returned an empty array: no run had been generated yet. The first
/// real collection would have published every participating address, alongside
/// the time their bags would be at the kerb.
///
/// Adding a public endpoint is fine. Adding one silently is not.
/// </summary>
public class EndpointAuthPostureTests : IClassFixture<EndpointAuthPostureTests.Host>
{
    private readonly Host _host;
    public EndpointAuthPostureTests(Host host) => _host = host;

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
                services.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase($"posture-{Guid.NewGuid():N}"));
                services.RemoveAll<IHostedService>();
            });
        }
    }

    /// <summary>
    /// Routes that are anonymous on purpose. Each entry is a decision someone
    /// has to make deliberately, with the reason attached — that is the whole
    /// point of the list.
    /// </summary>
    private static readonly Dictionary<string, string> IntentionallyPublic = new()
    {
        ["/health"] = "Container Apps probe.",
        ["/alive"] = "Container Apps liveness probe.",
        ["/api/health"] = "Uptime check.",

        ["/api/auth/send-otp"] = "Signing in is what produces a token; it cannot require one.",
        ["/api/auth/verify-otp"] = "Same — this is where the token is issued.",
        ["/api/admin/bootstrap"] = "First-admin seeding: there is no admin yet to authenticate as. Not open — it 404s unless ADMIN_BOOTSTRAP_SECRET is configured, and then requires a matching X-Bootstrap-Secret header compared with FixedTimeEquals. Currently unset in production, so the route does not exist there. Pinned separately by Admin_bootstrap_is_secret_gated_not_open.",

        ["/api/growth/brisbane"] = "The public suburb board. The marketing page reads it before anyone has an account.",
        ["/api/growth/events"] = "First-party funnel events, which must fire before signup. Rate limited per IP and PII-scrubbed on write (GrowthEventPiiTests).",
        ["/api/growth/invite/{id:guid}"] = "Invite preview for a link shared to someone with no account. Returns first name and suburb only (InvitePreviewTests).",

        ["/api/barcode/{barcode}"] = "Container lookup. Public product data, no member involved.",
        ["/api/depots"] = "Refund point locations. Public infrastructure.",
        ["/api/recyclers"] = "Recycler locations. Public infrastructure.",
        ["/api/households/lookup-bin-day"] = "Council collection-day lookup for an address the caller typed. Reads BCC open data; stores nothing.",

        ["/api/bins/code/{code}"] = "Resolving a physical bin from the code printed on it — the scanner hits this before the member signs in.",
        ["/api/bins/{id:guid}/qr"] = "Renders the printable label for a physical bin. The claim here used to be \"no member data\", which was wrong — it rendered bin.Name, and a household bin's name IS the household's name. It now shows a name only for hosted bins, where it is a venue.",

        ["/api/marketplace/runs"] = "Available-work board for runners. Deliberately projected to run centroid, stop COUNT and aggregate materials — never a stop address or a household coordinate.",
        ["/api/runner/leaderboard"] = "Public runner standings.",
        ["/api/cashout/status"] = "Whether payouts are switched on. A flag, not a balance.",
    };

    private static IEnumerable<(string Route, bool Authorized)> Surface(IServiceProvider services) =>
        services.GetRequiredService<EndpointDataSource>()
            .Endpoints
            .OfType<RouteEndpoint>()
            .Select(e => (
                Route: "/" + (e.RoutePattern.RawText ?? string.Empty).TrimStart('/'),
                Authorized: e.Metadata.GetMetadata<IAuthorizeData>() is not null))
            .Distinct();

    [Fact]
    public void No_endpoint_is_anonymous_without_being_declared_so()
    {
        var undeclared = Surface(_host.Services)
            .Where(e => !e.Authorized && !IntentionallyPublic.ContainsKey(e.Route))
            .Select(e => e.Route)
            .Distinct()
            .OrderBy(r => r)
            .ToList();

        Assert.True(undeclared.Count == 0,
            "These endpoints are reachable without a token and are not declared public:\n  " +
            string.Join("\n  ", undeclared) +
            "\n\nIf that is intended, add each to IntentionallyPublic with the reason. " +
            "If not, add .RequireAuthorization(). Check what the response body actually " +
            "contains first — GET /api/routes looked harmless because it returned an " +
            "empty array, and would have started publishing household addresses the " +
            "moment a run was generated.");
    }

    [Fact]
    public void The_public_list_does_not_outlive_the_endpoints_it_describes()
    {
        // A stale entry is not harmless: it silently pre-approves any future
        // endpoint that happens to reuse the route, so the guard above would
        // wave it straight through.
        var routes = Surface(_host.Services).Select(e => e.Route).ToHashSet();

        var stale = IntentionallyPublic.Keys
            .Where(r => !routes.Contains(r))
            .OrderBy(r => r)
            .ToList();

        Assert.True(stale.Count == 0,
            "IntentionallyPublic names routes that no longer exist:\n  " + string.Join("\n  ", stale));
    }

    [Theory]
    [InlineData("/api/routes")]
    [InlineData("/api/routes/{id:guid}")]
    public void Collection_routes_are_never_anonymous(string route)
    {
        // Pinned separately from the allowlist because of what the payload is:
        // an unprojected CollectionRoute graph, so every RouteStop's
        // HouseholdName, Address and exact Lat/Lng. Adding it to
        // IntentionallyPublic would be a mistake, and this makes that mistake
        // fail rather than pass.
        var match = Surface(_host.Services).Where(e => e.Route == route).ToList();
        Assert.True(match.Count > 0, $"{route} not found — did the route change?");
        Assert.All(match, e => Assert.True(e.Authorized, $"{route} must require authorization."));
    }
    [Fact]
    public void Every_admin_route_requires_an_admin_not_merely_a_token()
    {
        // The dangerous near-miss here is .RequireAuthorization() with no
        // policy: the route looks protected, the build is green, and any
        // signed-in member can read /api/admin/waitlist — every member's name,
        // address and collection day. "Has a token" is not "is staff".
        var offenders = _host.Services.GetRequiredService<EndpointDataSource>()
            .Endpoints
            .OfType<RouteEndpoint>()
            .Select(e => (Route: "/" + (e.RoutePattern.RawText ?? string.Empty).TrimStart('/'),
                          Policy: e.Metadata.GetMetadata<IAuthorizeData>()?.Policy))
            .Where(e => e.Route.StartsWith("/api/admin", StringComparison.OrdinalIgnoreCase))
            .Where(e => e.Route != "/api/admin/bootstrap")   // see the allowlist entry
            .Where(e => !string.Equals(e.Policy, AuthHelpers.AdminPolicy, StringComparison.Ordinal))
            .Select(e => $"{e.Route} (policy: {e.Policy ?? "none"})")
            .Distinct()
            .OrderBy(x => x)
            .ToList();

        Assert.True(offenders.Count == 0,
            "These /api/admin routes are not behind AuthHelpers.AdminPolicy:" +
            Environment.NewLine + "  " +
            string.Join(Environment.NewLine + "  ", offenders));
    }

    [Fact]
    public async Task Admin_bootstrap_is_secret_gated_not_open()
    {
        // The one anonymous route that grants admin, so it gets its own
        // assertion rather than a line in a list. With no secret configured it
        // must not exist at all — which is its state in production.
        var res = await _host.CreateClient()
            .PostAsJsonAsync("/api/admin/bootstrap", new { email = "attacker@example.test" });

        Assert.Equal(System.Net.HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public void No_handler_falls_back_to_a_client_supplied_caller_id()
    {
        // `ctx.GetCallerId() ?? somethingFromTheBody` means "if I cannot
        // identify you, trust what you sent". /api/profiles had the only one:
        // it assigned the body's id and then read that profile straight back.
        // Every sibling returns Unauthorized instead.
        //
        // A grep test because the shape is what matters, not any one endpoint,
        // and it is the kind of line that reads as a harmless null-guard.
        var root = FindApiSource();
        var offenders = Directory
            .EnumerateFiles(root, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains(Path.Combine("Migrations", "")))
            .Where(f => File.ReadLines(f).Any(l =>
                l.Contains("GetCallerId() ??") && !l.TrimStart().StartsWith("//")))
            .Select(Path.GetFileName)
            .ToList();

        Assert.True(offenders.Count == 0,
            "These fall back to a client-supplied caller id instead of refusing: " +
            string.Join(", ", offenders));
    }

    private static string FindApiSource()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "GoodSort.Api")))
            dir = dir.Parent;
        Assert.NotNull(dir);
        return Path.Combine(dir!.FullName, "GoodSort.Api");
    }

}
