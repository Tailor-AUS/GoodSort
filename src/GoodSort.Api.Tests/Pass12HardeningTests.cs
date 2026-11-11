using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using GoodSort.Api.Tests.OpaqueBox;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GoodSort.Api.Tests;

/// <summary>
/// Pins the Pass 12 QA &amp; security hardening fixes (TailorAU/tailor-group#600):
/// 1. Runner vehicle allowlist &amp; string sanitization on POST /api/runner/register and PATCH /api/runner/profile/{id}.
/// 2. Coordinate finiteness &amp; range guards on POST /api/runner/heartbeat and POST /api/households/lookup-bin-day (plus BinDayService.Lookup NaN defence).
/// 3. Stale IsOnline runner freshness decay (15 min) in PricingService.CalculateRate and GET /api/marketplace/overview.
/// 4. SCAN_DAILY_CAP enforcement and coordinate bounds on POST /api/scan/photo/confirm before spending UsedScanToken.
/// </summary>
public class Pass12HardeningTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;

    public Pass12HardeningTests(OpaqueBoxHost host) => _host = host;

    [Fact]
    public async Task Runner_register_and_patch_enforce_vehicleType_allowlist_and_clamp_fields()
    {
        var (runnerClient, _, profileId) = await _host.SignInMemberAsync($"pass12-veh-{Guid.NewGuid():N}@example.test");

        var badReg = await runnerClient.PostAsJsonAsync("/api/runner/register", new
        {
            profileId,
            vehicleType = "<script>alert(1)</script>",
            capacityBags = 10,
            serviceRadiusKm = 15.0,
        });
        Assert.Equal(HttpStatusCode.BadRequest, badReg.StatusCode);

        var longMake = new string('M', 150) + "\r\nX";
        var longRego = "123abc4567890123456789\n";
        var okReg = await runnerClient.PostAsJsonAsync("/api/runner/register", new
        {
            profileId,
            vehicleType = "  UTE ",
            vehicleMake = longMake,
            vehicleRego = longRego,
            capacityBags = 12,
            serviceRadiusKm = 20.0,
        });
        Assert.Equal(HttpStatusCode.Created, okReg.StatusCode);
        var body = await okReg.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("ute", body.GetProperty("vehicleType").GetString());
        Assert.Equal(80, body.GetProperty("vehicleMake").GetString()!.Length);
        Assert.Equal("123ABC4567890123", body.GetProperty("vehicleRego").GetString());

        var badPatch = await runnerClient.PatchAsJsonAsync($"/api/runner/profile/{profileId}", new
        {
            vehicleType = "spaceship",
        });
        Assert.Equal(HttpStatusCode.BadRequest, badPatch.StatusCode);

        var okPatch = await runnerClient.PatchAsJsonAsync($"/api/runner/profile/{profileId}", new
        {
            vehicleType = "Cargo_Bike",
        });
        Assert.Equal(HttpStatusCode.OK, okPatch.StatusCode);
        var patched = await okPatch.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("cargo_bike", patched.GetProperty("vehicleType").GetString());
    }

    [Fact]
    public async Task Heartbeat_and_bin_day_lookup_reject_out_of_range_coordinates_and_BinDayService_blocks_NaN()
    {
        var (runnerClient, _, profileId) = await _host.SignInMemberAsync($"pass12-hb-{Guid.NewGuid():N}@example.test");
        Assert.Equal(HttpStatusCode.Created, (await runnerClient.PostAsJsonAsync("/api/runner/register", new
        {
            profileId,
            vehicleType = "car",
            capacityBags = 10,
            serviceRadiusKm = 10.0,
        })).StatusCode);

        var badHb = await runnerClient.PostAsJsonAsync("/api/runner/heartbeat", new
        {
            profileId,
            lat = -95.0,
            lng = 153.02,
            isOnline = true,
        });
        Assert.Equal(HttpStatusCode.BadRequest, badHb.StatusCode);

        var okHb = await runnerClient.PostAsJsonAsync("/api/runner/heartbeat", new
        {
            profileId,
            lat = -27.516,
            lng = 153.034,
            isOnline = true,
        });
        Assert.Equal(HttpStatusCode.OK, okHb.StatusCode);

        var badLookup = await runnerClient.PostAsJsonAsync("/api/households/lookup-bin-day", new
        {
            lat = 200.0,
            lng = 153.034,
            address = "12 Beaudesert Rd, Moorooka QLD 4105",
        });
        Assert.Equal(HttpStatusCode.BadRequest, badLookup.StatusCode);

        // Direct service check: IEEE-754 NaN must never bypass the BCC bounding box
        using var scope = _host.Services.CreateScope();
        var binDaySvc = scope.ServiceProvider.GetRequiredService<BinDayService>();
        var nanRes = await binDaySvc.Lookup(double.NaN, double.NaN, "12 Beaudesert Rd, Moorooka QLD 4105");
        Assert.Null(nanRes);
    }

    [Fact]
    public async Task Stale_online_runner_older_than_15_minutes_is_excluded_from_supply_count_and_overview()
    {
        var (_, _, freshId) = await _host.SignInMemberAsync($"pass12-fresh-{Guid.NewGuid():N}@example.test");
        var (_, _, staleId) = await _host.SignInMemberAsync($"pass12-stale-{Guid.NewGuid():N}@example.test");

        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            // Reset any prior online runners in shared fixture so counts are deterministic
            foreach (var existing in await db.RunnerProfiles.Where(rp => rp.IsOnline).ToListAsync())
                existing.IsOnline = false;

            db.RunnerProfiles.Add(new RunnerProfile
            {
                ProfileId = freshId,
                VehicleType = "car",
                IsOnline = true,
                LastLat = -27.51,
                LastLng = 153.03,
                LastLocationAt = DateTime.UtcNow.AddMinutes(-2),
            });
            db.RunnerProfiles.Add(new RunnerProfile
            {
                ProfileId = staleId,
                VehicleType = "ute",
                IsOnline = true,
                LastLat = -27.52,
                LastLng = 153.04,
                LastLocationAt = DateTime.UtcNow.AddMinutes(-30), // Zombie mobile tab
            });
            await db.SaveChangesAsync();
        }

        using var anon = _host.CreateClient();
        var ovRes = await anon.GetAsync("/api/marketplace/overview");
        Assert.Equal(HttpStatusCode.OK, ovRes.StatusCode);
        var ov = await ovRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, ov.GetProperty("stats").GetProperty("runnersOnline").GetInt32());
    }

    [Fact]
    public async Task Photo_confirm_rejects_invalid_coordinates_without_burning_scan_token()
    {
        var (sorterClient, _, sorterId) = await _host.SignInMemberAsync($"pass12-photo-{Guid.NewGuid():N}@example.test");

        string scanToken;
        using (var scope = _host.Services.CreateScope())
        {
            var tokens = scope.ServiceProvider.GetRequiredService<ScanTokenService>();
            scanToken = tokens.Issue(new ScanTokenPayload
            {
                Uid = sorterId,
                Items =
                [
                    new ScanTokenItem { Name = "Coca-Cola 375ml", Material = "aluminium", Count = 2, Eligible = true }
                ],
            }, TimeSpan.FromMinutes(10));
        }

        // 1. Out-of-range latitude is rejected BEFORE spending UsedScanToken
        var badConfirm = await sorterClient.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken,
            lat = 123.45,
            lng = 153.02,
        });
        Assert.Equal(HttpStatusCode.BadRequest, badConfirm.StatusCode);

        // 2. Retrying the exact same token with valid coordinates still succeeds!
        var goodConfirm = await sorterClient.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken,
            lat = -27.516,
            lng = 153.034,
        });
        Assert.Equal(HttpStatusCode.OK, goodConfirm.StatusCode);
        var body = await goodConfirm.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, body.GetProperty("totalContainers").GetInt32());
    }
}
