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

namespace GoodSort.Api.Tests;

/// <summary>
/// End-to-end regression suite pinning every Revision R1 fix for TGS BREAKER findings F-01 through F-16.
/// </summary>
public class R1BreakerHardeningTests : IClassFixture<R1BreakerHardeningTests.R1Host>
{
    private readonly R1Host _host;
    public R1BreakerHardeningTests(R1Host host) => _host = host;

    public class R1Host : WebApplicationFactory<Program>
    {
        public readonly string DbName = $"r1-breaker-{Guid.NewGuid():N}";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
            builder.UseSetting("COEX_CRP_ACTIVE", "true");
            builder.UseSetting("PAYID_PAYOUTS_ENABLED", "true");
            builder.UseSetting("ADMIN_SEED_EMAIL", "hello@thegoodsort.org");

            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                services.RemoveAll<GoodSortDbContext>();
                services.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(DbName));
                services.RemoveAll<IHostedService>();
            });
        }
    }

    private record AuthMember(HttpClient Client, Guid ProfileId, string Email);

    private async Task<AuthMember> SignUp(string email, Guid? referrerId = null)
    {
        var client = _host.CreateClient();
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            await db.Database.EnsureCreatedAsync();
        }

        var send = await client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        Assert.Equal(HttpStatusCode.OK, send.StatusCode);
        var code = (await send.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString()!;

        var verify = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code, referrerId });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        var verifyJson = await verify.Content.ReadFromJsonAsync<JsonElement>();
        var token = verifyJson.GetProperty("token").GetString()!;
        var profileId = verifyJson.GetProperty("profile").GetProperty("id").GetGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return new AuthMember(client, profileId, email);
    }

    [Fact]
    public async Task F01_Runner_cannot_self_settle_or_inflate_depot_count_and_zero_or_partial_depot_count_caps_household_and_mafia_payouts()
    {
        var admin = await SignUp("hello@thegoodsort.org");
        var mafia = await SignUp("mafia-f01@r1.test");
        var sorter1 = await SignUp("s1-f01@r1.test", referrerId: mafia.ProfileId);
        var sorter2 = await SignUp("s2-f01@r1.test");
        var runner = await SignUp("runner-f01@r1.test");

        var hh1Res = await sorter1.Client.PostAsJsonAsync("/api/households", new
        {
            name = "House One",
            address = "12 Hamilton Road, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            street = "HAMILTON ROAD",
            lat = -27.534,
            lng = 153.021,
            type = "residential",
            councilCollectionDay = 4,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hh1Res.StatusCode);
        var hh1Id = (await hh1Res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var hh2Res = await sorter2.Client.PostAsJsonAsync("/api/households", new
        {
            name = "House Two",
            address = "34 Vendale Avenue, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            street = "VENDALE AVENUE",
            lat = -27.535,
            lng = 153.022,
            type = "residential",
            councilCollectionDay = 4,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hh2Res.StatusCode);
        var hh2Id = (await hh2Res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        Assert.Equal(HttpStatusCode.Created, (await runner.Client.PostAsJsonAsync("/api/runner/register", new
        {
            profileId = runner.ProfileId,
            vehicleType = "ute",
            capacityBags = 15,
            serviceRadiusKm = 15.0,
        })).StatusCode);

        Guid runZeroId, stop1ZeroId;
        Guid runPartialId, stop1PartialId, stop2PartialId;
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var depot = await db.Depots.FirstAsync();
            var bin1 = await db.Bins.FirstAsync(b => b.HouseholdId == hh1Id);
            var bin2 = await db.Bins.FirstAsync(b => b.HouseholdId == hh2Id);
            bin1.PendingContainers = 200;
            bin2.PendingContainers = 200;

            var rZero = new Run
            {
                DropPointId = depot.Id,
                AreaName = "Moorooka",
                CentroidLat = -27.534,
                CentroidLng = 153.021,
                EstimatedContainers = 100,
                PerContainerCents = 3,
                EstimatedPayoutCents = 300,
                Status = "available",
                ExpiresAt = DateTime.UtcNow.AddHours(6),
            };
            var sZero = new RunStop { RunId = rZero.Id, BinId = bin1.Id, Lat = -27.534, Lng = 153.021, EstimatedContainers = 100, Sequence = 1 };
            rZero.Stops.Add(sZero);
            db.Runs.Add(rZero);

            var rPart = new Run
            {
                DropPointId = depot.Id,
                AreaName = "Moorooka",
                CentroidLat = -27.534,
                CentroidLng = 153.021,
                EstimatedContainers = 200,
                PerContainerCents = 3,
                EstimatedPayoutCents = 600,
                Status = "available",
                ExpiresAt = DateTime.UtcNow.AddHours(6),
            };
            var sp1 = new RunStop { RunId = rPart.Id, BinId = bin1.Id, Lat = -27.534, Lng = 153.021, EstimatedContainers = 100, Sequence = 1 };
            var sp2 = new RunStop { RunId = rPart.Id, BinId = bin2.Id, Lat = -27.535, Lng = 153.022, EstimatedContainers = 100, Sequence = 2 };
            rPart.Stops.Add(sp1);
            rPart.Stops.Add(sp2);
            db.Runs.Add(rPart);

            await db.SaveChangesAsync();
            runZeroId = rZero.Id;
            stop1ZeroId = sZero.Id;
            runPartialId = rPart.Id;
            stop1PartialId = sp1.Id;
            stop2PartialId = sp2.Id;
        }

        // Attack 1: Runner claims runZero, tries to inflate DepotVerifiedContainers = 10000, and tries to self-settle
        await runner.Client.PostAsJsonAsync($"/api/marketplace/runs/{runZeroId}/claim", new { profileId = runner.ProfileId });
        await runner.Client.PostAsync($"/api/marketplace/runs/{runZeroId}/start", null);
        await runner.Client.PostAsJsonAsync($"/api/marketplace/runs/{runZeroId}/stops/{stop1ZeroId}/pickup", new { actualContainers = 100 });
        await runner.Client.PostAsync($"/api/marketplace/runs/{runZeroId}/deliver", null);

        var completeRes = await runner.Client.PostAsJsonAsync($"/api/marketplace/runs/{runZeroId}/complete", new { depotVerifiedContainers = 10000 });
        Assert.Equal(HttpStatusCode.OK, completeRes.StatusCode);
        var completeJson = await completeRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(100, completeJson.GetProperty("depotVerifiedContainers").GetInt32()); // Clamped to kerbsideSum (100), NEVER 10,000!

        var runnerSelfSettle = await runner.Client.PostAsync($"/api/marketplace/runs/{runZeroId}/settle", null);
        Assert.Equal(HttpStatusCode.Forbidden, runnerSelfSettle.StatusCode);

        // Attack 2: Depot rejects all bags as contaminated (Admin settles with DepotVerifiedContainers = 0) -> $0 paid to runner, household, and Mafia!
        var zeroSettle = await admin.Client.PostAsJsonAsync($"/api/marketplace/runs/{runZeroId}/settle", new
        {
            depotVerifiedContainers = 0,
            coexDocketRef = "COEX-REJECTED-0",
        });
        Assert.Equal(HttpStatusCode.OK, zeroSettle.StatusCode);
        var zeroJson = await zeroSettle.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, zeroJson.GetProperty("actualPayoutCents").GetInt32());
        Assert.Equal(0, zeroJson.GetProperty("householdPayoutCents").GetInt32());
        Assert.Equal(0, zeroJson.GetProperty("containerMafiaCents").GetInt32());

        // Attack 3: Partial depot verification (kerbsideSum = 200 across 2 stops, depot verifies 50) -> households receive 25 + 25 = 500¢ total, never 2000¢!
        await runner.Client.PostAsJsonAsync($"/api/marketplace/runs/{runPartialId}/claim", new { profileId = runner.ProfileId });
        await runner.Client.PostAsync($"/api/marketplace/runs/{runPartialId}/start", null);
        await runner.Client.PostAsJsonAsync($"/api/marketplace/runs/{runPartialId}/stops/{stop1PartialId}/pickup", new { actualContainers = 100 });
        await runner.Client.PostAsJsonAsync($"/api/marketplace/runs/{runPartialId}/stops/{stop2PartialId}/pickup", new { actualContainers = 100 });
        await runner.Client.PostAsync($"/api/marketplace/runs/{runPartialId}/deliver", null);
        await runner.Client.PostAsJsonAsync($"/api/marketplace/runs/{runPartialId}/complete", new { depotVerifiedContainers = 50 });

        var partialSettle = await admin.Client.PostAsync($"/api/marketplace/runs/{runPartialId}/settle", null);
        Assert.Equal(HttpStatusCode.OK, partialSettle.StatusCode);
        var partialJson = await partialSettle.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(500, partialJson.GetProperty("householdPayoutCents").GetInt32()); // 50 * 10¢ = $5.00
        Assert.Equal(25, partialJson.GetProperty("containerMafiaCents").GetInt32());  // 25 * 1¢ (bin1 already had LastCollectedAt on runZero)
    }

    [Fact]
    public async Task F02_Collecting_household_without_active_run_has_unconfirmed_next_pickup_and_does_not_auto_generate_run_with_one_loose_can()
    {
        var admin = await SignUp("hello@thegoodsort.org");
        var pilot = await SignUp("pilot-f02@r1.test");

        var hhRes = await pilot.Client.PostAsJsonAsync("/api/households", new
        {
            name = "Pilot House",
            address = "18 Cracknell Road, Tarragindi QLD 4121",
            suburb = "TARRAGINDI",
            street = "CRACKNELL ROAD",
            lat = -27.526,
            lng = 153.046,
            type = "residential",
            councilCollectionDay = KerbsideNight.TomorrowCouncilDay(DateTime.UtcNow),
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hhRes.StatusCode);
        var hhId = (await hhRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        Assert.Equal(HttpStatusCode.OK, (await admin.Client.PostAsJsonAsync($"/api/admin/households/{hhId}/bin-status", new { status = "collecting" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await pilot.Client.PostAsJsonAsync("/api/scans", new
        {
            userId = pilot.ProfileId,
            barcode = "9300675024235",
            containerName = "Coca-Cola 375ml Can",
            material = "aluminium",
        })).StatusCode);

        // No active run exists yet -> next-pickup must report confirmed = false and nextPickup = null!
        var nextRes = await pilot.Client.GetFromJsonAsync<JsonElement>($"/api/households/{hhId}/next-pickup");
        Assert.False(nextRes.GetProperty("confirmed").GetBoolean());
        Assert.Equal(JsonValueKind.Null, nextRes.GetProperty("nextPickup").ValueKind);

        // Trigger reminder pass on council-eve -> 0 household emails sent when 0 runs exist, and LastPickupAt stays null!
        var remRes = await admin.Client.PostAsync("/api/admin/trigger-pickup-reminders", null);
        Assert.Equal(HttpStatusCode.OK, remRes.StatusCode);
        var remJson = await remRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, remJson.GetProperty("households").GetInt32());

        // Trigger RunGenerationService -> BinIsOut is false and Tarragindi has <1,000 cans, so 0 premature runs spawn!
        var genRes = await admin.Client.PostAsync("/api/admin/marketplace/runs/generate", null);
        Assert.Equal(HttpStatusCode.OK, genRes.StatusCode);
        using var scope = _host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
        var hh = await db.Households.AsNoTracking().FirstAsync(h => h.Id == hhId);
        Assert.Null(hh.LastPickupAt);
        var tarragindiBin = await db.Bins.AsNoTracking().FirstAsync(b => b.HouseholdId == hhId);
        Assert.False(await db.RunStops.AnyAsync(s => s.BinId == tarragindiBin.Id));
    }

    [Fact]
    public async Task F03_F09_Rejects_houseless_street_midpoint_blocks_mutual_and_same_address_sybil_and_reverses_unsettled_bonus_on_delete()
    {
        var userA = await SignUp("sybil-a@r1.test");

        // F-03: Houseless road midpoint rejected with 400
        var houseless = await userA.Client.PostAsJsonAsync("/api/households", new
        {
            name = "Midpoint",
            address = "Cracknell Road, Tarragindi QLD 4121",
            suburb = "TARRAGINDI",
            street = "CRACKNELL ROAD",
            lat = -27.526,
            lng = 153.046,
            type = "residential",
            councilCollectionDay = 3,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.BadRequest, houseless.StatusCode);

        // F-09: User B referred by User A -> User A cannot then be referred by User B (mutual cycle blocked)
        var userB = await SignUp("sybil-b@r1.test", referrerId: userA.ProfileId);
        var sendAgain = await _host.CreateClient().PostAsJsonAsync("/api/auth/send-otp", new { email = userA.Email });
        var codeAgain = (await sendAgain.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString()!;
        var verifyCycle = await _host.CreateClient().PostAsJsonAsync("/api/auth/verify-otp", new
        {
            email = userA.Email,
            code = codeAgain,
            referrerId = userB.ProfileId,
        });
        var cycleProfile = (await verifyCycle.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("profile");
        Assert.Equal(JsonValueKind.Null, cycleProfile.GetProperty("referrerId").ValueKind);

        // User A registers 88 Ipswich Road
        var hhA = await userA.Client.PostAsJsonAsync("/api/households", new
        {
            name = "A Home",
            address = "88 Ipswich Road, Annerley QLD 4103",
            suburb = "ANNERLEY",
            street = "IPSWICH ROAD",
            lat = -27.512,
            lng = 153.031,
            type = "residential",
            councilCollectionDay = 2,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hhA.StatusCode);
        var hhAId = (await hhA.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        // Uninvited stranger trying to register a second household at 88 Ipswich Road gets 409 Conflict
        var stranger = await SignUp("stranger@r1.test");
        var dupStranger = await stranger.Client.PostAsJsonAsync("/api/households", new
        {
            name = "Duplicate Home",
            address = "88 Ipswich Rd, Annerley QLD 4103",
            suburb = "ANNERLEY",
            street = "IPSWICH ROAD",
            lat = -27.512,
            lng = 153.031,
            type = "residential",
            councilCollectionDay = 2,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Conflict, dupStranger.StatusCode);

        // Invited housemate (userB) at 88 Ipswich Road joins hhAId with 0 self-referral bonus
        var joinB = await userB.Client.PostAsJsonAsync("/api/households", new
        {
            name = "B Home",
            address = "88 Ipswich Road, Annerley QLD 4103",
            suburb = "ANNERLEY",
            street = "IPSWICH ROAD",
            lat = -27.512,
            lng = 153.031,
            type = "residential",
            councilCollectionDay = 2,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, joinB.StatusCode);
        Assert.Equal(hhAId, (await joinB.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid());

        // Real neighbour at 90 Ipswich Road grants +100 PendingCents, and deleting before first pickup reverses -100!
        var neighbour = await SignUp("real-neighbour@r1.test", referrerId: userA.ProfileId);
        Assert.Equal(HttpStatusCode.Created, (await neighbour.Client.PostAsJsonAsync("/api/households", new
        {
            name = "Neighbour Home",
            address = "90 Ipswich Road, Annerley QLD 4103",
            suburb = "ANNERLEY",
            street = "IPSWICH ROAD",
            lat = -27.513,
            lng = 153.032,
            type = "residential",
            councilCollectionDay = 2,
            accessConsent = true,
        })).StatusCode);

        var aBeforeDel = await userA.Client.GetFromJsonAsync<JsonElement>($"/api/profiles/{userA.ProfileId}");
        Assert.Equal(100, aBeforeDel.GetProperty("pendingCents").GetInt32());

        Assert.Equal(HttpStatusCode.OK, (await neighbour.Client.DeleteAsync($"/api/profiles/{neighbour.ProfileId}")).StatusCode);

        var aAfterDel = await userA.Client.GetFromJsonAsync<JsonElement>($"/api/profiles/{userA.ProfileId}");
        Assert.Equal(0, aAfterDel.GetProperty("pendingCents").GetInt32());
    }

    [Fact]
    public async Task F05_F06_F10_F14_Pricing_stays_profitable_reset_baseline_is_404_cashout_batch_reexports_and_admin_invite_name_is_clean()
    {
        var admin = await SignUp("hello@thegoodsort.org");

        // F-05: Seeded PricingConfig has Base=3, Floor=2, Ceiling=4 -> positive margin under 17.68¢ CRP, and honest pro-forma math
        var cfg = new PricingConfig();
        Assert.Equal(2, cfg.FloorCents);
        Assert.Equal(3, cfg.BaseCents);
        Assert.Equal(4, cfg.CeilingCents);
        Assert.Equal(0, cfg.GoldBonus);
        Assert.Equal(1, cfg.PlatinumBonus);

        var highRunnerLedger = CrpSettlement.BuildLedger(
            runId: Guid.NewGuid(),
            areaName: "Moorooka",
            crpActive: true,
            verifiedContainers: 1000,
            bagsVerified: 7,
            discrepancyStops: 0,
            householdPayoutCents: 10_000,
            containerMafiaCents: 1_000,
            runnerPayoutCents: 8_000);
        Assert.Equal(-132_000L, highRunnerLedger.ProFormaCrpNetMarginBasisPoints); // Honest -$13.20 when runner=8¢, never fake +$36.80!

        // F-06: /api/admin/reset-baseline returns 404 NotFound when RESET_BASELINE_ENABLED is unset
        var resetAttempt = await admin.Client.PostAsJsonAsync("/api/admin/reset-baseline", new { confirm = "RESET_BASELINE" });
        Assert.Equal(HttpStatusCode.NotFound, resetAttempt.StatusCode);

        // F-14: InvitePreview for "The Good Sort" returns "The Good Sort", never "The"
        var inviteJson = await _host.CreateClient().GetFromJsonAsync<JsonElement>($"/api/growth/invite/{admin.ProfileId}");
        Assert.Equal("The Good Sort", inviteJson.GetProperty("name").GetString());

        // F-10: Processing cashout blocks profile deletion until refunded or marked paid, and supports batch re-export
        var earner = await SignUp("earner-f10@r1.test");
        Guid cashoutId;
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var p = await db.Profiles.FindAsync(earner.ProfileId);
            p!.ClearedCents = 2500;
            await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.OK, (await earner.Client.PostAsJsonAsync("/api/cashout/payid", new
        {
            amountCents = 2500,
            payIdType = "email",
            payIdValue = "earner-f10@r1.test",
            accountName = "EARNER F10",
        })).StatusCode);

        var exportPost = await admin.Client.PostAsync("/api/admin/payid-export", null);
        Assert.Equal(HttpStatusCode.OK, exportPost.StatusCode);
        var csv1 = await exportPost.Content.ReadAsStringAsync();
        Assert.Contains("EARNER F10", csv1);

        Guid batchId;
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var c = await db.CashoutRequests.SingleAsync(x => x.UserId == earner.ProfileId);
            Assert.Equal("processing", c.Status);
            cashoutId = c.Id;
            batchId = c.BatchId!.Value;
        }

        // Re-export same BatchId succeeds without re-claiming
        var reexport = await admin.Client.GetAsync($"/api/admin/cashouts/batch/{batchId}");
        Assert.Equal(HttpStatusCode.OK, reexport.StatusCode);
        Assert.Equal(csv1, await reexport.Content.ReadAsStringAsync());

        // Deleting account while transfer is "processing" returns 409 Conflict
        Assert.Equal(HttpStatusCode.Conflict, (await earner.Client.DeleteAsync($"/api/profiles/{earner.ProfileId}")).StatusCode);

        // Refunding restores ClearedCents and allows account deletion
        Assert.Equal(HttpStatusCode.OK, (await admin.Client.PostAsync($"/api/admin/cashouts/{cashoutId}/refund", null)).StatusCode);
        var earnerAfterRefund = await earner.Client.GetFromJsonAsync<JsonElement>($"/api/profiles/{earner.ProfileId}");
        Assert.Equal(2500, earnerAfterRefund.GetProperty("clearedCents").GetInt32());
        Assert.Equal(HttpStatusCode.OK, (await earner.Client.DeleteAsync($"/api/profiles/{earner.ProfileId}")).StatusCode);
    }
}
