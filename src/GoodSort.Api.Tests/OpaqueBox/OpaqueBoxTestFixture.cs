using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace GoodSort.Api.Tests.OpaqueBox;

/// <summary>
/// Opaque-box test fixture providing an isolated web application factory
/// and convenience helpers for testing HTTP contracts end-to-end.
/// </summary>
public class OpaqueBoxHost : WebApplicationFactory<Program>
{
    private readonly string _dbName = $"opaque-box-{Guid.NewGuid():N}";
    public const string TestJwtSecret = "opaque-box-test-secret-key-0123456789-abcdef";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(Environments.Development);
        builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
        builder.UseSetting("JWT_SECRET", TestJwtSecret);
        builder.UseSetting("VISION_PER_USER_DAILY_CAP", "100");
        builder.UseSetting("VISION_DAILY_CAP", "2000");
        builder.UseSetting("DEPOSIT_GEOFENCE_RADIUS_M", "150.0");
        builder.UseSetting("DEPOSIT_REPLAY_HAMMING_MAX", "6");
        builder.UseSetting("DEPOSIT_REPLAY_WINDOW_HOURS", "24");

        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<GoodSortDbContext>>();
            services.RemoveAll<GoodSortDbContext>();
            services.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(_dbName));
            services.RemoveAll<IHostedService>();
        });
    }

    public HttpClient CreateAnonymousClient() => CreateClient();

    public async Task<(HttpClient Client, string Token, Guid ProfileId)> SignInMemberAsync(string email, Guid? referrerId = null)
    {
        var client = CreateClient();
        var sendRes = await client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        Assert.Equal(HttpStatusCode.OK, sendRes.StatusCode);
        var sendJson = await sendRes.Content.ReadFromJsonAsync<JsonElement>();
        var devCode = sendJson.GetProperty("devCode").GetString();
        Assert.NotNull(devCode);

        var verifyRes = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = devCode, referrerId });
        Assert.Equal(HttpStatusCode.OK, verifyRes.StatusCode);
        var verifyJson = await verifyRes.Content.ReadFromJsonAsync<JsonElement>();
        var token = verifyJson.GetProperty("token").GetString()!;
        var profileId = verifyJson.GetProperty("profile").GetProperty("id").GetGuid();

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return (client, token, profileId);
    }

    public string MintScanToken(
        Guid userId,
        List<ScanTokenItem>? items = null,
        string? binCode = null,
        double? binLat = null,
        double? binLng = null,
        string? photoHash = null,
        TimeSpan? ttl = null)
    {
        var tokens = Services.GetRequiredService<ScanTokenService>();
        var payload = new ScanTokenPayload
        {
            Uid = userId,
            Items = items ?? [new ScanTokenItem { Name = "Coca-Cola 375ml Can", Material = "aluminium", Count = 1, Eligible = true }],
            BinCode = binCode,
            BinLat = binLat,
            BinLng = binLng,
            PhotoHash = photoHash,
        };
        return tokens.Issue(payload, ttl ?? TimeSpan.FromMinutes(10));
    }

    public async Task<JsonElement> GetProfileAsync(HttpClient client, Guid profileId)
    {
        var res = await client.GetAsync($"/api/profiles/{profileId}");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    public async Task<JsonElement> GetHouseholdAsync(HttpClient client, Guid householdId)
    {
        var res = await client.GetAsync($"/api/households/{householdId}");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }
}
