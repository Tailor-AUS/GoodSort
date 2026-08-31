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
/// Boots the real application over HTTP and drives the activation path a first
/// member actually walks: get a code, verify it, scan a container, see credit.
///
/// Every other test in this project calls a service or a static helper
/// directly. That means routing, authentication, model binding, JSON shape and
/// DI have never been exercised by a test — all 153 of them could pass with
/// every endpoint returning 404, or with an endpoint that should require a
/// token happily serving anonymous callers. This class closes that gap for the
/// one path the whole product depends on.
///
/// Development + no connection string puts the app on the in-memory provider
/// (Program.cs:14), and Development + no ACS_CONNECTION_STRING makes SendOtp
/// return the code instead of mailing it (AuthService.cs:62-70). So the real
/// auth flow runs end to end here without a database or sending real email.
/// </summary>
public class ActivationPathTests : IClassFixture<ActivationPathTests.Host>
{
    private readonly Host _host;
    public ActivationPathTests(Host host) => _host = host;

    public class Host : WebApplicationFactory<Program>
    {
        // Unique per factory so one test's rows can never satisfy another's
        // assertion — the in-memory database is keyed by name and would
        // otherwise be shared across the whole test process.
        private readonly string _dbName = $"activation-{Guid.NewGuid():N}";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
            // Deliberately absent: ACS_CONNECTION_STRING. Present, and SendOtp
            // would try to mail a real address from a test run.

            builder.ConfigureServices(services =>
            {
                // The app registers the context by name; re-register it against
                // a per-factory database.
                services.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                services.RemoveAll<GoodSortDbContext>();
                services.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(_dbName));

                // Background loops generate runs and send reminders on timers.
                // Left running they mutate the same database mid-assertion,
                // which is a flaky test waiting to happen.
                services.RemoveAll<IHostedService>();
            });
        }
    }

    private record Member(HttpClient Client, string Token, Guid ProfileId, string Email);

    /// <summary>Real signup over HTTP: request a code, then exchange it for a token.</summary>
    private async Task<Member> SignUp(string email)
    {
        var client = _host.CreateClient();

        var send = await client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        Assert.Equal(HttpStatusCode.OK, send.StatusCode);
        var sendBody = await send.Content.ReadFromJsonAsync<JsonElement>();

        var code = sendBody.GetProperty("devCode").GetString();
        Assert.False(string.IsNullOrWhiteSpace(code),
            "Development send-otp must return devCode, otherwise no test can complete the real auth flow.");

        var verify = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        var verifyBody = await verify.Content.ReadFromJsonAsync<JsonElement>();

        var token = verifyBody.GetProperty("token").GetString()!;
        var profileId = verifyBody.GetProperty("profile").GetProperty("id").GetGuid();

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return new Member(client, token, profileId, email);
    }

    private static async Task<JsonElement> Profile(Member m)
    {
        var res = await m.Client.GetAsync($"/api/profiles/{m.ProfileId}");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task A_new_member_can_sign_up_scan_and_see_credit()
    {
        var m = await SignUp("activation-one@example.test");

        var before = await Profile(m);
        Assert.Equal(0, before.GetProperty("pendingCents").GetInt32());
        Assert.Equal(0, before.GetProperty("totalContainers").GetInt32());

        var scan = await m.Client.PostAsJsonAsync("/api/scans", new
        {
            barcode = "9300675024235",
            containerName = "Coca-Cola 375ml Can",
            material = "aluminium",
        });
        Assert.Equal(HttpStatusCode.OK, scan.StatusCode);

        var after = await Profile(m);
        Assert.Equal(1, after.GetProperty("totalContainers").GetInt32());

        // The first container is inside the launch-bonus cap, so it pays double
        // the sorting credit. Asserting the exact figure rather than "> 0" is
        // the point: a silent revert to 5c is the failure that matters, and a
        // greater-than assertion would sail straight past it.
        Assert.Equal(HouseholdCredit.CentsPerContainer * 2, after.GetProperty("pendingCents").GetInt32());
    }

    [Fact]
    public async Task Scanning_without_a_token_is_rejected()
    {
        // Guards the mirror image of the test above: the happy-path test sends
        // a token either way, so it can never notice the endpoint going open.
        //
        // /api/scans is protected twice — .RequireAuthorization() on the route
        // and a null-caller check in the handler — so neither one failing on
        // its own opens it. Confirmed by mutation: neutering either layer
        // alone leaves this test green, and only removing BOTH turns it red.
        // Worth knowing, because it means this assertion catches "the endpoint
        // is open", not "one particular guard is present".
        var anon = _host.CreateClient();

        var res = await anon.PostAsJsonAsync("/api/scans", new
        {
            barcode = "9300675024235",
            containerName = "Coca-Cola 375ml Can",
            material = "aluminium",
        });

        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task A_wrong_code_does_not_issue_a_token()
    {
        var client = _host.CreateClient();
        const string email = "activation-wrongcode@example.test";

        var send = await client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        Assert.Equal(HttpStatusCode.OK, send.StatusCode);
        var real = (await send.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("devCode").GetString()!;

        // Any six digits that are not the issued code.
        var wrong = real == "000000" ? "111111" : "000000";

        var verify = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = wrong });
        Assert.Equal(HttpStatusCode.Unauthorized, verify.StatusCode);
    }

    [Fact]
    public async Task Credit_accrues_across_scans_and_the_bonus_stops_at_the_cap()
    {
        var m = await SignUp("activation-cap@example.test");

        var cap = LaunchBonus.DefaultCapContainers;
        for (var i = 0; i < cap + 1; i++)
        {
            var res = await m.Client.PostAsJsonAsync("/api/scans", new
            {
                barcode = "9300675024235",
                containerName = "Coca-Cola 375ml Can",
                material = "aluminium",
            });
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        }

        var after = await Profile(m);
        Assert.Equal(cap + 1, after.GetProperty("totalContainers").GetInt32());

        // cap containers at double, then the next one back at the normal rate.
        // This is the assertion that would catch an off-by-one paying the bonus
        // forever — the expensive direction of that mistake.
        var expected = (cap * HouseholdCredit.CentsPerContainer * 2) + HouseholdCredit.CentsPerContainer;
        Assert.Equal(expected, after.GetProperty("pendingCents").GetInt32());
    }
}
