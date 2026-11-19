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

public class Tg685CollectorOpsAndCleanupTests : IClassFixture<Tg685CollectorOpsAndCleanupTests.Tg685Host>
{
    private readonly Tg685Host _host;
    public Tg685CollectorOpsAndCleanupTests(Tg685Host host) => _host = host;

    public class Tg685Host : WebApplicationFactory<Program>
    {
        public readonly string DbName = $"tg685-{Guid.NewGuid():N}";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
            builder.UseSetting("COEX_CRP_ACTIVE", "true");
            builder.UseSetting("PAYID_PAYOUTS_ENABLED", "true");
            builder.UseSetting("ADMIN_SEED_EMAIL", "admin@tg685.test");

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

    private async Task<AuthMember> SignUp(string email)
    {
        var client = _host.CreateClient();
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            await db.Database.EnsureCreatedAsync();
        }

        var send = await client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        Assert.Equal(HttpStatusCode.OK, send.StatusCode);
        var sendJson = await send.Content.ReadFromJsonAsync<JsonElement>();
        var code = sendJson.GetProperty("devCode").GetString()!;

        var verify = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        var verifyJson = await verify.Content.ReadFromJsonAsync<JsonElement>();
        var token = verifyJson.GetProperty("token").GetString()!;
        var profileId = verifyJson.GetProperty("profile").GetProperty("id").GetGuid();

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return new AuthMember(client, profileId, email);
    }

    [Fact]
    public void PickupInstruction_IncludesStreetAddressWhenProvided_AndFallsBackCleanly()
    {
        var withAddr = HouseholdCredit.PickupInstruction(
            "Alex Taylor's Place",
            "67 Northview Outlook, Moorooka QLD 4105");
        Assert.Contains("Alex Taylor's Place", withAddr);
        Assert.Contains("67 Northview Outlook, Moorooka QLD 4105", withAddr);
        Assert.DoesNotContain("yellow", withAddr, StringComparison.OrdinalIgnoreCase);

        var withoutAddr = HouseholdCredit.PickupInstruction("Alex Taylor's Place", "   ");
        Assert.Equal("Collect Alex Taylor's Place on the kerb. Take eligible containers to a refund point.", withoutAddr);
    }

    [Fact]
    public async Task Pilot_run_surfaces_on_admin_pickups_gives_runner_street_address_and_cleans_up_orphaned_household_on_delete()
    {
        var admin = await SignUp("admin@tg685.test");
        var sorter = await SignUp("pilot-sorter@tg685.test");
        var runner = await SignUp("pilot-runner@tg685.test");

        // 1. Sorter sets up household at 67 Northview Outlook, Moorooka QLD 4105
        var createHh = await sorter.Client.PostAsJsonAsync("/api/households", new
        {
            name = "Northview Pilot House",
            address = "67 Northview Outlook, Moorooka QLD 4105",
            suburb = "Moorooka",
            street = "Northview Outlook",
            type = "residential",
            lat = -27.5295,
            lng = 153.0315,
            councilCollectionDay = 4,
            councilArea = "Brisbane City Council",
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, createHh.StatusCode);
        var hhJson = await createHh.Content.ReadFromJsonAsync<JsonElement>();
        var hhId = hhJson.GetProperty("id").GetGuid();

        // Sorter scans 1 container and puts a bag on the kerb
        var scanRes = await sorter.Client.PostAsJsonAsync("/api/scans", new
        {
            userId = sorter.ProfileId,
            barcode = "9300675024846",
            containerName = "Suntory Boss Coffee 237mL",
            material = "aluminium",
        });
        Assert.Equal(HttpStatusCode.OK, scanRes.StatusCode);

        var bagRes = await sorter.Client.PostAsJsonAsync("/api/bags", new
        {
            stream = "aluminium",
            declaredContainers = 1,
            putOnKerb = true,
        });
        Assert.Equal(HttpStatusCode.Created, bagRes.StatusCode);

        // 2. Admin enables pilot collection and generates runs
        var promote = await admin.Client.PostAsJsonAsync($"/api/admin/households/{hhId}/bin-status", new
        {
            status = "collecting",
        });
        Assert.Equal(HttpStatusCode.OK, promote.StatusCode);

        var gen = await admin.Client.PostAsync("/api/admin/marketplace/runs/generate", null);
        Assert.Equal(HttpStatusCode.OK, gen.StatusCode);

        // 3. Admin /pickups/tomorrow surfaces the below_threshold pilot run & uncovered household regardless of day of week
        var pickupsBefore = await admin.Client.GetFromJsonAsync<JsonElement>("/api/admin/pickups/tomorrow");
        var runsBefore = pickupsBefore.GetProperty("runs").EnumerateArray().ToList();
        var pilotRun = Assert.Single(runsBefore, r => r.GetProperty("areaName").GetString()!.Contains("Moorooka", StringComparison.OrdinalIgnoreCase));
        var runId = pilotRun.GetProperty("id").GetGuid();
        Assert.Equal("below_threshold", pilotRun.GetProperty("status").GetString());
        Assert.True(pickupsBefore.GetProperty("householdsUncovered").GetInt32() >= 1);

        // Anonymous public browse never leaks below_threshold runs or street addresses
        using var anonClient = _host.CreateClient();
        var publicRuns = await anonClient.GetStringAsync("/api/marketplace/runs?lat=-27.5295&lng=153.0315&radiusKm=15");
        Assert.DoesNotContain("Northview Outlook", publicRuns, StringComparison.OrdinalIgnoreCase);

        // 4. Runner registers and claims the pilot run -> receives full street address in PickupInstruction
        var regRunner = await runner.Client.PostAsJsonAsync("/api/runner/register", new
        {
            profileId = runner.ProfileId,
            vehicleType = "ute",
            capacityBags = 12,
            serviceRadiusKm = 15.0,
            coexSchemeId = "C109876543",
        });
        Assert.Equal(HttpStatusCode.Created, regRunner.StatusCode);

        var claim = await runner.Client.PostAsJsonAsync($"/api/marketplace/runs/{runId}/claim", new
        {
            profileId = runner.ProfileId,
        });
        Assert.Equal(HttpStatusCode.OK, claim.StatusCode);
        var claimJson = await claim.Content.ReadFromJsonAsync<JsonElement>();
        var stopInstruction = claimJson.GetProperty("stops")[0].GetProperty("pickupInstruction").GetString()!;
        Assert.Contains("67 Northview Outlook, Moorooka QLD 4105", stopInstruction);

        // Admin /pickups/tomorrow now shows the run as claimed
        var pickupsAfter = await admin.Client.GetFromJsonAsync<JsonElement>("/api/admin/pickups/tomorrow");
        var claimedRun = Assert.Single(
            pickupsAfter.GetProperty("runs").EnumerateArray(),
            r => r.GetProperty("id").GetGuid() == runId);
        Assert.Equal("claimed", claimedRun.GetProperty("status").GetString());

        // 5. Release the run -> a 1-house pilot run must return to below_threshold (NEVER public "available")
        var release = await runner.Client.PostAsync($"/api/marketplace/runs/{runId}/release", null);
        Assert.Equal(HttpStatusCode.OK, release.StatusCode);
        var releaseJson = await release.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("below_threshold", releaseJson.GetProperty("status").GetString());

        var publicRunsAfterRelease = await anonClient.GetStringAsync("/api/marketplace/runs?lat=-27.5295&lng=153.0315&radiusKm=15");
        Assert.Equal("[]", publicRunsAfterRelease.Trim());
        Assert.DoesNotContain("Northview Outlook", publicRunsAfterRelease, StringComparison.OrdinalIgnoreCase);

        var deleteRes = await sorter.Client.DeleteAsync($"/api/profiles/{sorter.ProfileId}");
        Assert.Equal(HttpStatusCode.OK, deleteRes.StatusCode);

        // Verify orphaned Household, Bin, SortedBag, and empty unclaimed Run were wiped cleanly
        using var scope = _host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
        Assert.Null(await db.Households.FindAsync(hhId));
        Assert.Empty(await db.Bins.Where(b => b.HouseholdId == hhId).ToListAsync());
        Assert.Empty(await db.SortedBags.Where(b => b.HouseholdId == hhId).ToListAsync());
        Assert.Null(await db.Runs.FindAsync(runId));
    }

    [Fact]
    public async Task Deleting_sole_member_after_settled_run_wipes_household_and_scrubs_bin_without_breaking_settlement_ledger()
    {
        var admin = await SignUp("admin@tg685.test");
        var sorter = await SignUp("settled-sorter@tg685.test");
        var runner = await SignUp("settled-runner@tg685.test");

        var createHh = await sorter.Client.PostAsJsonAsync("/api/households", new
        {
            name = "Tarragindi Test House",
            address = "14 Windmill Street, Tarragindi QLD 4121",
            suburb = "Tarragindi",
            street = "Windmill Street",
            type = "residential",
            lat = -27.5260,
            lng = 153.0460,
            councilCollectionDay = 2,
            councilArea = "Brisbane City Council",
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, createHh.StatusCode);
        var hhId = (await createHh.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var scan = await sorter.Client.PostAsJsonAsync("/api/scans", new
        {
            userId = sorter.ProfileId,
            barcode = "9300675024846",
            containerName = "Test Can",
            material = "aluminium",
        });
        Assert.Equal(HttpStatusCode.OK, scan.StatusCode);

        var bag = await sorter.Client.PostAsJsonAsync("/api/bags", new
        {
            stream = "aluminium",
            declaredContainers = 1,
            putOnKerb = true,
        });
        Assert.Equal(HttpStatusCode.Created, bag.StatusCode);
        var bagCode = (await bag.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString()!;

        string originalBinCode;
        Guid originalBinId;
        using (var preScope = _host.Services.CreateScope())
        {
            var preDb = preScope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var hhBin = await preDb.Bins.SingleAsync(b => b.HouseholdId == hhId);
            originalBinId = hhBin.Id;
            originalBinCode = hhBin.Code;
        }

        await admin.Client.PostAsJsonAsync($"/api/admin/households/{hhId}/bin-status", new { status = "collecting" });
        await admin.Client.PostAsync("/api/admin/marketplace/runs/generate", null);

        var pickups = await admin.Client.GetFromJsonAsync<JsonElement>("/api/admin/pickups/tomorrow");
        var runRow = Assert.Single(
            pickups.GetProperty("runs").EnumerateArray(),
            r => r.GetProperty("areaName").GetString()!.Contains("Tarragindi", StringComparison.OrdinalIgnoreCase));
        var runId = runRow.GetProperty("id").GetGuid();

        var reg = await runner.Client.PostAsJsonAsync("/api/runner/register", new
        {
            profileId = runner.ProfileId,
            vehicleType = "car",
            capacityBags = 10,
            serviceRadiusKm = 15.0,
            coexSchemeId = "C109876544",
        });
        Assert.Equal(HttpStatusCode.Created, reg.StatusCode);

        var claim = await runner.Client.PostAsJsonAsync($"/api/marketplace/runs/{runId}/claim", new { profileId = runner.ProfileId });
        Assert.Equal(HttpStatusCode.OK, claim.StatusCode);
        var stopId = (await claim.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("stops")[0].GetProperty("id").GetGuid();

        await runner.Client.PostAsync($"/api/marketplace/runs/{runId}/start", null);

        // Scan bag BEFORE calling /arrive -> /arrive must still succeed idempotently (200 OK, never 400 deadlock)
        var scanBag = await runner.Client.PostAsJsonAsync($"/api/marketplace/runs/{runId}/stops/{stopId}/scan-bag", new
        {
            bagCode,
            verifiedContainers = 1,
        });
        Assert.Equal(HttpStatusCode.OK, scanBag.StatusCode);

        var arriveAfterScan = await runner.Client.PostAsync($"/api/marketplace/runs/{runId}/stops/{stopId}/arrive", null);
        Assert.Equal(HttpStatusCode.OK, arriveAfterScan.StatusCode);

        await runner.Client.PostAsJsonAsync($"/api/marketplace/runs/{runId}/stops/{stopId}/pickup", new { actualContainers = 1 });
        await runner.Client.PostAsync($"/api/marketplace/runs/{runId}/deliver", null);
        await runner.Client.PostAsJsonAsync($"/api/marketplace/runs/{runId}/complete", new { depotVerifiedContainers = 1, coexDocketRef = "DOC-TG685" });
        var settle = await runner.Client.PostAsync($"/api/marketplace/runs/{runId}/settle", null);
        Assert.Equal(HttpStatusCode.OK, settle.StatusCode);

        // Now delete the sole-member sorter profile
        var del = await sorter.Client.DeleteAsync($"/api/profiles/{sorter.ProfileId}");
        Assert.Equal(HttpStatusCode.OK, del.StatusCode);

        // Deleted household bin must NOT appear on /api/bins, /api/bins/{id}, /api/bins/code/{code}, or /api/bins/{id}/qr,
        // and runner's historical run history must NOT retain street address or coordinates!
        var bystander = await SignUp("bystander@tg685.test");
        var visibleBins = await bystander.Client.GetFromJsonAsync<JsonElement>("/api/bins");
        Assert.DoesNotContain(visibleBins.EnumerateArray(), b => b.GetProperty("id").GetGuid() == originalBinId);
        Assert.Equal(HttpStatusCode.NotFound, (await bystander.Client.GetAsync($"/api/bins/{originalBinId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bystander.Client.GetAsync($"/api/bins/code/{originalBinCode}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bystander.Client.GetAsync($"/api/bins/{originalBinId}/qr")).StatusCode);

        var runnerHistoryRaw = await runner.Client.GetStringAsync($"/api/runner/runs/{runner.ProfileId}");
        Assert.DoesNotContain("Windmill Street", runnerHistoryRaw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Tarragindi Test House", runnerHistoryRaw, StringComparison.OrdinalIgnoreCase);

        using var scope = _host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
        Assert.Null(await db.Households.FindAsync(hhId));
        Assert.True(await db.RunSettlementLedgers.AnyAsync(l => l.RunId == runId));
        var stop = await db.RunStops.SingleAsync(s => s.Id == stopId);
        Assert.Equal("Deleted household", stop.PickupInstruction);
        Assert.Equal(0, stop.Lat);
        Assert.Equal(0, stop.Lng);
        var scrubbedBin = await db.Bins.SingleAsync(b => b.Id == stop.BinId);
        Assert.Null(scrubbedBin.HouseholdId);
        Assert.Equal("deleted", scrubbedBin.Status);
        Assert.Equal("", scrubbedBin.Address);
        Assert.Equal(0, scrubbedBin.Lat);
        Assert.Equal(0, scrubbedBin.Lng);
    }
}
