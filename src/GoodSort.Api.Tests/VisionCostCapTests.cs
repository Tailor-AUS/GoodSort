using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
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
/// The spend guardrails on /api/scan/photo.
///
/// Every photo scan is a paid inference call — Tailor Vision billed via BAINK,
/// or Azure OpenAI on the fallback. The endpoint is authenticated but that is
/// no protection at all here: signing up costs nothing, so one account looping
/// this endpoint is one account spending the day's budget. The per-user cap is
/// the one that matters; the global cap is the backstop for several accounts
/// doing it at once.
///
/// Neither was tested. Both are ordinary integers read from configuration, so
/// a wrong comparison or a wrong counting window fails open — the calls go
/// through, the money goes out, and nothing looks wrong until a bill arrives.
///
/// These drive the real endpoint with deliberately tiny caps. No inference
/// happens: with no vision provider configured the service logs a failed
/// VisionCall and returns "temporarily unavailable", which is exactly the path
/// that still consumes a slot — a failed call can still have cost money.
/// </summary>
public class VisionCostCapTests : IClassFixture<VisionCostCapTests.Host>
{
    private const int PerUserCap = 3;
    private const int GlobalCap = 5;

    private readonly Host _host;
    public VisionCostCapTests(Host host) => _host = host;

    public class Host : WebApplicationFactory<Program>
    {
        public string DbName { get; } = $"vision-{Guid.NewGuid():N}";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
            // Small enough to reach in a test; the real defaults are 100 and 2000.
            builder.UseSetting("VISION_PER_USER_DAILY_CAP", PerUserCap.ToString());
            builder.UseSetting("VISION_DAILY_CAP", GlobalCap.ToString());
            // No TAILOR_VISION_API_KEY and no AZURE_OPENAI_KEY: nothing is
            // called out to, and no test can accidentally spend money.

            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                services.RemoveAll<GoodSortDbContext>();
                services.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(DbName));
                services.RemoveAll<IHostedService>();
            });
        }
    }

    /// <summary>A fresh database per test, since the caps count rows.</summary>
    private GoodSortDbContext Db()
    {
        var scope = _host.Services.CreateScope();
        return scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
    }

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

    private static string TinyImage =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes("not-a-real-image-but-well-formed-base64"));

    private static Task<HttpResponseMessage> Scan(HttpClient client) =>
        client.PostAsJsonAsync("/api/scan/photo", new { image = TinyImage });

    /// <summary>Records prior paid calls without going near the endpoint.</summary>
    private async Task SeedCalls(Guid? userId, int count, TimeSpan? age = null)
    {
        using var db = Db();
        for (var i = 0; i < count; i++)
            db.VisionCalls.Add(new VisionCall
            {
                Provider = "openai",
                Success = true,
                UserId = userId,
                CreatedAt = DateTime.UtcNow - (age ?? TimeSpan.Zero),
            });
        await db.SaveChangesAsync();
    }

    private async Task ClearCalls()
    {
        using var db = Db();
        db.VisionCalls.RemoveRange(await db.VisionCalls.ToListAsync());
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task One_account_cannot_spend_past_its_own_daily_cap()
    {
        await ClearCalls();
        var (client, profileId) = await SignIn("vision-cap@example.test");

        await SeedCalls(profileId, PerUserCap);

        var res = await Scan(client);
        Assert.Equal(HttpStatusCode.TooManyRequests, res.StatusCode);
    }

    [Fact]
    public async Task Below_the_cap_the_scan_is_allowed_through()
    {
        // The cap must stop abuse, not the product. If this ever fails the
        // endpoint is refusing legitimate scans, which is the same bug in the
        // opposite direction.
        await ClearCalls();
        var (client, profileId) = await SignIn("vision-under@example.test");

        await SeedCalls(profileId, PerUserCap - 1);

        var res = await Scan(client);
        Assert.NotEqual(HttpStatusCode.TooManyRequests, res.StatusCode);
    }

    [Fact]
    public async Task Yesterdays_calls_do_not_count_against_today()
    {
        // The window is 24 hours. Counting all history would permanently lock
        // out a member who scanned a lot once.
        await ClearCalls();
        var (client, profileId) = await SignIn("vision-window@example.test");

        await SeedCalls(profileId, PerUserCap * 3, age: TimeSpan.FromHours(25));

        var res = await Scan(client);
        Assert.NotEqual(HttpStatusCode.TooManyRequests, res.StatusCode);
    }

    [Fact]
    public async Task Another_members_calls_do_not_count_against_mine()
    {
        // The per-user cap must partition by user. If it did not, the busiest
        // member of the day would lock out everyone else.
        await ClearCalls();
        var (_, otherId) = await SignIn("vision-other@example.test");
        await SeedCalls(otherId, PerUserCap);

        var (mine, _) = await SignIn("vision-mine@example.test");
        var res = await Scan(mine);

        Assert.NotEqual(HttpStatusCode.TooManyRequests, res.StatusCode);
    }

    [Fact]
    public async Task The_global_cap_stops_a_fresh_account_once_the_day_is_spent()
    {
        // The backstop: several accounts each staying under the per-user cap
        // must still not drain the budget between them.
        await ClearCalls();
        await SeedCalls(userId: null, count: GlobalCap);

        var (client, _) = await SignIn("vision-global@example.test");
        var res = await Scan(client);

        Assert.Equal(HttpStatusCode.TooManyRequests, res.StatusCode);
    }

    [Fact]
    public async Task An_oversized_image_is_refused_before_any_inference_happens()
    {
        // Rejected on size before the caps are even consulted, so a huge
        // payload cannot cost money or consume a slot.
        await ClearCalls();
        var (client, _) = await SignIn("vision-huge@example.test");

        var huge = new string('A', 2_000_001);
        var res = await client.PostAsJsonAsync("/api/scan/photo", new { image = huge });

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, res.StatusCode);

        using var db = Db();
        Assert.Equal(0, await db.VisionCalls.CountAsync());
    }

    [Fact]
    public async Task An_anonymous_caller_cannot_spend_anything()
    {
        await ClearCalls();
        var anon = _host.CreateClient();

        var res = await Scan(anon);

        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);

        using var db = Db();
        Assert.Equal(0, await db.VisionCalls.CountAsync());
    }
}
