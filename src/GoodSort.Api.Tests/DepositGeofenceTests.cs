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
/// The unattended-bin geofence, which was the last named anti-fraud control
/// with no test.
///
/// When a scan token is bound to a physical bin, the member must actually be at
/// that bin to claim the credit — otherwise, as the code puts it, anyone could
/// farm 5c deposits from their couch. The whole control rests on two things
/// being true: the bin's position is taken from the signed token rather than
/// the request, and a missing device location fails closed.
///
/// Both are the sort of thing that inverts quietly. A fence that reads the bin
/// position out of the request body is not a fence at all, it is a form the
/// attacker fills in. A fence that treats "no location" as "close enough" is
/// bypassed by deleting a field.
///
/// Distances below are real: Brisbane GPO to points a known distance away, so
/// the assertions test the fence rather than restating the implementation.
/// </summary>
public class DepositGeofenceTests : IClassFixture<DepositGeofenceTests.Host>
{
    // A bin in Moorooka, and points measured from it.
    private const double BinLat = -27.5333;
    private const double BinLng = 153.0167;

    private readonly Host _host;
    public DepositGeofenceTests(Host host) => _host = host;

    public class Host : WebApplicationFactory<Program>
    {
        private readonly string _db = $"geofence-{Guid.NewGuid():N}";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
            builder.ConfigureServices(s =>
            {
                s.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                s.RemoveAll<GoodSortDbContext>();
                s.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(_db));
                s.RemoveAll<IHostedService>();
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

    /// <summary>A genuine token bound to the bin above, as /api/scan/photo would issue.</summary>
    private string BinBoundToken(Guid profileId)
    {
        var tokens = _host.Services.GetRequiredService<ScanTokenService>();
        return tokens.Issue(new ScanTokenPayload
        {
            Uid = profileId,
            Items = [new ScanTokenItem { Name = "Coca-Cola 375ml Can", Material = "aluminium", Count = 1, Eligible = true }],
            BinCode = "GS-TEST-1",
            BinLat = BinLat,
            BinLng = BinLng,
        }, TimeSpan.FromMinutes(10));
    }

    /// <summary>The household path: no bin, so no location requirement.</summary>
    private string UnboundToken(Guid profileId)
    {
        var tokens = _host.Services.GetRequiredService<ScanTokenService>();
        return tokens.Issue(new ScanTokenPayload
        {
            Uid = profileId,
            Items = [new ScanTokenItem { Name = "Coca-Cola 375ml Can", Material = "aluminium", Count = 1, Eligible = true }],
        }, TimeSpan.FromMinutes(10));
    }

    [Fact]
    public async Task Standing_at_the_bin_the_deposit_is_accepted()
    {
        var (client, profileId) = await SignIn("fence-at-bin@example.test");

        var res = await client.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = BinBoundToken(profileId),
            lat = BinLat,
            lng = BinLng,
        });

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task A_deposit_claimed_from_across_the_city_is_refused()
    {
        // Roughly 8 km north of the bin — the couch case.
        var (client, profileId) = await SignIn("fence-far@example.test");

        var res = await client.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = BinBoundToken(profileId),
            lat = -27.4600,
            lng = 153.0167,
        });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("from the bin", body.GetProperty("error").GetString()!);
    }

    [Fact]
    public async Task Omitting_the_location_fails_closed()
    {
        // The bypass worth guarding: if a missing location were treated as
        // "close enough", the fence is defeated by deleting a field.
        var (client, profileId) = await SignIn("fence-noloc@example.test");

        var res = await client.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = BinBoundToken(profileId),
        });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("Location required", body.GetProperty("error").GetString()!);
    }

    [Fact]
    public async Task The_bin_position_comes_from_the_token_not_the_request()
    {
        // The control's foundation. If the bin's position were read from the
        // request, an attacker would simply send their own coordinates as both
        // the bin and the device and always be at the bin. Here the request
        // claims a different bin entirely, and the token still decides.
        var (client, profileId) = await SignIn("fence-spoof@example.test");

        var res = await client.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = BinBoundToken(profileId),
            binCode = "GS-SOMEWHERE-ELSE",
            lat = -27.4600,          // where the attacker actually is
            lng = 153.0167,
        });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task A_household_scan_needs_no_location_at_all()
    {
        // The fence must apply to bin deposits only. Requiring location for a
        // kitchen-bench scan would break the ordinary path for anyone who
        // declines the permission prompt.
        var (client, profileId) = await SignIn("fence-household@example.test");

        var res = await client.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = UnboundToken(profileId),
        });

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task A_few_doors_down_is_still_at_the_bin()
    {
        // The radius is 150 m by default. GPS on a phone is not exact, and a
        // fence that only accepts a perfect fix rejects honest deposits — the
        // same control failing in the direction nobody notices.
        var (client, profileId) = await SignIn("fence-near@example.test");

        // ~90 m north: 0.0008 degrees of latitude.
        var res = await client.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = BinBoundToken(profileId),
            lat = BinLat + 0.0008,
            lng = BinLng,
        });

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }
}
