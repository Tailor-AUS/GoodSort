using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace GoodSort.Api.Tests;

/// <summary>
/// Scan -> 5c credit -> suburb aluminium accumulation -> honest readiness.
///
/// The readiness a household sees must come from operator configuration. With
/// none set it must say so ("pending_operator_configuration") and carry no
/// threshold — the 1,000 LiveThreshold is an all-material estimate, not an
/// approved aluminium trigger, and must never leak in as one.
/// </summary>
public class CollectionReadinessTests
{
    // ── Pure rules ────────────────────────────────────────────────────────

    private static IConfiguration Cfg(params (string Key, string? Value)[] pairs) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(pairs.Select(p => new KeyValuePair<string, string?>(p.Key, p.Value)))
            .Build();

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("0")]
    [InlineData("-5")]
    [InlineData("lots")]
    public void Missing_or_invalid_threshold_is_pending_never_a_default(string? raw)
    {
        var config = CollectionReadiness.ConfigFrom(Cfg(("COLLECTION_ALUMINIUM_THRESHOLD_CONTAINERS", raw)));
        Assert.False(config.Configured);
        Assert.Null(config.AluminiumThreshold);
        Assert.Equal("none", config.Source);

        var r = CollectionReadiness.ForSuburb(config, aluminiumContainers: 5000, committed: false);
        Assert.Equal(CollectionReadiness.PendingOperatorConfiguration, r.Status);
        Assert.Null(r.AluminiumThreshold);
        Assert.Null(r.AluminiumNeeded);
        Assert.Equal(5000, r.AluminiumContainers);
    }

    [Fact]
    public void Configured_threshold_reports_accumulating_then_reached_awaiting_ops()
    {
        var config = CollectionReadiness.ConfigFrom(Cfg(("COLLECTION_ALUMINIUM_THRESHOLD_CONTAINERS", "40")));
        Assert.Equal("operator_config", config.Source);
        Assert.Null(config.FixtureLabel);

        var below = CollectionReadiness.ForSuburb(config, 39, committed: false);
        Assert.Equal(CollectionReadiness.Accumulating, below.Status);
        Assert.Equal(1, below.AluminiumNeeded);

        var at = CollectionReadiness.ForSuburb(config, 40, committed: false);
        // Reaching volume is not a collection — ops still decide.
        Assert.Equal(CollectionReadiness.VolumeReachedAwaitingOps, at.Status);
        Assert.Equal(0, at.AluminiumNeeded);
    }

    [Fact]
    public void Only_ops_commitment_reports_committed_even_when_pending_config()
    {
        var r = CollectionReadiness.ForSuburb(CollectionReadinessConfig.Pending, 0, committed: true);
        Assert.Equal(CollectionReadiness.OpsCommitted, r.Status);
    }

    [Fact]
    public void Fixture_label_marks_source_as_local_fixture()
    {
        var config = CollectionReadiness.ConfigFrom(Cfg(
            ("COLLECTION_ALUMINIUM_THRESHOLD_CONTAINERS", "40"),
            ("COLLECTION_READINESS_FIXTURE_LABEL", "  LOCAL TEST FIXTURE  ")));
        Assert.Equal("local_fixture", config.Source);
        Assert.Equal("LOCAL TEST FIXTURE", config.FixtureLabel);
    }

    [Fact]
    public void Aggregate_sums_suburb_aluminium_and_clamps_to_pending_ledger()
    {
        var board = WaitlistDensity.Aggregate(new[]
        {
            new HouseholdClusterRow("MOOROOKA", 3, "residential", PendingContainers: 10, AluminiumContainers: 6),
            new HouseholdClusterRow("MOOROOKA", 3, "residential", PendingContainers: 4, AluminiumContainers: 9), // stale tally > ledger
            new HouseholdClusterRow("MOOROOKA", 3, "unit_complex", PendingContainers: 50, AluminiumContainers: 50), // units never count
        });
        var s = Assert.Single(board.Suburbs);
        Assert.Equal(14, s.Containers);
        Assert.Equal(10, s.AluminiumContainers); // 6 + min(9, 4)
        Assert.NotNull(s.Readiness);
        Assert.Equal(CollectionReadiness.PendingOperatorConfiguration, s.Readiness!.Status);
        Assert.False(board.CollectionReadiness!.Configured);
    }

    // ── HTTP: the endpoint the household journey reads ───────────────────

    public abstract class HostBase : WebApplicationFactory<Program>
    {
        private readonly string _dbName = $"readiness-{Guid.NewGuid():N}";
        protected abstract void Extra(IWebHostBuilder builder);

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
            builder.UseSetting("SCAN_RATE_PER_MINUTE", "100000");
            builder.UseSetting("SCAN_DAILY_CAP", "100000");
            builder.UseSetting("LAUNCH_BONUS_CONTAINERS", "0");
            Extra(builder);
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                services.RemoveAll<GoodSortDbContext>();
                services.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(_dbName));
                services.RemoveAll<IHostedService>();
            });
        }
    }

    public class PendingHost : HostBase
    {
        protected override void Extra(IWebHostBuilder builder) { }
    }

    public class FixtureHost : HostBase
    {
        protected override void Extra(IWebHostBuilder builder)
        {
            builder.UseSetting("COLLECTION_ALUMINIUM_THRESHOLD_CONTAINERS", "3");
            builder.UseSetting("COLLECTION_READINESS_FIXTURE_LABEL", "LOCAL TEST FIXTURE");
        }
    }

    private static async Task<HttpClient> SignedInClient(WebApplicationFactory<Program> host, string email)
    {
        var client = host.CreateClient();
        var send = await client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        var code = (await send.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verify = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        var token = (await verify.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task Join(HttpClient client, string suburb)
    {
        var res = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Test House",
            address = $"12 Test St, {suburb} QLD 4105",
            suburb,
            street = "TEST ST",
            lat = -27.53,
            lng = 153.02,
            type = "residential",
            councilCollectionDay = 3,
            councilArea = "BCC",
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
    }

    private static async Task<int> Scan(HttpClient client, string material)
    {
        var res = await client.PostAsJsonAsync("/api/scans", new
        {
            barcode = "9300675024235",
            containerName = material == "aluminium" ? "Test 375ml Can" : "Test 600ml Bottle",
            material,
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("creditedCents").GetInt32();
    }

    private static async Task<(JsonElement Board, JsonElement Suburb)> Board(WebApplicationFactory<Program> host, string suburb)
    {
        var res = await host.CreateClient().GetAsync("/api/growth/brisbane");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var board = await res.Content.ReadFromJsonAsync<JsonElement>();
        var s = board.GetProperty("suburbs").EnumerateArray()
            .First(x => string.Equals(x.GetProperty("suburb").GetString(), suburb, StringComparison.OrdinalIgnoreCase));
        return (board, s);
    }

    [Fact]
    public async Task Without_operator_config_scans_credit_5c_and_aluminium_accumulates_but_readiness_is_pending()
    {
        using var host = new PendingHost();
        var c = await SignedInClient(host, "pending-a@example.test");
        await Join(c, "Moorooka");
        Assert.Equal(5, await Scan(c, "aluminium"));
        Assert.Equal(5, await Scan(c, "aluminium"));
        Assert.Equal(5, await Scan(c, "pet"));

        var (board, s) = await Board(host, "MOOROOKA");
        Assert.Equal(3, s.GetProperty("containers").GetInt32());
        Assert.Equal(2, s.GetProperty("aluminiumContainers").GetInt32());
        var r = s.GetProperty("readiness");
        Assert.Equal("pending_operator_configuration", r.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, r.GetProperty("aluminiumThreshold").ValueKind);
        Assert.Equal(JsonValueKind.Null, r.GetProperty("aluminiumNeeded").ValueKind);
        var cfg = board.GetProperty("collectionReadiness");
        Assert.False(cfg.GetProperty("configured").GetBoolean());
        Assert.Equal("none", cfg.GetProperty("source").GetString());
    }

    [Fact]
    public async Task With_labelled_fixture_config_readiness_moves_from_accumulating_to_awaiting_ops()
    {
        using var host = new FixtureHost();
        var a = await SignedInClient(host, "fixture-a@example.test");
        await Join(a, "Moorooka");
        await Scan(a, "aluminium");
        await Scan(a, "glass");

        var (board, s) = await Board(host, "MOOROOKA");
        var cfg = board.GetProperty("collectionReadiness");
        Assert.Equal("local_fixture", cfg.GetProperty("source").GetString());
        Assert.Equal("LOCAL TEST FIXTURE", cfg.GetProperty("fixtureLabel").GetString());
        Assert.Equal("accumulating", s.GetProperty("readiness").GetProperty("status").GetString());
        Assert.Equal(2, s.GetProperty("readiness").GetProperty("aluminiumNeeded").GetInt32());

        var b = await SignedInClient(host, "fixture-b@example.test");
        await Join(b, "Moorooka");
        await Scan(b, "aluminium");
        await Scan(b, "aluminium");

        (_, s) = await Board(host, "MOOROOKA");
        Assert.Equal(3, s.GetProperty("aluminiumContainers").GetInt32());
        Assert.Equal("aluminium_volume_reached_awaiting_ops", s.GetProperty("readiness").GetProperty("status").GetString());
        // The legacy all-material flag is untouched by this slice: 4 containers is nowhere near it.
        Assert.False(s.GetProperty("live").GetBoolean());
    }
}
