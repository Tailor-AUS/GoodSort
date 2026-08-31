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
/// A scan token may be spent exactly once.
///
/// /confirm credits from the signed token rather than the request body, which
/// stops a client inventing containers. But a signature only proves the token
/// is genuine — it says nothing about whether it has already been redeemed, and
/// the token lives ten minutes.
///
/// The perceptual-hash replay check cannot cover that on its own, because it is
/// fail-open by construction: PerceptualHash.TryCompute returns null when
/// ImageSharp cannot decode the image, and ImageSharp does not decode HEIC —
/// the iPhone default. A photo chosen from an iPhone library therefore reaches
/// /confirm with no hash, and the anti-farm defence quietly disables itself for
/// that scan. That is not an exotic attack; it is a common device.
///
/// The cost is not really the credit. Scans are what unlock a suburb, and an
/// unlocked suburb sends a real van to a real kerb.
///
/// These mint a genuine token from the application's own ScanTokenService,
/// which is what /confirm verifies against, so no vision provider is needed to
/// exercise the endpoint.
/// </summary>
public class ScanTokenSingleUseTests : IClassFixture<ScanTokenSingleUseTests.Host>
{
    private readonly Host _host;
    public ScanTokenSingleUseTests(Host host) => _host = host;

    public class Host : WebApplicationFactory<Program>
    {
        private readonly string _dbName = $"scantoken-{Guid.NewGuid():N}";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
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
        var code = (await send.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verify = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        var body = await verify.Content.ReadFromJsonAsync<JsonElement>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body.GetProperty("token").GetString());
        return (client, body.GetProperty("profile").GetProperty("id").GetGuid());
    }

    /// <summary>
    /// A real token for this member, with no PhotoHash — the HEIC case, where
    /// the replay check is switched off and only single-use redemption is left.
    /// </summary>
    private string MintUnhashedToken(Guid profileId)
    {
        var tokens = _host.Services.GetRequiredService<ScanTokenService>();
        return tokens.Issue(new ScanTokenPayload
        {
            Uid = profileId,
            Items = [new ScanTokenItem { Name = "Coca-Cola 375ml Can", Material = "aluminium", Count = 1, Eligible = true }],
            PhotoHash = null,
        }, TimeSpan.FromMinutes(10));
    }

    private static async Task<int> PendingCents(HttpClient client, Guid profileId)
    {
        var res = await client.GetAsync($"/api/profiles/{profileId}");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("pendingCents").GetInt32();
    }

    [Fact]
    public async Task A_scan_token_cannot_be_confirmed_twice()
    {
        var (client, profileId) = await SignIn("scantoken-replay@example.test");
        var token = MintUnhashedToken(profileId);

        var first = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var creditedOnce = await PendingCents(client, profileId);
        Assert.True(creditedOnce > 0, "The first confirm should credit the member.");

        var second = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
        Assert.Equal(HttpStatusCode.BadRequest, second.StatusCode);

        Assert.Equal(creditedOnce, await PendingCents(client, profileId));
    }

    [Fact]
    public async Task Replaying_a_token_ten_times_credits_once()
    {
        // The shape of the actual farm: loop the same token for the ten minutes
        // it lives. One accepted confirm, nine refusals, one container's credit.
        var (client, profileId) = await SignIn("scantoken-farm@example.test");
        var token = MintUnhashedToken(profileId);

        var accepted = 0;
        for (var i = 0; i < 10; i++)
        {
            var res = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
            if (res.StatusCode == HttpStatusCode.OK) accepted++;
        }

        Assert.Equal(1, accepted);
        Assert.Equal(HouseholdCredit.CentsPerContainer * 2, await PendingCents(client, profileId));
    }

    [Fact]
    public async Task Two_different_tokens_are_both_honoured()
    {
        // The guard must reject reuse, not scanning. A member with two genuine
        // scans gets paid for both.
        var (client, profileId) = await SignIn("scantoken-distinct@example.test");

        var a = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = MintUnhashedToken(profileId) });
        var b = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = MintUnhashedToken(profileId) });

        Assert.Equal(HttpStatusCode.OK, a.StatusCode);
        Assert.Equal(HttpStatusCode.OK, b.StatusCode);
        Assert.Equal(HouseholdCredit.CentsPerContainer * 2 * 2, await PendingCents(client, profileId));
    }

    [Fact]
    public async Task A_token_minted_for_someone_else_is_refused()
    {
        // Uid is committed inside the signature, so a token cannot be moved
        // between accounts even though it is a bearer credential.
        var (mine, _) = await SignIn("scantoken-owner@example.test");
        var (_, otherProfileId) = await SignIn("scantoken-other@example.test");

        var res = await mine.PostAsJsonAsync("/api/scan/photo/confirm",
            new { scanToken = MintUnhashedToken(otherProfileId) });

        Assert.True(res.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.BadRequest,
            $"Expected the token to be refused, got {(int)res.StatusCode}.");
    }

    [Fact]
    public async Task A_tampered_token_is_refused()
    {
        var (client, profileId) = await SignIn("scantoken-tampered@example.test");
        var token = MintUnhashedToken(profileId);

        // Flip the payload but keep the signature: the whole reason /confirm
        // reads items from the token instead of the request body.
        var parts = token.Split('.');
        var forged = parts[0][..^2] + (parts[0].EndsWith("AA") ? "BB" : "AA") + "." + parts[1];

        var res = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = forged });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal(0, await PendingCents(client, profileId));
    }
}
