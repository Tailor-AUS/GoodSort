using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace GoodSort.Api.Tests;

/// <summary>
/// The bound on a runner paying themselves.
///
/// Pickup counts are self-reported: a driver says how many containers they
/// collected from a stop, and at settle that number becomes the driver's own
/// cash-out-eligible ClearedCents. Nothing physical corroborates it. An
/// unbounded value is therefore a direct self-credit fraud vector, which the
/// code says in as many words.
///
/// It is bounded — this is coverage, not a fix. Both pickup paths clamp, and
/// they must, because it is exactly the sort of guard that gets added to one
/// endpoint and forgotten on the other: /api/routes is the collection-route
/// path and /api/marketplace/runs is the runner-marketplace path, and both
/// settle into the same balance.
///
/// Also pinned: a driver may only report against a route that is theirs. The
/// clamp bounds how much one stop can pay; ownership bounds whose stops you can
/// claim at all, and a gap there would make the clamp beside the point.
/// </summary>
public class SelfCreditClampTests : IClassFixture<SelfCreditClampTests.Host>
{
    private const int StopCap = 50;

    private readonly Host _host;
    public SelfCreditClampTests(Host host) => _host = host;

    public class Host : WebApplicationFactory<Program>
    {
        public string DbName { get; } = $"selfcredit-{Guid.NewGuid():N}";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
            // Small enough to exceed in a test; production defaults to 2000.
            builder.UseSetting("RUNNER_STOP_MAX_CONTAINERS", StopCap.ToString());
            builder.ConfigureServices(s =>
            {
                s.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                s.RemoveAll<GoodSortDbContext>();
                s.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(DbName));
                s.RemoveAll<IHostedService>();
            });
        }
    }

    private GoodSortDbContext Db() =>
        _host.Services.CreateScope().ServiceProvider.GetRequiredService<GoodSortDbContext>();

    private async Task<(HttpClient Client, Guid ProfileId)> SignIn(string email)
    {
        var client = _host.CreateClient();
        var send = await client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        var code = (await send.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verify = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        var body = await verify.Content.ReadFromJsonAsync<JsonElement>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body.GetProperty("token").GetString());
        return (client, body.GetProperty("profile").GetProperty("id").GetGuid());
    }

    /// <summary>An in-progress collection route with one pending stop, driven by <paramref name="driverId"/>.</summary>
    private async Task<(Guid RouteId, Guid StopId)> SeedRoute(Guid driverId)
    {
        using var db = Db();
        var depot = new Depot { Name = "Depot", Address = "1 Test St", Lat = -27.5, Lng = 153.0 };
        db.Depots.Add(depot);

        var household = new Household { Suburb = "MOOROOKA", Type = "residential", Address = "12 Test St" };
        db.Households.Add(household);

        var route = new CollectionRoute { Status = "in_progress", DepotId = depot.Id, DriverId = driverId };
        db.Routes.Add(route);

        var stop = new RouteStop
        {
            RouteId = route.Id,
            HouseholdId = household.Id,
            HouseholdName = "Test House",
            Address = "12 Test St",
            Lat = -27.53,
            Lng = 153.02,
            ContainerCount = 10,
            Status = "pending",
        };
        // A SECOND stop, deliberately. With one stop the route flips to
        // "at_depot" the moment it is picked up, and the route-status guard
        // then rejects a retry — so a single-stop fixture tests that guard
        // rather than the stop's own. Confirmed by mutation: with one stop,
        // deleting the stop-status check left the retry test green.
        var second = new RouteStop
        {
            RouteId = route.Id,
            HouseholdId = household.Id,
            HouseholdName = "Second House",
            Address = "14 Test St",
            Lat = -27.531,
            Lng = 153.021,
            ContainerCount = 10,
            Status = "pending",
        };
        db.RouteStops.Add(stop);
        db.RouteStops.Add(second);
        await db.SaveChangesAsync();
        return (route.Id, stop.Id);
    }

    private static async Task<int?> ReportedCount(GoodSortDbContext db, Guid stopId) =>
        (await db.RouteStops.AsNoTracking().FirstAsync(s => s.Id == stopId)).ActualContainerCount;

    [Fact]
    public async Task A_wildly_inflated_pickup_count_is_clamped()
    {
        // The fraud in its plainest form: claim a hundred thousand containers
        // from one kerbside stop and be paid 5c for each at settle.
        var (client, driverId) = await SignIn("clamp-inflate@example.test");
        var (routeId, stopId) = await SeedRoute(driverId);

        var res = await client.PostAsJsonAsync(
            $"/api/routes/{routeId}/stops/{stopId}/pickup", new { actualCount = 100_000 });

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        using var db = Db();
        Assert.Equal(StopCap, await ReportedCount(db, stopId));
    }

    [Fact]
    public async Task A_negative_count_cannot_be_used_to_move_the_number_the_other_way()
    {
        var (client, driverId) = await SignIn("clamp-negative@example.test");
        var (routeId, stopId) = await SeedRoute(driverId);

        var res = await client.PostAsJsonAsync(
            $"/api/routes/{routeId}/stops/{stopId}/pickup", new { actualCount = -5000 });

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        using var db = Db();
        Assert.Equal(0, await ReportedCount(db, stopId));
    }

    [Fact]
    public async Task An_honest_count_passes_through_untouched()
    {
        // The clamp must bound fraud, not quietly rewrite real collections.
        var (client, driverId) = await SignIn("clamp-honest@example.test");
        var (routeId, stopId) = await SeedRoute(driverId);

        await client.PostAsJsonAsync(
            $"/api/routes/{routeId}/stops/{stopId}/pickup", new { actualCount = 37 });

        using var db = Db();
        Assert.Equal(37, await ReportedCount(db, stopId));
    }

    [Fact]
    public async Task A_driver_cannot_report_a_pickup_on_someone_elses_route()
    {
        // Ownership is what makes the clamp meaningful. Without it, a driver
        // walks other people's routes to whatever the cap allows.
        var (_, ownerId) = await SignIn("clamp-owner@example.test");
        var (routeId, stopId) = await SeedRoute(ownerId);

        var (intruder, _) = await SignIn("clamp-intruder@example.test");
        var res = await intruder.PostAsJsonAsync(
            $"/api/routes/{routeId}/stops/{stopId}/pickup", new { actualCount = StopCap });

        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);

        using var db = Db();
        Assert.Null(await ReportedCount(db, stopId));
    }

    [Fact]
    public async Task An_anonymous_caller_cannot_report_a_pickup()
    {
        var (_, driverId) = await SignIn("clamp-anon@example.test");
        var (routeId, stopId) = await SeedRoute(driverId);

        var anon = _host.CreateClient();
        var res = await anon.PostAsJsonAsync(
            $"/api/routes/{routeId}/stops/{stopId}/pickup", new { actualCount = StopCap });

        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);

        using var db = Db();
        Assert.Null(await ReportedCount(db, stopId));
    }

    [Fact]
    public async Task A_stop_cannot_be_reported_twice()
    {
        // Each stop pays once. Re-reporting would let a driver stack the cap
        // repeatedly against a single kerb. The fixture has two stops so the
        // route stays in_progress and it is the stop's own guard under test.
        var (client, driverId) = await SignIn("clamp-twice@example.test");
        var (routeId, stopId) = await SeedRoute(driverId);

        var first = await client.PostAsJsonAsync(
            $"/api/routes/{routeId}/stops/{stopId}/pickup", new { actualCount = 20 });
        var second = await client.PostAsJsonAsync(
            $"/api/routes/{routeId}/stops/{stopId}/pickup", new { actualCount = StopCap });

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, second.StatusCode);

        using var db = Db();
        Assert.Equal(20, await ReportedCount(db, stopId));
    }
}
