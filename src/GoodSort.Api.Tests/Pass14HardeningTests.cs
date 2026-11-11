using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using GoodSort.Api.Tests.OpaqueBox;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace GoodSort.Api.Tests;

/// <summary>
/// Pins the Pass 14 QA &amp; financial/privacy hardening fixes (TailorAU/tailor-group#600):
/// 1. POST /api/routes/{id}/claim atomic single-driver claim + full graph (/start, /pickup, /skip)
///    and POST /api/routes/{id}/settle clearing household PendingCents -> ClearedCents, updating Bin,
///    and crediting Container Mafia ($1 first-pickup bonus clearance + 1c/can commission).
/// 2. GET /api/profiles/{id}/network privacy minimisation (first name only, no raw Profile.Id GUIDs).
/// 3. AuthService.VerifyOtp Guid.Empty / self-referral rejection so blank GUIDs never poison ReferrerId.
/// </summary>
public class Pass14HardeningTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;

    public Pass14HardeningTests(OpaqueBoxHost host) => _host = host;

    [Fact]
    public async Task Route_claim_and_settle_clear_household_pending_credits_update_bin_and_credit_container_mafia()
    {
        var (referrerClient, _, referrerId) = await _host.SignInMemberAsync($"pass14-ref-{Guid.NewGuid():N}@example.test");
        var (sorterClient, _, sorterId) = await _host.SignInMemberAsync($"pass14-sort-{Guid.NewGuid():N}@example.test");
        var (driverA, _, driverAId) = await _host.SignInMemberAsync($"pass14-drvA-{Guid.NewGuid():N}@example.test");
        var (driverB, _, driverBId) = await _host.SignInMemberAsync($"pass14-drvB-{Guid.NewGuid():N}@example.test");
        _ = referrerClient;
        _ = sorterClient;

        const int containerCount = 25;
        Guid householdId;
        Guid binId;
        Guid routeId;
        Guid stopId;

        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var referrer = await db.Profiles.FirstAsync(p => p.Id == referrerId);
            referrer.PendingCents = 100; // $1 signup bonus awaiting neighbour's first verified pickup

            var sorter = await db.Profiles.FirstAsync(p => p.Id == sorterId);
            sorter.ReferrerId = referrerId;
            sorter.PendingCents = containerCount * 10; // 25 containers @ 10c = 250c
            sorter.TotalContainers = containerCount;

            var hh = new Household
            {
                Name = "Moorooka Home",
                Address = "42 Mayfield Rd, Moorooka QLD 4105",
                Suburb = "Moorooka",
                Type = "residential",
                Lat = -27.530,
                Lng = 153.025,
                PendingContainers = containerCount,
                PendingValueCents = containerCount * 10,
                EstimatedBags = 1,
                BinIsOut = true,
                BinIsOutAt = DateTime.UtcNow.AddMinutes(-10),
                AccessConsent = true,
            };
            sorter.HouseholdId = hh.Id;

            var bin = new Bin
            {
                Code = $"GS-14-{Guid.NewGuid():N}"[..12],
                Name = hh.Name,
                Address = hh.Address,
                Lat = hh.Lat,
                Lng = hh.Lng,
                HouseholdId = hh.Id,
                Status = "active",
                PendingContainers = containerCount,
                PendingValueCents = containerCount * 10,
                LastCollectedAt = null,
            };

            var scans = Enumerable.Range(0, containerCount)
                .Select(_ => new Scan
                {
                    UserId = sorterId,
                    HouseholdId = hh.Id,
                    Barcode = "9300675001113",
                    ContainerName = "Aluminium Can 375mL",
                    Material = "aluminium",
                    RefundCents = 10,
                    Status = "pending",
                })
                .ToList();

            var depot = await db.Depots.FirstOrDefaultAsync() ?? new Depot
            {
                Name = "Moorooka Depot",
                Address = "100 Ipswich Rd, Moorooka QLD 4105",
                Lat = -27.532,
                Lng = 153.021,
            };
            if (db.Entry(depot).State == EntityState.Detached) db.Depots.Add(depot);

            var route = new CollectionRoute
            {
                Status = "pending",
                DepotId = depot.Id,
                TotalContainers = containerCount,
            };
            var stop = new RouteStop
            {
                RouteId = route.Id,
                HouseholdId = hh.Id,
                Sequence = 0,
                ContainerCount = containerCount,
                EstimatedBags = 1,
                Status = "pending",
            };

            db.Households.Add(hh);
            db.Bins.Add(bin);
            db.Scans.AddRange(scans);
            db.Routes.Add(route);
            db.RouteStops.Add(stop);
            await db.SaveChangesAsync();

            householdId = hh.Id;
            binId = bin.Id;
            routeId = route.Id;
            stopId = stop.Id;
        }

        // Driver A claims; Driver B loses the claim
        var claimA = await driverA.PostAsJsonAsync($"/api/routes/{routeId}/claim", new { driverId = driverBId });
        Assert.Equal(HttpStatusCode.OK, claimA.StatusCode);
        var claimJson = await claimA.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(driverAId, claimJson.GetProperty("driverId").GetGuid());
        Assert.Equal(1, claimJson.GetProperty("stops").GetArrayLength());

        var claimB = await driverB.PostAsJsonAsync($"/api/routes/{routeId}/claim", new { driverId = driverBId });
        Assert.Equal(HttpStatusCode.BadRequest, claimB.StatusCode);

        // Start, pickup (preserving ordered Stops + Depot), and settle
        var startRes = await driverA.PostAsync($"/api/routes/{routeId}/start", null);
        Assert.Equal(HttpStatusCode.OK, startRes.StatusCode);
        Assert.Equal(1, (await startRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("stops").GetArrayLength());

        var pickupRes = await driverA.PostAsJsonAsync($"/api/routes/{routeId}/stops/{stopId}/pickup", new { actualCount = containerCount });
        Assert.Equal(HttpStatusCode.OK, pickupRes.StatusCode);
        var pickupJson = await pickupRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("at_depot", pickupJson.GetProperty("status").GetString());

        var settleRes = await driverA.PostAsync($"/api/routes/{routeId}/settle", null);
        Assert.Equal(HttpStatusCode.OK, settleRes.StatusCode);

        // Double settle rejected cleanly
        var secondSettle = await driverA.PostAsync($"/api/routes/{routeId}/settle", null);
        Assert.Equal(HttpStatusCode.BadRequest, secondSettle.StatusCode);

        // Verify sorter, referrer, driver, household, and bin financial & state invariants
        using (var verifyScope = _host.Services.CreateScope())
        {
            var db = verifyScope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var sorter = await db.Profiles.AsNoTracking().FirstAsync(p => p.Id == sorterId);
            var referrer = await db.Profiles.AsNoTracking().FirstAsync(p => p.Id == referrerId);
            var driver = await db.Profiles.AsNoTracking().FirstAsync(p => p.Id == driverAId);
            var hh = await db.Households.AsNoTracking().FirstAsync(h => h.Id == householdId);
            var bin = await db.Bins.AsNoTracking().FirstAsync(b => b.Id == binId);
            var scans = await db.Scans.AsNoTracking().Where(s => s.HouseholdId == householdId && s.UserId == sorterId).ToListAsync();

            Assert.Equal(0, sorter.PendingCents);
            Assert.Equal(250, sorter.ClearedCents);
            Assert.All(scans, s => Assert.Equal("settled", s.Status));

            // Referrer: $1 (100c) pending signup bonus moved to ClearedCents + 25 * 1c = 25c commission -> 125c ClearedCents
            Assert.Equal(0, referrer.PendingCents);
            Assert.Equal(125, referrer.ClearedCents);

            // Driver: 25 * 5c = 125c
            Assert.Equal(125, driver.ClearedCents);

            Assert.Equal(0, hh.PendingContainers);
            Assert.Equal(0, hh.PendingValueCents);
            Assert.False(hh.BinIsOut);

            Assert.Equal(0, bin.PendingContainers);
            Assert.Equal(0, bin.PendingValueCents);
            Assert.NotNull(bin.LastCollectedAt);
        }
    }

    [Fact]
    public async Task Network_endpoint_returns_first_name_only_and_omits_raw_profile_guids()
    {
        var (referrerClient, _, referrerId) = await _host.SignInMemberAsync($"pass14-net-{Guid.NewGuid():N}@example.test");

        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var hh = new Household
            {
                Name = "Connor Home",
                Address = "10 Boundary St, West End QLD 4101",
                Suburb = "West End",
                Type = "residential",
                Lat = -27.481,
                Lng = 153.010,
            };
            var neighbour = new Profile
            {
                Email = $"sarah.connor.{Guid.NewGuid():N}@example.test",
                Name = "Sarah Connor",
                ReferrerId = referrerId,
                HouseholdId = hh.Id,
                TotalContainers = 42,
            };
            db.Households.Add(hh);
            db.Profiles.Add(neighbour);
            await db.SaveChangesAsync();
        }

        var res = await referrerClient.GetAsync($"/api/profiles/{referrerId}/network");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(1, json.GetProperty("sortersCount").GetInt32());
        Assert.Equal(1, json.GetProperty("activeHouseholds").GetInt32());
        Assert.Equal(42, json.GetProperty("referredContainers").GetInt32());

        var sorters = json.GetProperty("sorters");
        Assert.Equal(1, sorters.GetArrayLength());
        var first = sorters[0];
        Assert.Equal("Sarah", first.GetProperty("name").GetString());
        Assert.False(first.TryGetProperty("id", out _));
        Assert.False(first.TryGetProperty("Id", out _));
    }

    [Fact]
    public async Task VerifyOtp_ignores_empty_or_self_referrerId_so_later_real_neighbour_invite_succeeds()
    {
        var (_, _, realReferrerId) = await _host.SignInMemberAsync($"pass14-realref-{Guid.NewGuid():N}@example.test");
        var email = $"pass14-invitee-{Guid.NewGuid():N}@example.test";

        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var cfg = scope.ServiceProvider.GetRequiredService<IConfiguration>();
            var auth = scope.ServiceProvider.GetRequiredService<AuthService>();
            var secret = cfg["JWT_SECRET"]!;

            db.OtpCodes.Add(new OtpCode
            {
                Email = email,
                CodeHash = OtpHash.Compute("111222", secret),
                ExpiresAt = DateTime.UtcNow.AddMinutes(10),
            });
            await db.SaveChangesAsync();

            var (_, createdProfile, err1) = await auth.VerifyOtp(email, "111222", Guid.Empty);
            Assert.Null(err1);
            Assert.NotNull(createdProfile);
            Assert.Null(createdProfile!.ReferrerId);

            // Self-referral attempt is rejected
            db.OtpCodes.Add(new OtpCode
            {
                Email = email,
                CodeHash = OtpHash.Compute("222333", secret),
                ExpiresAt = DateTime.UtcNow.AddMinutes(10),
            });
            await db.SaveChangesAsync();

            var (_, selfAttemptProfile, errSelf) = await auth.VerifyOtp(email, "222333", createdProfile.Id);
            Assert.Null(errSelf);
            Assert.Null(selfAttemptProfile!.ReferrerId);

            // Subsequent OTP sign-in (before household creation) with a real neighbour's referrerId succeeds
            db.OtpCodes.Add(new OtpCode
            {
                Email = email,
                CodeHash = OtpHash.Compute("333444", secret),
                ExpiresAt = DateTime.UtcNow.AddMinutes(10),
            });
            await db.SaveChangesAsync();

            var (_, updatedProfile, err2) = await auth.VerifyOtp(email, "333444", realReferrerId);
            Assert.Null(err2);
            Assert.NotNull(updatedProfile);
            Assert.Equal(realReferrerId, updatedProfile!.ReferrerId);
        }
    }
}
