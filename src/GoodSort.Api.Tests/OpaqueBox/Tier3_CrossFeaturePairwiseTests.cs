using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;

namespace GoodSort.Api.Tests.OpaqueBox;

/// <summary>
/// Tier 3: Cross-Feature Combinations (Pairwise Combinatorial Testing).
/// Tests interactions between orthogonal system factors:
/// Auth States x Scan Types x Geofence States x Replay Defense x Household Lifecycle.
/// </summary>
public class Tier3_CrossFeaturePairwiseTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;
    public Tier3_CrossFeaturePairwiseTests(OpaqueBoxHost host) => _host = host;

    private const double BinLat = -27.5333;
    private const double BinLng = 153.0167;

    [Fact]
    public async Task Pairwise_01_FreshSignup_UnboundScan_BackfilledToHousehold()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("pair-01@example.test");
        var token = _host.MintScanToken(profileId, items: [new ScanTokenItem { Name = "Can", Material = "aluminium", Count = 2, Eligible = true }]);

        var confirmRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
        Assert.Equal(HttpStatusCode.OK, confirmRes.StatusCode);

        var hhRes = await client.PostAsJsonAsync("/api/households", new
        {
            name = "P1 House",
            address = "10 Mayfield Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = BinLat,
            lng = BinLng,
            councilCollectionDay = 1,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hhRes.StatusCode);
        var hh = await hhRes.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(2, hh.GetProperty("pendingContainers").GetInt32());
    }

    [Fact]
    public async Task Pairwise_02_FreshSignup_BinBoundScan_InFence_AttributedCleanly()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("pair-02@example.test");
        var token = _host.MintScanToken(profileId, binCode: "GS-P2", binLat: BinLat, binLng: BinLng);

        var confirmRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = token,
            lat = BinLat,
            lng = BinLng
        });
        Assert.Equal(HttpStatusCode.OK, confirmRes.StatusCode);

        var prof = await _host.GetProfileAsync(client, profileId);
        Assert.Equal(1, prof.GetProperty("totalContainers").GetInt32());
    }

    [Fact]
    public async Task Pairwise_03_FreshSignup_BinBoundScan_OutFence_Rejected_NoBackfill()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("pair-03@example.test");
        var token = _host.MintScanToken(profileId, binCode: "GS-P3", binLat: BinLat, binLng: BinLng);

        // 5km out of fence
        var confirmRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = token,
            lat = BinLat + 0.05,
            lng = BinLng + 0.05
        });
        Assert.Equal(HttpStatusCode.BadRequest, confirmRes.StatusCode);

        var hhRes = await client.PostAsJsonAsync("/api/households", new
        {
            name = "P3 House",
            address = "12 Mayfield Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = BinLat,
            lng = BinLng,
            councilCollectionDay = 2,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hhRes.StatusCode);
        var hh = await hhRes.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(0, hh.GetProperty("pendingContainers").GetInt32());
    }

    [Fact]
    public async Task Pairwise_04_ExistingMember_UnboundScan_DirectHouseholdAttribution()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("pair-04@example.test");
        var hhRes = await client.PostAsJsonAsync("/api/households", new
        {
            name = "P4 House",
            address = "14 Mayfield Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = BinLat,
            lng = BinLng,
            councilCollectionDay = 3,
            accessConsent = true,
        });
        var hhId = (await hhRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var token = _host.MintScanToken(profileId, items: [new ScanTokenItem { Name = "Bottle", Material = "pet", Count = 3, Eligible = true }]);
        var confirmRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
        Assert.Equal(HttpStatusCode.OK, confirmRes.StatusCode);

        var hh = await _host.GetHouseholdAsync(client, hhId);
        Assert.Equal(3, hh.GetProperty("pendingContainers").GetInt32());
    }

    [Fact]
    public async Task Pairwise_05_ExistingMember_BinBoundScan_InFence_DirectHouseholdAttribution()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("pair-05@example.test");
        var hhRes = await client.PostAsJsonAsync("/api/households", new
        {
            name = "P5 House",
            address = "16 Mayfield Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = BinLat,
            lng = BinLng,
            councilCollectionDay = 4,
            accessConsent = true,
        });
        var hhId = (await hhRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var token = _host.MintScanToken(profileId, binCode: "GS-P5", binLat: BinLat, binLng: BinLng);
        var confirmRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = token,
            lat = BinLat,
            lng = BinLng
        });
        Assert.Equal(HttpStatusCode.OK, confirmRes.StatusCode);

        var hh = await _host.GetHouseholdAsync(client, hhId);
        Assert.Equal(1, hh.GetProperty("pendingContainers").GetInt32());
    }

    [Fact]
    public async Task Pairwise_06_ExistingMember_BinBoundScan_OutFence_Rejected()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("pair-06@example.test");
        var hhRes = await client.PostAsJsonAsync("/api/households", new
        {
            name = "P6 House",
            address = "18 Mayfield Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = BinLat,
            lng = BinLng,
            councilCollectionDay = 5,
            accessConsent = true,
        });
        var hhId = (await hhRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var token = _host.MintScanToken(profileId, binCode: "GS-P6", binLat: BinLat, binLng: BinLng);
        var confirmRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = token,
            lat = BinLat + 0.02,
            lng = BinLng + 0.02
        });
        Assert.Equal(HttpStatusCode.BadRequest, confirmRes.StatusCode);

        var hh = await _host.GetHouseholdAsync(client, hhId);
        Assert.Equal(0, hh.GetProperty("pendingContainers").GetInt32());
    }

    [Fact]
    public async Task Pairwise_07_ExistingMember_SpentTokenReplay_Rejected_HouseholdNotChanged()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("pair-07@example.test");
        var hhRes = await client.PostAsJsonAsync("/api/households", new
        {
            name = "P7 House",
            address = "20 Mayfield Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = BinLat,
            lng = BinLng,
            councilCollectionDay = 1,
            accessConsent = true,
        });
        var hhId = (await hhRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var token = _host.MintScanToken(profileId);
        var res1 = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
        Assert.Equal(HttpStatusCode.OK, res1.StatusCode);

        var res2 = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
        Assert.Equal(HttpStatusCode.BadRequest, res2.StatusCode);

        var hh = await _host.GetHouseholdAsync(client, hhId);
        Assert.Equal(1, hh.GetProperty("pendingContainers").GetInt32());
    }

    [Fact]
    public async Task Pairwise_08_CollisionMember_OrphanScan_MergedIntoExistingHousehold()
    {
        const string email = "pair-08@example.test";
        var (clientA, _, profileA) = await _host.SignInMemberAsync(email);
        var hhRes = await clientA.PostAsJsonAsync("/api/households", new
        {
            name = "P8 Established",
            address = "22 Mayfield Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = BinLat,
            lng = BinLng,
            councilCollectionDay = 2,
            accessConsent = true,
        });
        var hhId = (await hhRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        // Simulate returning on another device/browser
        var (clientB, _, profileB) = await _host.SignInMemberAsync(email);
        Assert.Equal(profileA, profileB);

        var token = _host.MintScanToken(profileB, items: [new ScanTokenItem { Name = "Can", Material = "aluminium", Count = 2, Eligible = true }]);
        var confirmRes = await clientB.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
        Assert.Equal(HttpStatusCode.OK, confirmRes.StatusCode);

        var hh = await _host.GetHouseholdAsync(clientB, hhId);
        Assert.Equal(2, hh.GetProperty("pendingContainers").GetInt32());
    }

    [Fact]
    public async Task Pairwise_09_CollisionMember_ReplayedPhotoHash_Rejected()
    {
        const string email = "pair-09@example.test";
        var (clientA, _, profileA) = await _host.SignInMemberAsync(email);
        const string photoHash = "1234567890abcdef";

        var tok1 = _host.MintScanToken(profileA, photoHash: photoHash);
        var res1 = await clientA.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tok1 });
        Assert.Equal(HttpStatusCode.OK, res1.StatusCode);

        // Re-authenticate and attempt photo replay
        var (clientB, _, profileB) = await _host.SignInMemberAsync(email);
        var tok2 = _host.MintScanToken(profileB, photoHash: photoHash);
        var res2 = await clientB.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tok2 });
        Assert.Equal(HttpStatusCode.BadRequest, res2.StatusCode);
    }

    [Fact]
    public async Task Pairwise_10_ExistingMember_MultipleStreams_AccumulateHouseholdMaterials()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("pair-10@example.test");
        var hhRes = await client.PostAsJsonAsync("/api/households", new
        {
            name = "P10 Streams",
            address = "24 Mayfield Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = BinLat,
            lng = BinLng,
            councilCollectionDay = 3,
            accessConsent = true,
        });
        var hhId = (await hhRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var tok1 = _host.MintScanToken(profileId, items: [new ScanTokenItem { Name = "Alu", Material = "aluminium", Count = 2, Eligible = true }]);
        var tok2 = _host.MintScanToken(profileId, items: [new ScanTokenItem { Name = "Plastic", Material = "pet", Count = 3, Eligible = true }]);

        await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tok1 });
        await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tok2 });

        var hh = await _host.GetHouseholdAsync(client, hhId);
        var mat = hh.GetProperty("materials");
        Assert.Equal(2, mat.GetProperty("aluminium").GetInt32());
        Assert.Equal(3, mat.GetProperty("pet").GetInt32());
    }

    [Fact]
    public async Task Pairwise_11_FreshSignup_LaunchBonusTransition_OrphanBackfillSettle()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("pair-11@example.test");

        // Scan 49 containers: first 20 at 10c = 200c, remaining 29 at 5c = 145c => 345c
        var tok1 = _host.MintScanToken(profileId, items: [new ScanTokenItem { Name = "Batch1", Material = "aluminium", Count = 49, Eligible = true }]);
        await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tok1 });

        // Scan 2 more containers: both past cap at 5c = 10c => total 355c
        var tok2 = _host.MintScanToken(profileId, items: [new ScanTokenItem { Name = "Batch2", Material = "aluminium", Count = 2, Eligible = true }]);
        await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tok2 });

        var prof = await _host.GetProfileAsync(client, profileId);
        Assert.Equal(51, prof.GetProperty("totalContainers").GetInt32());
        Assert.Equal(355, prof.GetProperty("pendingCents").GetInt32()); // 20*10 + 31*5 = 355

        // Backfill to household
        var hhRes = await client.PostAsJsonAsync("/api/households", new
        {
            name = "P11 Bonus House",
            address = "26 Mayfield Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = BinLat,
            lng = BinLng,
            councilCollectionDay = 4,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hhRes.StatusCode);
        var hh = await hhRes.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(51, hh.GetProperty("pendingContainers").GetInt32());
        Assert.Equal(355, hh.GetProperty("pendingValueCents").GetInt32());
    }

    [Fact]
    public async Task Pairwise_12_ExpiredToken_FollowedBy_ValidToken_InFence_Recovery()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("pair-12@example.test");
        var expiredToken = _host.MintScanToken(profileId, ttl: TimeSpan.FromMinutes(-5));

        var failRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = expiredToken });
        Assert.Equal(HttpStatusCode.BadRequest, failRes.StatusCode);

        // Recover with fresh valid token
        var validToken = _host.MintScanToken(profileId);
        var successRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = validToken });
        Assert.Equal(HttpStatusCode.OK, successRes.StatusCode);
    }

    [Fact]
    public async Task Pairwise_13_CrossAccount_TokenRedemption_With_PreExistingHousehold()
    {
        var (clientA, _, profileA) = await _host.SignInMemberAsync("pair-13a@example.test");
        var (clientB, _, profileB) = await _host.SignInMemberAsync("pair-13b@example.test");

        var tokenA = _host.MintScanToken(profileA);
        // User B attempts to redeem User A's token
        var theftRes = await clientB.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tokenA });
        Assert.True(theftRes.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.BadRequest);

        var profA = await _host.GetProfileAsync(clientA, profileA);
        var profB = await _host.GetProfileAsync(clientB, profileB);

        Assert.Equal(0, profA.GetProperty("totalContainers").GetInt32());
        Assert.Equal(0, profB.GetProperty("totalContainers").GetInt32());
    }

    [Fact]
    public async Task Pairwise_14_Anonymous_Visitor_Attempts_ScanConfirm_Then_Authenticates_And_Confirms()
    {
        const string email = "pair-14@example.test";
        var anon = _host.CreateAnonymousClient();

        // 1. Anonymous attempt is rejected
        var unauthRes = await anon.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = "dummy" });
        Assert.Equal(HttpStatusCode.Unauthorized, unauthRes.StatusCode);

        // 2. Completes authentication
        var (client, _, profileId) = await _host.SignInMemberAsync(email);

        // 3. Completes valid confirmation
        var validToken = _host.MintScanToken(profileId);
        var authRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = validToken });
        Assert.Equal(HttpStatusCode.OK, authRes.StatusCode);
    }

    [Fact]
    public async Task Pairwise_15_BinBound_Scan_With_MissingLocation_Followed_By_InFenceRetry()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("pair-15@example.test");
        var token1 = _host.MintScanToken(profileId, binCode: "GS-P15", binLat: BinLat, binLng: BinLng);

        // Attempt without coordinates fails closed
        var failRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token1 });
        Assert.Equal(HttpStatusCode.BadRequest, failRes.StatusCode);

        // Retry with location standing at bin succeeds
        var token2 = _host.MintScanToken(profileId, binCode: "GS-P15", binLat: BinLat, binLng: BinLng);
        var okRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = token2,
            lat = BinLat,
            lng = BinLng
        });
        Assert.Equal(HttpStatusCode.OK, okRes.StatusCode);
    }
}
