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
/// Bounds on how much one account can put into /api/scans.
///
/// That endpoint takes the barcode, container name and material straight from
/// the request body. Unlike the photo path — where /confirm reads the items out
/// of a server-signed token and ignores the body — nothing here can prove a
/// container was ever physically scanned. It cannot be made to: the client is
/// the only witness.
///
/// The pending credit is not the exposure. It only becomes cash-out-eligible
/// through a runner's physical count at settlement, so invented scans do not
/// become money. Suburb volume is the exposure. Volume is what unlocks a run,
/// and a run is a real van driven to a real kerb — so a scripted account could
/// spend our money by fabricating demand that is not there.
///
/// These are therefore mitigation, not prevention, and the tests are written to
/// say so. Both limits are deliberately far outside what a person can do, and
/// both are tunable so ops can loosen them without a deploy if a real member
/// ever meets one.
/// </summary>
public class ScanFaucetLimitTests
{
    private const int DailyCap = 5;

    /// <summary>Rate limit raised out of the way; this host tests the daily cap.</summary>
    private class DailyCapHost : WebApplicationFactory<Program>
    {
        private readonly string _db = $"faucet-daily-{Guid.NewGuid():N}";
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
            builder.UseSetting("SCAN_DAILY_CAP", DailyCap.ToString());
            builder.UseSetting("SCAN_RATE_PER_MINUTE", "100000");
            builder.ConfigureServices(s =>
            {
                s.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                s.RemoveAll<GoodSortDbContext>();
                s.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(_db));
                s.RemoveAll<IHostedService>();
            });
        }
    }

    /// <summary>Daily cap raised out of the way; this host tests the rate limit.</summary>
    private class RateLimitHost : WebApplicationFactory<Program>
    {
        private readonly string _db = $"faucet-rate-{Guid.NewGuid():N}";
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
            builder.UseSetting("SCAN_RATE_PER_MINUTE", "5");
            builder.UseSetting("SCAN_DAILY_CAP", "100000");
            builder.ConfigureServices(s =>
            {
                s.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                s.RemoveAll<GoodSortDbContext>();
                s.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(_db));
                s.RemoveAll<IHostedService>();
            });
        }
    }

    private static async Task<HttpClient> SignIn(WebApplicationFactory<Program> host, string email)
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

    private static Task<HttpResponseMessage> Scan(HttpClient client) =>
        client.PostAsJsonAsync("/api/scans", new
        {
            barcode = "9300675024235",
            containerName = "Coca-Cola 375ml Can",
            material = "aluminium",
        });

    [Fact]
    public async Task One_account_cannot_scan_past_its_daily_cap()
    {
        using var host = new DailyCapHost();
        var client = await SignIn(host, "faucet-daily@example.test");

        for (var i = 0; i < DailyCap; i++)
            Assert.Equal(HttpStatusCode.OK, (await Scan(client)).StatusCode);

        Assert.Equal(HttpStatusCode.TooManyRequests, (await Scan(client)).StatusCode);
    }

    [Fact]
    public async Task Nothing_is_credited_by_a_refused_scan()
    {
        // The cap must stop the volume, not merely the response. A refused scan
        // that still bumped the household's pending containers would leave the
        // fabricated demand in place and only hide it from the caller.
        using var host = new DailyCapHost();
        var client = await SignIn(host, "faucet-nocredit@example.test");

        for (var i = 0; i < DailyCap; i++) await Scan(client);
        await Scan(client);   // refused

        using var scope = host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
        var profile = await db.Profiles.AsNoTracking()
            .FirstAsync(p => p.Email == "faucet-nocredit@example.test");

        Assert.Equal(DailyCap, profile.TotalContainers);
        Assert.Equal(DailyCap, await db.Scans.AsNoTracking().CountAsync(s => s.UserId == profile.Id));
    }

    [Fact]
    public async Task A_burst_is_throttled_per_member()
    {
        using var host = new RateLimitHost();
        var client = await SignIn(host, "faucet-burst@example.test");

        var codes = new List<HttpStatusCode>();
        for (var i = 0; i < 12; i++) codes.Add((await Scan(client)).StatusCode);

        Assert.Equal(5, codes.Count(c => c == HttpStatusCode.OK));
        Assert.Contains(HttpStatusCode.TooManyRequests, codes);
    }

    [Fact]
    public async Task One_members_burst_does_not_throttle_another()
    {
        // Partitioned by member, not by IP. An IP partition would punish a
        // household behind one address while a script simply changed
        // connections.
        using var host = new RateLimitHost();

        var noisy = await SignIn(host, "faucet-noisy@example.test");
        for (var i = 0; i < 12; i++) await Scan(noisy);

        var quiet = await SignIn(host, "faucet-quiet@example.test");
        Assert.Equal(HttpStatusCode.OK, (await Scan(quiet)).StatusCode);
    }

    [Fact]
    public async Task A_cap_of_zero_means_no_daily_limit_rather_than_no_scanning()
    {
        // Guards the direction that would take the product down: reading an
        // unset or zeroed cap as "nobody may scan" turns an ops mistake into an
        // outage.
        using var host = new UnlimitedHost();
        var client = await SignIn(host, "faucet-zero@example.test");

        for (var i = 0; i < 8; i++)
            Assert.Equal(HttpStatusCode.OK, (await Scan(client)).StatusCode);
    }

    private class UnlimitedHost : WebApplicationFactory<Program>
    {
        private readonly string _db = $"faucet-zero-{Guid.NewGuid():N}";
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
            builder.UseSetting("SCAN_DAILY_CAP", "0");
            builder.UseSetting("SCAN_RATE_PER_MINUTE", "100000");
            builder.ConfigureServices(s =>
            {
                s.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                s.RemoveAll<GoodSortDbContext>();
                s.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(_db));
                s.RemoveAll<IHostedService>();
            });
        }
    }
}
