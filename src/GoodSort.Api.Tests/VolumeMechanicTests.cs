using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace GoodSort.Api.Tests;

/// <summary>
/// Drives the volume mechanic through the endpoint the product actually reads.
///
/// /api/growth/brisbane is the single source for what the marketing page, the
/// waitlist card and the sort screen all display, and its Live flag is what
/// says a suburb has earned a driver trip. Both directions cost something real:
/// unlocking early sends a van for half a load, and never unlocking leaves
/// members scanning into a number that goes nowhere.
///
/// WaitlistDensity is well covered by unit tests. What was not covered is
/// whether the endpoint serves what those functions compute — the aggregation
/// is invoked at Program.cs with LoadRowsAsync, and a wrong projection there
/// produces a perfectly consistent, wrong payload that every unit test still
/// passes.
/// </summary>
public class VolumeMechanicTests : IClassFixture<VolumeMechanicTests.Host>
{
    private readonly Host _host;
    public VolumeMechanicTests(Host host) => _host = host;

    public class Host : WebApplicationFactory<Program>
    {
        private readonly string _dbName = $"volume-{Guid.NewGuid():N}";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
            // These tests drive a whole suburb's volume through one account for
            // convenience — which is precisely the pattern the scan limits
            // exist to bound. Raised here so the volume mechanic is what is
            // under test; VisionCostCapTests and ScanFaucetLimitTests cover the
            // limits themselves.
            builder.UseSetting("SCAN_RATE_PER_MINUTE", "100000");
            builder.UseSetting("SCAN_DAILY_CAP", "100000");

            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                services.RemoveAll<GoodSortDbContext>();
                services.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(_dbName));
                services.RemoveAll<IHostedService>();
            });
        }
    }

    private async Task<HttpClient> SignedInClient(string email)
    {
        var client = _host.CreateClient();
        var send = await client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        var code = (await send.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verify = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        var token = (await verify.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task JoinHousehold(HttpClient client, string suburb, string type = "residential")
    {
        var res = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Test House",
            address = $"12 Test St, {suburb} QLD 4105",
            suburb,
            street = "TEST ST",
            lat = -27.53,
            lng = 153.02,
            type,
            councilCollectionDay = 3,
            councilArea = "BCC",
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
    }

    private static async Task Scan(HttpClient client, int times)
    {
        for (var i = 0; i < times; i++)
        {
            var res = await client.PostAsJsonAsync("/api/scans", new
            {
                barcode = "9300675024235",
                containerName = "Coca-Cola 375ml Can",
                material = "aluminium",
            });
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        }
    }

    private async Task<JsonElement> Board()
    {
        var res = await _host.CreateClient().GetAsync("/api/growth/brisbane");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static JsonElement? Suburb(JsonElement board, string name) =>
        board.GetProperty("suburbs").EnumerateArray()
            .Cast<JsonElement?>()
            .FirstOrDefault(s => string.Equals(
                s!.Value.GetProperty("suburb").GetString(), name, StringComparison.OrdinalIgnoreCase));

    [Fact]
    public async Task The_board_is_anonymous_because_the_marketing_page_reads_it_before_signup()
    {
        // No Authorization header. If this ever starts requiring a token the
        // homepage silently shows nothing, which is a fetch that fails without
        // an error anyone sees.
        var res = await _host.CreateClient().GetAsync("/api/growth/brisbane");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(WaitlistDensity.LiveThreshold, body.GetProperty("liveThreshold").GetInt32());
    }

    [Fact]
    public async Task Scans_reach_the_public_board_under_the_members_suburb()
    {
        var client = await SignedInClient("volume-moorooka@example.test");
        await JoinHousehold(client, "MOOROOKA");
        await Scan(client, 3);

        var s = Suburb(await Board(), "MOOROOKA");
        Assert.True(s.HasValue, "MOOROOKA should appear on the board once a member there has scanned.");
        Assert.Equal(3, s!.Value.GetProperty("containers").GetInt32());
        Assert.Equal(1, s.Value.GetProperty("households").GetInt32());

        // Nowhere near a driver trip, so it must not read as unlocked, and the
        // remaining count is what the progress bar shows.
        Assert.False(s.Value.GetProperty("live").GetBoolean());
        Assert.Equal(WaitlistDensity.LiveThreshold - 3, s.Value.GetProperty("needed").GetInt32());
    }

    [Fact]
    public async Task A_city_wide_label_never_becomes_a_suburb_that_can_unlock()
    {
        // Photon routinely returns "Brisbane" as the suburb. Treating that as a
        // cluster would let unrelated members across the whole city add up to a
        // driver trip to nowhere. The address is otherwise perfectly valid, so
        // nothing else about the request looks wrong.
        var client = await SignedInClient("volume-citywide@example.test");

        var res = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Test House",
            address = "12 Test St, Brisbane QLD 4000",
            suburb = "BRISBANE",
            street = "TEST ST",
            lat = -27.47,
            lng = 153.02,
            type = "residential",
            councilCollectionDay = 3,
            councilArea = "BCC",
            accessConsent = true,
        });

        // Whether this is refused outright or accepted-but-uncounted, the
        // invariant is the same: BRISBANE must never appear as a cluster.
        if (res.StatusCode == HttpStatusCode.Created)
        {
            await Scan(client, 2);
            var board = await Board();
            Assert.False(Suburb(board, "BRISBANE").HasValue,
                "BRISBANE is city-wide and must never appear as an unlockable suburb.");
            Assert.True(board.GetProperty("incompleteHouseholds").GetInt32() >= 1,
                "An uncountable residential member must be visible as incomplete, not silently dropped.");
        }
        else
        {
            Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        }
    }

    [Fact]
    public async Task An_apartment_cannot_join_the_street_waitlist_at_all()
    {
        // Apartments are refused outright by /api/households and sent to
        // /api/waitlist/unit-complex instead. Worth pinning: it is the first of
        // two independent reasons a building cannot inflate suburb volume, and
        // it is the one that is easy to relax by accident when someone adds a
        // new household type.
        var client = await SignedInClient("volume-apartment-join@example.test");

        var res = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Test Apartments",
            address = "12 Test St, YERONGA QLD 4104",
            suburb = "YERONGA",
            street = "TEST ST",
            lat = -27.51,
            lng = 153.01,
            type = "unit_complex",
            councilCollectionDay = 3,
            councilArea = "BCC",
            accessConsent = true,
        });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task A_building_on_the_waitlist_does_not_count_toward_suburb_volume()
    {
        // Common-area pickup is phase 2. A building's scans must never push a
        // suburb over the line, or we send a driver to a kerb with nothing on
        // it — the failure that costs actual money.
        var house = await SignedInClient("volume-house@example.test");
        await JoinHousehold(house, "YERONGA");
        await Scan(house, 4);

        var units = await SignedInClient("volume-units@example.test");
        var joined = await units.PostAsJsonAsync("/api/waitlist/unit-complex", new
        {
            buildingName = "Test Apartments",
            address = "50 Test St, YERONGA QLD 4104",
            lat = -27.51,
            lng = 153.01,
            suburb = "YERONGA",
        });
        Assert.Equal(HttpStatusCode.OK, joined.StatusCode);
        await Scan(units, 50);

        var s = Suburb(await Board(), "YERONGA");
        Assert.True(s.HasValue, "The house should still hold the suburb open.");

        // 54 containers were scanned in YERONGA; only the house's 4 may count.
        Assert.Equal(4, s!.Value.GetProperty("containers").GetInt32());
        Assert.Equal(1, s.Value.GetProperty("households").GetInt32());
    }

    [Fact]
    public async Task A_suburb_goes_live_only_once_it_has_earned_a_driver_trip()
    {
        var client = await SignedInClient("volume-threshold@example.test");
        await JoinHousehold(client, "ANNERLEY");

        // One short of the threshold: still locked, still asking for one more.
        await Scan(client, WaitlistDensity.LiveThreshold - 1);
        var before = Suburb(await Board(), "ANNERLEY")!.Value;
        Assert.False(before.GetProperty("live").GetBoolean(),
            "One container short of the threshold must not unlock a run.");
        Assert.Equal(1, before.GetProperty("needed").GetInt32());

        // The container that pays for the trip.
        await Scan(client, 1);
        var after = Suburb(await Board(), "ANNERLEY")!.Value;
        Assert.True(after.GetProperty("live").GetBoolean(),
            "At the threshold the suburb has earned a driver trip and must read as live.");
        Assert.Equal(0, after.GetProperty("needed").GetInt32());
    }
}
