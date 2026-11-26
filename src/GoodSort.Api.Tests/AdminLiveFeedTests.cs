using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace GoodSort.Api.Tests;

public class AdminLiveFeedTests : IClassFixture<AdminLiveFeedTests.Host>
{
    private readonly Host _host;

    public AdminLiveFeedTests(Host host) => _host = host;

    public class Host : WebApplicationFactory<Program>
    {
        private readonly string _dbName = $"live-feed-{Guid.NewGuid():N}";

        protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-live-feed-secret-at-least-32-chars!!");
            builder.UseSetting("ADMIN_SEED_EMAIL", "hello@thegoodsort.org");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                services.RemoveAll<GoodSortDbContext>();
                services.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(_dbName));
                services.RemoveAll<IHostedService>();
            });
        }
    }

    private async Task<(HttpClient Client, Guid ProfileId)> SignIn(string email)
    {
        var client = _host.CreateClient();
        var send = await client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        Assert.Equal(HttpStatusCode.OK, send.StatusCode);
        var code = (await send.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString()!;
        var verify = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        var json = await verify.Content.ReadFromJsonAsync<JsonElement>();
        var token = json.GetProperty("token").GetString()!;
        var profileId = json.GetProperty("profile").GetProperty("id").GetGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return (client, profileId);
    }

    [Fact]
    public async Task Live_feed_requires_admin_and_streams_events_otps_vision_and_tester_journeys()
    {
        var anon = _host.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/api/admin/live-feed")).StatusCode);

        var (memberClient, memberId) = await SignIn("suzie-tester@live.test");
        Assert.Equal(HttpStatusCode.Forbidden, (await memberClient.GetAsync("/api/admin/live-feed")).StatusCode);

        var (adminClient, _) = await SignIn("hello@thegoodsort.org");

        // Record anonymous diagnostic events + a pending unverified OTP + a synthetic health-check OTP + a VisionCall + a Scan
        Assert.Equal(HttpStatusCode.Accepted, (await anon.PostAsJsonAsync("/api/growth/events", new
        {
            name = "camera_denied",
            suburb = "Tarragindi",
            path = "/scan",
        })).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await anon.PostAsJsonAsync("/api/auth/send-otp", new
        {
            email = "unverified-friend@live.test",
        })).StatusCode);

        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            db.OtpCodes.Add(new OtpCode
            {
                Email = "acs-guard@thegoodsort.org",
                CodeHash = "synthetic",
                ExpiresAt = DateTime.UtcNow.AddMinutes(10),
            });
            db.VisionCalls.Add(new VisionCall
            {
                Provider = "openai",
                Success = true,
                ContainerCount = 1,
                DurationMs = 740,
                UserId = memberId,
            });
            db.Scans.Add(new Scan
            {
                UserId = memberId,
                Barcode = "PHOTO",
                ContainerName = "Coca-Cola 375ml",
                Material = "aluminium",
                RefundCents = 8,
                Status = "pending",
            });
            var prof = await db.Profiles.FindAsync(memberId);
            prof!.TotalContainers = 1;
            prof.PendingCents = 8;
            await db.SaveChangesAsync();
        }

        var res = await adminClient.GetAsync("/api/admin/live-feed?minutes=60&limit=100");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();

        var pulse = body.GetProperty("pulse");
        Assert.True(pulse.GetProperty("cameraDenied").GetInt32() >= 1);
        Assert.True(pulse.GetProperty("visionCalls").GetInt32() >= 1);
        Assert.Equal(740, pulse.GetProperty("avgVisionMs").GetInt32());
        Assert.True(pulse.GetProperty("scansCredited").GetInt32() >= 1);

        var stream = body.GetProperty("stream").EnumerateArray().ToList();
        Assert.Contains(stream, x => x.GetProperty("title").GetString() == "Camera permission denied");
        Assert.Contains(stream, x => x.GetProperty("kind").GetString() == "vision");
        Assert.Contains(stream, x => x.GetProperty("kind").GetString() == "scan");
        Assert.DoesNotContain(stream, x => (x.GetProperty("actor").GetString() ?? "").Contains("acs-guard@thegoodsort.org"));

        var testers = body.GetProperty("testers").EnumerateArray().ToList();
        Assert.Contains(testers, t => t.GetProperty("email").GetString() == "suzie-tester@live.test"
            && t.GetProperty("status").GetString() == "scanned_no_address");
        Assert.Contains(testers, t => t.GetProperty("email").GetString() == "unverified-friend@live.test"
            && t.GetProperty("status").GetString() == "otp_pending");
    }
}
