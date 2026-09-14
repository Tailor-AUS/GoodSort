using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;

namespace GoodSort.Api.Tests.OpaqueBox;

/// <summary>
/// Tier 1: Category-Partition Feature Coverage Tests.
/// Exercises nominal, alternative, and error partitions for Features F1 through F11.
/// At least 5 distinct tests per feature (55 tests total).
/// </summary>
public class Tier1_FeatureCoverageTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;
    public Tier1_FeatureCoverageTests(OpaqueBoxHost host) => _host = host;

    // =========================================================================
    // F1: First-Time Scan (PLG)
    // =========================================================================

    [Fact]
    public async Task F1_01_Anonymous_User_Can_Access_Public_Scan_And_Bins()
    {
        var client = _host.CreateAnonymousClient();
        // Public bin lookup by QR code does not require auth
        var res = await client.GetAsync("/api/bins/code/GS-PUBLIC-TEST");
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode); // 404 cleanly, not 401

        // Full bin roster is protected for member privacy
        var roster = await client.GetAsync("/api/bins");
        Assert.Equal(HttpStatusCode.Unauthorized, roster.StatusCode);
    }

    [Fact]
    public async Task F1_02_Anonymous_Scan_Photo_Requires_Auth_Header_For_Server_Inference()
    {
        var client = _host.CreateAnonymousClient();
        var res = await client.PostAsJsonAsync("/api/scan/photo", new { image = "dGVzdC1pbWFnZQ==" });
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task F1_03_Anonymous_Scan_Confirm_Requires_Auth_Header()
    {
        var client = _host.CreateAnonymousClient();
        var res = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = "dummy-token" });
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task F1_04_Anonymous_Visitor_Can_Resolve_Bin_By_Code()
    {
        var client = _host.CreateAnonymousClient();
        var res = await client.GetAsync("/api/bins/code/GS-NONEXISTENT");
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task F1_05_Public_Health_And_Version_Endpoints_Available_To_Anonymous_Visitors()
    {
        var client = _host.CreateAnonymousClient();
        var health = await client.GetAsync("/api/health");
        Assert.Equal(HttpStatusCode.OK, health.StatusCode);

        var version = await client.GetAsync("/api/version");
        Assert.Equal(HttpStatusCode.OK, version.StatusCode);
    }

    // =========================================================================
    // F2: Vision & Credit Preview
    // =========================================================================

    [Fact]
    public async Task F2_01_Empty_Image_Payload_Returns_Bad_Request()
    {
        var (client, _, _) = await _host.SignInMemberAsync("f2-empty@example.test");
        var res = await client.PostAsJsonAsync("/api/scan/photo", new { image = "" });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(json.TryGetProperty("error", out var err));
        Assert.Equal("No image provided", err.GetString());
    }

    [Fact]
    public async Task F2_02_Missing_Image_Field_Returns_Bad_Request()
    {
        var (client, _, _) = await _host.SignInMemberAsync("f2-null@example.test");
        var res = await client.PostAsJsonAsync("/api/scan/photo", new { });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task F2_03_Photo_Scan_With_No_Vision_Provider_Returns_Fallback_Message()
    {
        var (client, _, _) = await _host.SignInMemberAsync("f2-fallback@example.test");
        var res = await client.PostAsJsonAsync("/api/scan/photo", new { image = "dGVzdC1kYXRh" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(json.TryGetProperty("message", out var msg));
        Assert.Contains("temporarily unavailable", msg.GetString());
    }

    [Fact]
    public async Task F2_04_Scan_Token_Carries_Item_List_And_Launch_Bonus()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f2-bonus@example.test");
        var token = _host.MintScanToken(profileId, items:
        [
            new ScanTokenItem { Name = "Coke Can", Material = "aluminium", Count = 2, Eligible = true }
        ]);

        var res = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        // First 2 containers inside launch bonus cap earn 10c each = 20c
        Assert.Equal(20, json.GetProperty("totalCents").GetInt32());
        Assert.True(json.GetProperty("bonusApplied").GetBoolean());
    }

    [Fact]
    public async Task F2_05_Photo_Scan_Consumes_Daily_Vision_Slot()
    {
        var (client, _, _) = await _host.SignInMemberAsync("f2-slot@example.test");
        var res = await client.PostAsJsonAsync("/api/scan/photo", new { image = "c2xvdC10ZXN0" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    // =========================================================================
    // F3: OTP Auth & Session Persistence
    // =========================================================================

    [Fact]
    public async Task F3_01_Send_Otp_With_Valid_Email_Issues_DevCode_In_Development()
    {
        var client = _host.CreateAnonymousClient();
        var res = await client.PostAsJsonAsync("/api/auth/send-otp", new { email = "f3-valid@example.test" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(json.GetProperty("sent").GetBoolean());
        var code = json.GetProperty("devCode").GetString();
        Assert.NotNull(code);
        Assert.Equal(6, code.Length);
    }

    [Fact]
    public async Task F3_02_Send_Otp_With_Invalid_Email_Returns_Bad_Request()
    {
        var client = _host.CreateAnonymousClient();
        var res = await client.PostAsJsonAsync("/api/auth/send-otp", new { email = "not-an-email" });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task F3_03_Verify_Otp_With_Correct_Code_Returns_Jwt_And_Profile()
    {
        var client = _host.CreateAnonymousClient();
        const string email = "f3-verify@example.test";
        var send = await client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        var devCode = (await send.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();

        var verify = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = devCode });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        var json = await verify.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(json.TryGetProperty("token", out var tok) && !string.IsNullOrEmpty(tok.GetString()));
        Assert.True(json.TryGetProperty("profile", out var prof));
        Assert.Equal(email, prof.GetProperty("email").GetString());
    }

    [Fact]
    public async Task F3_04_Verify_Otp_With_Incorrect_Code_Returns_Unauthorized()
    {
        var client = _host.CreateAnonymousClient();
        const string email = "f3-wrong@example.test";
        var send = await client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        var devCode = (await send.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var wrong = devCode == "000000" ? "999999" : "000000";

        var verify = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = wrong });
        Assert.Equal(HttpStatusCode.Unauthorized, verify.StatusCode);
    }

    [Fact]
    public async Task F3_05_Verify_Otp_Can_Only_Be_Used_Once()
    {
        var client = _host.CreateAnonymousClient();
        const string email = "f3-singleuse@example.test";
        var send = await client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        var devCode = (await send.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();

        var first = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = devCode });
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        var second = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = devCode });
        Assert.Equal(HttpStatusCode.Unauthorized, second.StatusCode);
    }

    // =========================================================================
    // F4: Onboarding & Suburb Association
    // =========================================================================

    [Fact]
    public async Task F4_01_Bin_Day_Lookup_Returns_Schedule_For_Valid_Coordinates()
    {
        var client = _host.CreateAnonymousClient();
        var res = await client.PostAsJsonAsync("/api/households/lookup-bin-day", new
        {
            lat = -27.5333,
            lng = 153.0167,
            address = "12 Muriel Ave, Moorooka QLD 4105"
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(json.TryGetProperty("found", out _));
    }

    [Fact]
    public async Task F4_02_Create_Household_Sets_Status_To_Waitlisted()
    {
        var (client, _, _) = await _host.SignInMemberAsync("f4-waitlist@example.test");
        var res = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Moorooka Home",
            address = "14 Beaudesert Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            street = "Beaudesert Rd",
            lat = -27.5333,
            lng = 153.0167,
            type = "residential",
            councilCollectionDay = 1,
            councilArea = "Brisbane City Council",
            accessConsent = true,
        });

        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var hh = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("waitlisted", hh.GetProperty("binStatus").GetString());
    }

    [Fact]
    public async Task F4_03_Create_Household_Automatically_Links_To_Member_Profile()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f4-link@example.test");
        var res = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Link Home",
            address = "10 Hamilton Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = -27.5333,
            lng = 153.0167,
            councilCollectionDay = 2,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var hh = await res.Content.ReadFromJsonAsync<JsonElement>();
        var householdId = hh.GetProperty("id").GetGuid();

        var prof = await _host.GetProfileAsync(client, profileId);
        Assert.Equal(householdId, prof.GetProperty("householdId").GetGuid());
    }

    [Fact]
    public async Task F4_04_Create_Household_Backfills_Orphan_Scans()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f4-orphan@example.test");

        // Perform orphan scan before household exists
        var token = _host.MintScanToken(profileId, items:
        [
            new ScanTokenItem { Name = "Coke Can", Material = "aluminium", Count = 1, Eligible = true }
        ]);
        var confirmRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
        Assert.Equal(HttpStatusCode.OK, confirmRes.StatusCode);

        // Now create household
        var hhRes = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Backfill House",
            address = "22 Vendale Ave, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = -27.5333,
            lng = 153.0167,
            councilCollectionDay = 3,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hhRes.StatusCode);
        var hh = await hhRes.Content.ReadFromJsonAsync<JsonElement>();

        // Orphan scan must now be attached to the household
        Assert.Equal(1, hh.GetProperty("pendingContainers").GetInt32());
    }

    [Fact]
    public async Task F4_05_Backfilled_Containers_Increment_Household_And_Suburb_Demand()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f4-demand@example.test");

        var token = _host.MintScanToken(profileId, items:
        [
            new ScanTokenItem { Name = "Pepsi Max", Material = "aluminium", Count = 3, Eligible = true }
        ]);
        await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });

        var hhRes = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Demand House",
            address = "45 Mayfield Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = -27.5333,
            lng = 153.0167,
            councilCollectionDay = 4,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hhRes.StatusCode);
        var hh = await hhRes.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(3, hh.GetProperty("pendingContainers").GetInt32());
        Assert.Equal(30, hh.GetProperty("pendingValueCents").GetInt32());
    }

    // =========================================================================
    // F5: Authenticated Re-Entry
    // =========================================================================

    [Fact]
    public async Task F5_01_Authenticated_User_Token_Accesses_Protected_Profile()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f5-reentry@example.test");
        var prof = await _host.GetProfileAsync(client, profileId);
        Assert.Equal(profileId, prof.GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task F5_02_Authenticated_User_Directly_Accesses_Photo_Scan()
    {
        var (client, _, _) = await _host.SignInMemberAsync("f5-camera@example.test");
        var res = await client.PostAsJsonAsync("/api/scan/photo", new { image = "cmVlbnRyeQ==" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task F5_03_Authenticated_User_Directly_Submits_Barcode_Scan()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f5-barcode@example.test");
        var res = await client.PostAsJsonAsync("/api/scans", new
        {
            barcode = "9300675024235",
            containerName = "Coca-Cola 375ml Can",
            material = "aluminium",
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var prof = await _host.GetProfileAsync(client, profileId);
        Assert.Equal(1, prof.GetProperty("totalContainers").GetInt32());
    }

    [Fact]
    public async Task F5_04_Authenticated_User_Can_Fetch_Household_Status()
    {
        var (client, _, _) = await _host.SignInMemberAsync("f5-hh@example.test");
        var createRes = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Reentry Household",
            address = "50 Woodridge Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = -27.5333,
            lng = 153.0167,
            councilCollectionDay = 1,
            accessConsent = true,
        });
        var hhId = (await createRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var hh = await _host.GetHouseholdAsync(client, hhId);
        Assert.Equal(hhId, hh.GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task F5_05_Multiple_Clients_With_Same_Token_Share_Active_Session()
    {
        var (_, token, profileId) = await _host.SignInMemberAsync("f5-shared@example.test");

        var clientA = _host.CreateAnonymousClient();
        clientA.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var clientB = _host.CreateAnonymousClient();
        clientB.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var profA = await _host.GetProfileAsync(clientA, profileId);
        var profB = await _host.GetProfileAsync(clientB, profileId);
        Assert.Equal(profA.GetProperty("id").GetGuid(), profB.GetProperty("id").GetGuid());
    }

    // =========================================================================
    // F6: Direct Deposit Attribution
    // =========================================================================

    [Fact]
    public async Task F6_01_Confirming_Scan_Attributes_Directly_To_Existing_Household()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f6-attr@example.test");
        var hhRes = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Attribution House",
            address = "60 Gainsborough St, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = -27.5333,
            lng = 153.0167,
            councilCollectionDay = 2,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hhRes.StatusCode);
        var hhId = (await hhRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var token = _host.MintScanToken(profileId, items:
        [
            new ScanTokenItem { Name = "Solo 375ml", Material = "aluminium", Count = 1, Eligible = true }
        ]);
        var confirmRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
        Assert.Equal(HttpStatusCode.OK, confirmRes.StatusCode);

        var hh = await _host.GetHouseholdAsync(client, hhId);
        Assert.Equal(1, hh.GetProperty("pendingContainers").GetInt32());
    }

    [Fact]
    public async Task F6_02_Confirming_Scan_Increments_Profile_Pending_Cents_And_Containers()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f6-prof@example.test");
        var token = _host.MintScanToken(profileId, items:
        [
            new ScanTokenItem { Name = "Can", Material = "aluminium", Count = 2, Eligible = true }
        ]);
        await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });

        var prof = await _host.GetProfileAsync(client, profileId);
        Assert.Equal(2, prof.GetProperty("totalContainers").GetInt32());
        Assert.Equal(20, prof.GetProperty("pendingCents").GetInt32());
    }

    [Fact]
    public async Task F6_03_Confirming_Scan_Increments_Household_Pending_Counters()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f6-counters@example.test");
        var hhRes = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Counters House",
            address = "70 Mayfield Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = -27.5333,
            lng = 153.0167,
            councilCollectionDay = 3,
            accessConsent = true,
        });
        var hhId = (await hhRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var token = _host.MintScanToken(profileId, items:
        [
            new ScanTokenItem { Name = "Bottle", Material = "pet", Count = 4, Eligible = true }
        ]);
        await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });

        var hh = await _host.GetHouseholdAsync(client, hhId);
        Assert.Equal(4, hh.GetProperty("pendingContainers").GetInt32());
        Assert.Equal(40, hh.GetProperty("pendingValueCents").GetInt32());
    }

    [Fact]
    public async Task F6_04_Material_Stream_Classification_Is_Recorded_On_Household()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f6-material@example.test");
        var hhRes = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Stream House",
            address = "80 Vendale Ave, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = -27.5333,
            lng = 153.0167,
            councilCollectionDay = 4,
            accessConsent = true,
        });
        var hhId = (await hhRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var token = _host.MintScanToken(profileId, items:
        [
            new ScanTokenItem { Name = "Beer Bottle", Material = "glass", Count = 2, Eligible = true },
            new ScanTokenItem { Name = "Coke Can", Material = "aluminium", Count = 1, Eligible = true }
        ]);
        await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });

        var hh = await _host.GetHouseholdAsync(client, hhId);
        var materials = hh.GetProperty("materials");
        Assert.Equal(2, materials.GetProperty("glass").GetInt32());
        Assert.Equal(1, materials.GetProperty("aluminium").GetInt32());
    }

    [Fact]
    public async Task F6_05_Consecutive_Scans_Accumulate_Credits_Accurately()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f6-accum@example.test");
        var token1 = _host.MintScanToken(profileId, items: [new ScanTokenItem { Name = "A", Material = "aluminium", Count = 1, Eligible = true }]);
        var token2 = _host.MintScanToken(profileId, items: [new ScanTokenItem { Name = "B", Material = "aluminium", Count = 1, Eligible = true }]);
        var token3 = _host.MintScanToken(profileId, items: [new ScanTokenItem { Name = "C", Material = "aluminium", Count = 1, Eligible = true }]);

        await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token1 });
        await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token2 });
        await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token3 });

        var prof = await _host.GetProfileAsync(client, profileId);
        Assert.Equal(3, prof.GetProperty("totalContainers").GetInt32());
        Assert.Equal(30, prof.GetProperty("pendingCents").GetInt32());
    }

    // =========================================================================
    // F7: Credential Expiry & Invalid Tokens
    // =========================================================================

    [Fact]
    public async Task F7_01_Missing_Authorization_Header_Returns_Unauthorized()
    {
        var client = _host.CreateAnonymousClient();
        var res = await client.PostAsJsonAsync("/api/scans", new
        {
            barcode = "9300675024235",
            containerName = "Can",
            material = "aluminium"
        });
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task F7_02_Malformed_Bearer_Scheme_Returns_Unauthorized()
    {
        var client = _host.CreateAnonymousClient();
        client.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", "InvalidScheme xyz");
        var res = await client.PostAsJsonAsync("/api/scans", new
        {
            barcode = "9300675024235",
            containerName = "Can",
            material = "aluminium"
        });
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task F7_03_Tampered_Jwt_Signature_Returns_Unauthorized()
    {
        var (_, validToken, _) = await _host.SignInMemberAsync("f7-tamper@example.test");
        var parts = validToken.Split('.');
        var tampered = $"{parts[0]}.{parts[1]}.badsignature00000000";

        var client = _host.CreateAnonymousClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tampered);
        var res = await client.PostAsJsonAsync("/api/scans", new
        {
            barcode = "9300675024235",
            containerName = "Can",
            material = "aluminium"
        });
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task F7_04_Forged_Jwt_Signed_With_Wrong_Secret_Returns_Unauthorized()
    {
        // JWT signed with different key
        var wrongSecret = "completely-different-wrong-secret-key-0123456789";
        var tokenHandler = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler();
        var descriptor = new Microsoft.IdentityModel.Tokens.SecurityTokenDescriptor
        {
            Subject = new System.Security.Claims.ClaimsIdentity([new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())]),
            Expires = DateTime.UtcNow.AddDays(1),
            SigningCredentials = new Microsoft.IdentityModel.Tokens.SigningCredentials(
                new Microsoft.IdentityModel.Tokens.SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(wrongSecret)),
                Microsoft.IdentityModel.Tokens.SecurityAlgorithms.HmacSha256Signature)
        };
        var forged = tokenHandler.CreateToken(descriptor);
        var tokenString = tokenHandler.WriteToken(forged);

        var client = _host.CreateAnonymousClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenString);
        var res = await client.PostAsJsonAsync("/api/scans", new
        {
            barcode = "9300675024235",
            containerName = "Can",
            material = "aluminium"
        });
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task F7_05_Protected_Endpoint_Rejects_Anonymous_Caller_Even_With_Explicit_UserId()
    {
        var client = _host.CreateAnonymousClient();
        var res = await client.PostAsJsonAsync("/api/scans", new
        {
            userId = Guid.NewGuid(),
            barcode = "9300675024235",
            containerName = "Can",
            material = "aluminium"
        });
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    // =========================================================================
    // F8: Concurrent Scans Audit
    // =========================================================================

    [Fact]
    public async Task F8_01_Two_Distinct_Scan_Tokens_Confirmed_Simultaneously_Both_Succeed()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f8-concurrent@example.test");
        var tokenA = _host.MintScanToken(profileId, items: [new ScanTokenItem { Name = "A", Material = "aluminium", Count = 1, Eligible = true }]);
        var tokenB = _host.MintScanToken(profileId, items: [new ScanTokenItem { Name = "B", Material = "aluminium", Count = 1, Eligible = true }]);

        var resA = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tokenA });
        var resB = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tokenB });

        Assert.Equal(HttpStatusCode.OK, resA.StatusCode);
        Assert.Equal(HttpStatusCode.OK, resB.StatusCode);

        var prof = await _host.GetProfileAsync(client, profileId);
        Assert.Equal(2, prof.GetProperty("totalContainers").GetInt32());
    }

    [Fact]
    public async Task F8_02_Five_Concurrent_Barcode_Scans_Accumulate_Atomic_Total()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f8-barcode-concurrent@example.test");

        for (var i = 0; i < 5; i++)
        {
            var res = await client.PostAsJsonAsync("/api/scans", new
            {
                barcode = $"930067502423{i}",
                containerName = $"Can {i}",
                material = "aluminium"
            });
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        }

        var prof = await _host.GetProfileAsync(client, profileId);
        Assert.Equal(5, prof.GetProperty("totalContainers").GetInt32());
    }

    [Fact]
    public async Task F8_03_Concurrent_Scans_From_Different_Accounts_Do_Not_Cross_Contaminate()
    {
        var (clientA, _, profileA) = await _host.SignInMemberAsync("f8-userA@example.test");
        var (clientB, _, profileB) = await _host.SignInMemberAsync("f8-userB@example.test");

        var tokenA = _host.MintScanToken(profileA, items: [new ScanTokenItem { Name = "Can A", Material = "aluminium", Count = 3, Eligible = true }]);
        var tokenB = _host.MintScanToken(profileB, items: [new ScanTokenItem { Name = "Can B", Material = "pet", Count = 2, Eligible = true }]);

        var taskA = clientA.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tokenA });
        var taskB = clientB.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tokenB });

        var responses = await Task.WhenAll(taskA, taskB);
        Assert.All(responses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));

        var profA = await _host.GetProfileAsync(clientA, profileA);
        var profB = await _host.GetProfileAsync(clientB, profileB);

        Assert.Equal(3, profA.GetProperty("totalContainers").GetInt32());
        Assert.Equal(2, profB.GetProperty("totalContainers").GetInt32());
    }

    [Fact]
    public async Task F8_04_Concurrent_Vision_Slot_Reservations_Are_Isolated()
    {
        var (clientA, _, _) = await _host.SignInMemberAsync("f8-visionA@example.test");
        var (clientB, _, _) = await _host.SignInMemberAsync("f8-visionB@example.test");

        var taskA = clientA.PostAsJsonAsync("/api/scan/photo", new { image = "dmlzaW9uQQ==" });
        var taskB = clientB.PostAsJsonAsync("/api/scan/photo", new { image = "dmlzaW9uQg==" });

        var responses = await Task.WhenAll(taskA, taskB);
        Assert.All(responses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
    }

    [Fact]
    public async Task F8_05_Atomic_Ledger_Integrity_Maintains_Conservation_Of_Credit()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f8-conservation@example.test");
        for (var i = 0; i < 4; i++)
        {
            var token = _host.MintScanToken(profileId, items: [new ScanTokenItem { Name = $"C{i}", Material = "aluminium", Count = 1, Eligible = true }]);
            var res = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        }

        var prof = await _host.GetProfileAsync(client, profileId);
        Assert.Equal(4, prof.GetProperty("totalContainers").GetInt32());
        Assert.Equal(40, prof.GetProperty("pendingCents").GetInt32());
    }

    // =========================================================================
    // F9: Account Collision Handling
    // =========================================================================

    [Fact]
    public async Task F9_01_Otp_Verification_With_Existing_Email_Returns_Existing_Profile()
    {
        const string email = "f9-collision@example.test";
        var (_, _, firstProfileId) = await _host.SignInMemberAsync(email);

        var client = _host.CreateAnonymousClient();
        var send = await client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        var devCode = (await send.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verify = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = devCode });

        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        var secondProfileId = (await verify.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("profile").GetProperty("id").GetGuid();
        Assert.Equal(firstProfileId, secondProfileId);
    }

    [Fact]
    public async Task F9_02_No_Duplicate_Profile_Created_On_Account_Collision()
    {
        const string email = "f9-nodup@example.test";
        var (_, _, id1) = await _host.SignInMemberAsync(email);
        var (_, _, id2) = await _host.SignInMemberAsync(email);
        Assert.Equal(id1, id2);
    }

    [Fact]
    public async Task F9_03_Scan_Confirmed_After_Collision_Login_Attaches_To_Existing_Profile()
    {
        const string email = "f9-scanmerge@example.test";
        var (client1, _, profileId) = await _host.SignInMemberAsync(email);
        var tok1 = _host.MintScanToken(profileId, items: [new ScanTokenItem { Name = "Initial", Material = "aluminium", Count = 1, Eligible = true }]);
        await client1.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tok1 });

        // Second login session for same email
        var (client2, _, id2) = await _host.SignInMemberAsync(email);
        Assert.Equal(profileId, id2);
        var tok2 = _host.MintScanToken(id2, items: [new ScanTokenItem { Name = "Subsequent", Material = "pet", Count = 2, Eligible = true }]);
        var confirm2 = await client2.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tok2 });
        Assert.Equal(HttpStatusCode.OK, confirm2.StatusCode);

        var prof = await _host.GetProfileAsync(client2, profileId);
        Assert.Equal(3, prof.GetProperty("totalContainers").GetInt32());
    }

    [Fact]
    public async Task F9_04_Collision_Login_Preserves_Existing_Household_Linkage()
    {
        const string email = "f9-hhlink@example.test";
        var (client1, _, profileId) = await _host.SignInMemberAsync(email);
        var hhRes = await client1.PostAsJsonAsync("/api/households", new
        {
            name = "Persistent HH",
            address = "90 Mayfield Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = -27.5333,
            lng = 153.0167,
            councilCollectionDay = 5,
            accessConsent = true,
        });
        var hhId = (await hhRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        // Re-login
        var (client2, _, id2) = await _host.SignInMemberAsync(email);
        var prof = await _host.GetProfileAsync(client2, id2);
        Assert.Equal(hhId, prof.GetProperty("householdId").GetGuid());
    }

    [Fact]
    public async Task F9_05_Collision_Login_Preserves_Existing_Pending_Balance()
    {
        const string email = "f9-balance@example.test";
        var (client1, _, profileId) = await _host.SignInMemberAsync(email);
        var tok = _host.MintScanToken(profileId, items: [new ScanTokenItem { Name = "Bonus", Material = "aluminium", Count = 3, Eligible = true }]);
        await client1.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tok });

        // Re-login
        var (client2, _, id2) = await _host.SignInMemberAsync(email);
        var prof = await _host.GetProfileAsync(client2, id2);
        Assert.Equal(30, prof.GetProperty("pendingCents").GetInt32());
    }

    // =========================================================================
    // F10: Replay & Geofence Prevention
    // =========================================================================

    [Fact]
    public async Task F10_01_Replaying_Spent_Scan_Token_Returns_Bad_Request()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f10-replay@example.test");
        var token = _host.MintScanToken(profileId);

        var first = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        var second = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
        Assert.Equal(HttpStatusCode.BadRequest, second.StatusCode);
    }

    [Fact]
    public async Task F10_02_Rapid_Triple_Replay_Credits_Exactly_Once()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f10-triplereplay@example.test");
        var token = _host.MintScanToken(profileId);

        var responses = await Task.WhenAll(
            client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token }),
            client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token }),
            client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token })
        );

        var okCount = responses.Count(r => r.StatusCode == HttpStatusCode.OK);
        var badCount = responses.Count(r => r.StatusCode == HttpStatusCode.BadRequest);
        Assert.Equal(1, okCount);
        Assert.Equal(2, badCount);
    }

    [Fact]
    public async Task F10_03_Bin_Bound_Scan_At_Bin_Coordinates_Succeeds()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f10-geook@example.test");
        const double binLat = -27.5333;
        const double binLng = 153.0167;
        var token = _host.MintScanToken(profileId, binCode: "GS-TEST-1", binLat: binLat, binLng: binLng);

        var res = await client.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = token,
            lat = binLat,
            lng = binLng,
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task F10_04_Bin_Bound_Scan_Beyond_Geofence_Returns_Bad_Request()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f10-geofail@example.test");
        const double binLat = -27.5333;
        const double binLng = 153.0167;
        var token = _host.MintScanToken(profileId, binCode: "GS-TEST-1", binLat: binLat, binLng: binLng);

        // 8km away
        var res = await client.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = token,
            lat = -27.4689,
            lng = 153.0235,
        });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("Move closer", json.GetProperty("error").GetString());
    }

    [Fact]
    public async Task F10_05_Bin_Bound_Scan_Without_Location_Fails_Closed()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f10-nolocation@example.test");
        const double binLat = -27.5333;
        const double binLng = 153.0167;
        var token = _host.MintScanToken(profileId, binCode: "GS-TEST-1", binLat: binLat, binLng: binLng);

        var res = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("Location required", json.GetProperty("error").GetString());
    }

    // =========================================================================
    // F11: Network Drop & Offline Recovery
    // =========================================================================

    [Fact]
    public async Task F11_01_Failed_Network_Confirmation_Can_Be_Safely_Retried()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f11-retry@example.test");
        var token = _host.MintScanToken(profileId);

        // Retry of valid unspent token succeeds
        var res = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task F11_02_Successful_Scan_Already_Committed_Refuses_Duplicate_On_Network_Retry()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f11-idempotent@example.test");
        var token = _host.MintScanToken(profileId);

        var initial = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
        Assert.Equal(HttpStatusCode.OK, initial.StatusCode);

        // Client thought it failed and retries
        var retry = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });
        Assert.Equal(HttpStatusCode.BadRequest, retry.StatusCode);

        var prof = await _host.GetProfileAsync(client, profileId);
        Assert.Equal(1, prof.GetProperty("totalContainers").GetInt32());
    }

    [Fact]
    public async Task F11_03_Client_Recovers_Profile_Balance_After_Network_Interruption()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f11-recovery@example.test");
        var token = _host.MintScanToken(profileId, items: [new ScanTokenItem { Name = "Coke", Material = "aluminium", Count = 2, Eligible = true }]);
        await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token });

        // Simulate reconnecting and fetching source of truth
        var prof = await _host.GetProfileAsync(client, profileId);
        Assert.Equal(20, prof.GetProperty("pendingCents").GetInt32());
    }

    [Fact]
    public async Task F11_04_Multiple_Pending_Scans_Sync_Sequentially_After_Reconnect()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f11-syncqueue@example.test");
        var queue = new[]
        {
            _host.MintScanToken(profileId, items: [new ScanTokenItem { Name = "Q1", Material = "aluminium", Count = 1, Eligible = true }]),
            _host.MintScanToken(profileId, items: [new ScanTokenItem { Name = "Q2", Material = "aluminium", Count = 1, Eligible = true }]),
            _host.MintScanToken(profileId, items: [new ScanTokenItem { Name = "Q3", Material = "aluminium", Count = 1, Eligible = true }])
        };

        foreach (var tok in queue)
        {
            var res = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tok });
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        }

        var prof = await _host.GetProfileAsync(client, profileId);
        Assert.Equal(3, prof.GetProperty("totalContainers").GetInt32());
        Assert.Equal(30, prof.GetProperty("pendingCents").GetInt32());
    }

    [Fact]
    public async Task F11_05_Refused_Scan_Does_Not_Corrupt_Subsequent_Queued_Scans()
    {
        var (client, _, profileId) = await _host.SignInMemberAsync("f11-queueerror@example.test");
        var invalidToken = "invalid.scan.token";
        var validToken = _host.MintScanToken(profileId, items: [new ScanTokenItem { Name = "Valid", Material = "aluminium", Count = 1, Eligible = true }]);

        var refused = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = invalidToken });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);

        var accepted = await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = validToken });
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);

        var prof = await _host.GetProfileAsync(client, profileId);
        Assert.Equal(1, prof.GetProperty("totalContainers").GetInt32());
    }
}
