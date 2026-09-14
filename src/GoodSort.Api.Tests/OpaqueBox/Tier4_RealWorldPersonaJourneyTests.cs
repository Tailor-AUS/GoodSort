using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;

namespace GoodSort.Api.Tests.OpaqueBox;

/// <summary>
/// Tier 4: Real-World Workloads & End-to-End Persona Journeys.
/// Audits realistic multi-step user journeys across browser, API, state transitions,
/// and database atomicity constraints.
/// </summary>
public class Tier4_RealWorldPersonaJourneyTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;
    public Tier4_RealWorldPersonaJourneyTests(OpaqueBoxHost host) => _host = host;

    private const double MoorookaLat = -27.5333;
    private const double MoorookaLng = 153.0167;

    [Fact]
    public async Task Journey_01_Maya_FirstTime_PLG_Scan_To_Waitlist_Onboarding()
    {
        // ── Step 1: Anonymous visitor lands on /scan ──
        var anonClient = _host.CreateAnonymousClient();
        var healthCheck = await anonClient.GetAsync("/api/health");
        Assert.Equal(HttpStatusCode.OK, healthCheck.StatusCode);

        // ── Step 2: Starts scan, prompted for authentication ──
        const string mayaEmail = "maya.plg@example.test";
        var sendRes = await anonClient.PostAsJsonAsync("/api/auth/send-otp", new { email = mayaEmail });
        Assert.Equal(HttpStatusCode.OK, sendRes.StatusCode);
        var devCode = (await sendRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString()!;

        // ── Step 3: Verifies OTP, receives 30-day JWT & profile ──
        var verifyRes = await anonClient.PostAsJsonAsync("/api/auth/verify-otp", new { email = mayaEmail, code = devCode });
        Assert.Equal(HttpStatusCode.OK, verifyRes.StatusCode);
        var verifyJson = await verifyRes.Content.ReadFromJsonAsync<JsonElement>();
        var mayaToken = verifyJson.GetProperty("token").GetString()!;
        var mayaProfileId = verifyJson.GetProperty("profile").GetProperty("id").GetGuid();

        var authClient = _host.CreateAnonymousClient();
        authClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", mayaToken);

        // ── Step 4: Confirms initial scan container with Launch Bonus preview ──
        var scanToken = _host.MintScanToken(mayaProfileId, items:
        [
            new ScanTokenItem { Name = "First Can", Material = "aluminium", Count = 1, Eligible = true }
        ]);
        var confirmRes = await authClient.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken });
        Assert.Equal(HttpStatusCode.OK, confirmRes.StatusCode);
        var confirmJson = await confirmRes.Content.ReadFromJsonAsync<JsonElement>();

        // 10c launch bonus earned
        Assert.Equal(10, confirmJson.GetProperty("totalCents").GetInt32());
        Assert.True(confirmJson.GetProperty("bonusApplied").GetBoolean());

        // Initial scan is an orphan (HouseholdId is null)
        var profileBeforeHh = await _host.GetProfileAsync(authClient, mayaProfileId);
        Assert.False(profileBeforeHh.TryGetProperty("householdId", out var hhProp) && hhProp.ValueKind != JsonValueKind.Null);

        // ── Step 5: Looks up council bin collection day for her street ──
        var binDayRes = await authClient.PostAsJsonAsync("/api/households/lookup-bin-day", new
        {
            lat = MoorookaLat,
            lng = MoorookaLng,
            address = "18 Beaudesert Rd, Moorooka QLD 4105"
        });
        Assert.Equal(HttpStatusCode.OK, binDayRes.StatusCode);

        // ── Step 6: Completes household onboarding ──
        var hhCreateRes = await authClient.PostAsJsonAsync("/api/households", new
        {
            name = "Maya's Place",
            address = "18 Beaudesert Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            street = "Beaudesert Rd",
            lat = MoorookaLat,
            lng = MoorookaLng,
            type = "residential",
            councilCollectionDay = 1,
            councilArea = "Brisbane City Council",
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hhCreateRes.StatusCode);
        var hhJson = await hhCreateRes.Content.ReadFromJsonAsync<JsonElement>();
        var householdId = hhJson.GetProperty("id").GetGuid();

        // ── Step 7: Verifies orphan scan backfilled and counters updated ──
        Assert.Equal(1, hhJson.GetProperty("pendingContainers").GetInt32());
        Assert.Equal(10, hhJson.GetProperty("pendingValueCents").GetInt32());

        // Profile is now attached to the household
        var profileAfterHh = await _host.GetProfileAsync(authClient, mayaProfileId);
        Assert.Equal(householdId, profileAfterHh.GetProperty("householdId").GetGuid());
    }

    [Fact]
    public async Task Journey_02_Liam_Returning_Power_Sorter_Batch_Scanning()
    {
        // ── Step 1: Existing member with established household signs in ──
        const string liamEmail = "liam.power@example.test";
        var (client, _, profileId) = await _host.SignInMemberAsync(liamEmail);

        var hhRes = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Liam's Residence",
            address = "25 Hamilton Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = MoorookaLat,
            lng = MoorookaLng,
            councilCollectionDay = 2,
            accessConsent = true,
        });
        var hhId = (await hhRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        // ── Step 2: Re-entry to scanner skips auth and submits 3 batch scans ──
        var batches = new[]
        {
            new ScanTokenItem { Name = "Coke Can", Material = "aluminium", Count = 5, Eligible = true },
            new ScanTokenItem { Name = "Mount Franklin Bottle", Material = "pet", Count = 4, Eligible = true },
            new ScanTokenItem { Name = "VB Stubby", Material = "glass", Count = 3, Eligible = true },
        };

        foreach (var item in batches)
        {
            var tok = _host.MintScanToken(profileId, items: [item]);
            var res = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tok });
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        }

        // ── Step 3: Verify all 12 containers directly attributed to household ──
        var hh = await _host.GetHouseholdAsync(client, hhId);
        Assert.Equal(12, hh.GetProperty("pendingContainers").GetInt32());

        // Verify material streams tracked accurately
        var mat = hh.GetProperty("materials");
        Assert.Equal(5, mat.GetProperty("aluminium").GetInt32());
        Assert.Equal(4, mat.GetProperty("pet").GetInt32());
        Assert.Equal(3, mat.GetProperty("glass").GetInt32());

        // ── Step 4: Refresh profile balance on dashboard ──
        var prof = await _host.GetProfileAsync(client, profileId);
        Assert.Equal(12, prof.GetProperty("totalContainers").GetInt32());
    }

    [Fact]
    public async Task Journey_03_Chloe_Account_Collision_CrossDevice_Resolution()
    {
        const string chloeEmail = "chloe.collision@example.test";

        // ── Device 1: Chloe sets up account and household ──
        var (client1, _, origProfileId) = await _host.SignInMemberAsync(chloeEmail);
        var hhRes = await client1.PostAsJsonAsync("/api/households", new
        {
            name = "Chloe's Home",
            address = "30 Vendale Ave, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = MoorookaLat,
            lng = MoorookaLng,
            councilCollectionDay = 3,
            accessConsent = true,
        });
        var hhId = (await hhRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        // ── Device 2: Chloe opens /scan on a friend's phone anonymously ──
        var anonClient = _host.CreateAnonymousClient();

        // She enters her email at auth screen
        var sendRes = await anonClient.PostAsJsonAsync("/api/auth/send-otp", new { email = chloeEmail });
        var devCode = (await sendRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString()!;

        // Verifies code -> resolves to original profile
        var verifyRes = await anonClient.PostAsJsonAsync("/api/auth/verify-otp", new { email = chloeEmail, code = devCode });
        var verifyJson = await verifyRes.Content.ReadFromJsonAsync<JsonElement>();
        var device2ProfileId = verifyJson.GetProperty("profile").GetProperty("id").GetGuid();
        var device2Token = verifyJson.GetProperty("token").GetString()!;

        Assert.Equal(origProfileId, device2ProfileId); // Zero duplication

        // ── Confirms scan on Device 2 ──
        var client2 = _host.CreateAnonymousClient();
        client2.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", device2Token);

        var tok = _host.MintScanToken(device2ProfileId, items: [new ScanTokenItem { Name = "Can", Material = "aluminium", Count = 2, Eligible = true }]);
        var confirmRes = await client2.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tok });
        Assert.Equal(HttpStatusCode.OK, confirmRes.StatusCode);

        // Attributed directly to her original household
        var hh = await _host.GetHouseholdAsync(client2, hhId);
        Assert.Equal(2, hh.GetProperty("pendingContainers").GetInt32());
    }

    [Fact]
    public async Task Journey_04_Noah_Public_Bin_Commuter_Geofence_Validation()
    {
        const string noahEmail = "noah.commuter@example.test";
        var (client, _, profileId) = await _host.SignInMemberAsync(noahEmail);

        const string binCode = "GS-STATION-1";
        var token = _host.MintScanToken(profileId, binCode: binCode, binLat: MoorookaLat, binLng: MoorookaLng);

        // ── Phase 1: Commuter on train 3 km away tries to confirm deposit ──
        var remoteLat = MoorookaLat + 0.03;
        var remoteLng = MoorookaLng + 0.03;
        var remoteRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = token,
            lat = remoteLat,
            lng = remoteLng
        });
        Assert.Equal(HttpStatusCode.BadRequest, remoteRes.StatusCode);
        var remoteJson = await remoteRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("Move closer", remoteJson.GetProperty("error").GetString());

        // Token remained unspent
        var profBefore = await _host.GetProfileAsync(client, profileId);
        Assert.Equal(0, profBefore.GetProperty("totalContainers").GetInt32());

        // ── Phase 2: Commuter walks up to bin (within 30m) and confirms ──
        var atBinLat = MoorookaLat + 0.0002;
        var atBinLng = MoorookaLng;
        var atBinRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = token,
            lat = atBinLat,
            lng = atBinLng
        });
        Assert.Equal(HttpStatusCode.OK, atBinRes.StatusCode);

        var profAfter = await _host.GetProfileAsync(client, profileId);
        Assert.Equal(1, profAfter.GetProperty("totalContainers").GetInt32());
    }

    [Fact]
    public async Task Journey_05_Mal_Adversarial_Threat_And_Replay_Defense()
    {
        const string malEmail = "mal.attacker@example.test";
        var (client, _, profileId) = await _host.SignInMemberAsync(malEmail);

        const string photoHash = "deadbeefcafe0011";
        var token = _host.MintScanToken(profileId, photoHash: photoHash);

        // ── Vector 1: First confirm succeeds legitimately ──
        var res1 = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
        Assert.Equal(HttpStatusCode.OK, res1.StatusCode);

        // ── Vector 2: Replay same token 4 times ──
        for (var i = 0; i < 4; i++)
        {
            var replayRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
            Assert.Equal(HttpStatusCode.BadRequest, replayRes.StatusCode);
        }

        // ── Vector 3: Issue new token but re-submit identical photo hash ──
        var replayedHashToken = _host.MintScanToken(profileId, photoHash: photoHash);
        var hashReplayRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = replayedHashToken });
        Assert.Equal(HttpStatusCode.BadRequest, hashReplayRes.StatusCode);
        var hashJson = await hashReplayRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("already deposited", hashJson.GetProperty("error").GetString());

        // ── Vector 4: Tampered signature token ──
        var validToken = _host.MintScanToken(profileId);
        var parts = validToken.Split('.');
        var tamperedToken = $"{parts[0]}.badsignature";
        var tamperRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tamperedToken });
        Assert.Equal(HttpStatusCode.BadRequest, tamperRes.StatusCode);

        // ── Vector 5: Tampered JWT auth header ──
        var badAuthClient = _host.CreateAnonymousClient();
        badAuthClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "completely.invalid.jwt");
        var unauthRes = await badAuthClient.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = validToken });
        Assert.Equal(HttpStatusCode.Unauthorized, unauthRes.StatusCode);

        // ── Verify ledger state remained completely protected ──
        var prof = await _host.GetProfileAsync(client, profileId);
        Assert.Equal(1, prof.GetProperty("totalContainers").GetInt32());
        Assert.Equal(10, prof.GetProperty("pendingCents").GetInt32());
    }
}
