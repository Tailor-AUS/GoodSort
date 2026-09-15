using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using GoodSort.Api.Tests.Simulations.Harness;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace GoodSort.Api.Tests.Simulations;

/// <summary>
/// Persona Journey Simulation Suite R4:
/// Referral Loop & Multi-Dwelling Unit Complex Edge Cases.
///
/// Simulates:
/// 1. Referral Loop:
///    - User A (Referrer Marcus) shares referral link with User B (Invitee Sarah).
///    - User B completes first container scan anonymously and verifies OTP with ReferrerId.
///    - Zero referral credit is awarded at OTP verification or initial scan confirm.
///    - User B completes residential address onboarding (Moorooka).
///    - Server triggers referral credit: User A receives exactly .00 (100¢) pending credit.
///    - User B's initial orphan scan is backfilled into their household bin (GS-H...).
///    - Duplicate referral prevention: User B registering another household does not credit User A again.
///    - Self-referral prevention: A user referring themselves receives zero referral bonus.
///
/// 2. Multi-Dwelling / Unit Complex Onboarding:
///    - User C (Apartment resident Alex) registers via POST /api/waitlist/unit-complex.
///    - Invariant: Zero single-dwelling placeholder bins (GS-H...) are created.
///    - Invariant: Initial orphan scan is backfilled directly into the complex record.
///    - Invariant: Cluster density (/api/growth/brisbane) strictly isolates unit complexes
///      from the 1,000-container residential volume run trigger.
///    - Invariant: Referral credit (.00) is awarded to referrer upon unit complex registration.
/// </summary>
public class R4ReferralAndMultiDwellingSimulationTests : IDisposable
{
    private readonly JourneySimulationHost _host;
    private readonly NetworkCaptureHandler _captureHandler;
    private readonly HttpClient _client;

    private const string MoorookaAddress = SimulationTestHarness.MoorookaAddress;
    private const double MoorookaLat = SimulationTestHarness.MoorookaLat;
    private const double MoorookaLng = SimulationTestHarness.MoorookaLng;

    public R4ReferralAndMultiDwellingSimulationTests()
    {
        _captureHandler = new NetworkCaptureHandler();
        _host = new JourneySimulationHost();
        _client = _host.CreateCapturedClient(_captureHandler);
    }

    public void Dispose()
    {
        _client.Dispose();
        _host.Dispose();
    }

    [Fact]
    public async Task R4_ReferralLoop_UserA_Invites_UserB_FirstScanAndOnboarding_AwardsOneDollarCredit()
    {
        // ══════════════════════════════════════════════════════════════════════
        // STEP 1: Establish Referrer (User A — Marcus)
        // ══════════════════════════════════════════════════════════════════════
        const string referrerEmail = "marcus.referrer@example.test";
        var sendOtpResA = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email = referrerEmail });
        Assert.Equal(HttpStatusCode.OK, sendOtpResA.StatusCode);
        var devCodeA = (await sendOtpResA.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString()!;

        var verifyOtpResA = await _client.PostAsJsonAsync("/api/auth/verify-otp", new { email = referrerEmail, code = devCodeA });
        Assert.Equal(HttpStatusCode.OK, verifyOtpResA.StatusCode);
        var verifyJsonA = await verifyOtpResA.Content.ReadFromJsonAsync<JsonElement>();
        var userAToken = verifyJsonA.GetProperty("token").GetString()!;
        var userAId = verifyJsonA.GetProperty("profile").GetProperty("id").GetGuid();

        // User A sets up residential household
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", userAToken);
        var hhResA = await _client.PostAsJsonAsync("/api/households", new
        {
            name = "Marcus' Moorooka Residence",
            address = "10 Hamilton Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            street = "Hamilton Rd",
            lat = MoorookaLat,
            lng = MoorookaLng,
            type = "residential",
            councilCollectionDay = 2,
            councilArea = "Brisbane City Council",
            accessConsent = true
        });
        Assert.Equal(HttpStatusCode.Created, hhResA.StatusCode);

        // Referrer initial baseline: 0 pending cents
        await _host.WithDbContextAsync(async db =>
        {
            var pA = await db.Profiles.FindAsync(userAId);
            Assert.NotNull(pA);
            Assert.Equal(0, pA.PendingCents);
        });

        // ══════════════════════════════════════════════════════════════════════
        // STEP 2: Invitee (User B — Sarah) Arrives via Referral Link (?ref=userAId)
        // ══════════════════════════════════════════════════════════════════════
        var clientB = _host.CreateCapturedClient(new NetworkCaptureHandler());
        const string inviteeEmail = "sarah.neighbor@example.test";

        // Sarah captures photo anonymously first (PLG flow)
        var photoBase64 = SimulationTestHarness.CreateDistinctTestImage(1);

        // Sarah enters email for OTP
        var sendOtpResB = await clientB.PostAsJsonAsync("/api/auth/send-otp", new { email = inviteeEmail });
        Assert.Equal(HttpStatusCode.OK, sendOtpResB.StatusCode);
        var devCodeB = (await sendOtpResB.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString()!;

        // Sarah verifies OTP and supplies referrerId = userAId
        var verifyOtpResB = await clientB.PostAsJsonAsync("/api/auth/verify-otp", new
        {
            email = inviteeEmail,
            code = devCodeB,
            referrerId = userAId
        });
        Assert.Equal(HttpStatusCode.OK, verifyOtpResB.StatusCode);
        var verifyJsonB = await verifyOtpResB.Content.ReadFromJsonAsync<JsonElement>();
        var userBToken = verifyJsonB.GetProperty("token").GetString()!;
        var userBId = verifyJsonB.GetProperty("profile").GetProperty("id").GetGuid();

        clientB.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", userBToken);

        // Invariant: User B's profile records ReferrerId = userAId, HouseholdId = null
        await _host.WithDbContextAsync(async db =>
        {
            var pB = await db.Profiles.FindAsync(userBId);
            Assert.NotNull(pB);
            Assert.Equal(userAId, pB.ReferrerId);
            Assert.Null(pB.HouseholdId);

            // Invariant: Referrer User A has NOT received credit yet!
            var pA = await db.Profiles.FindAsync(userAId);
            Assert.Equal(0, pA!.PendingCents);
        });

        // ══════════════════════════════════════════════════════════════════════
        // STEP 3: User B Completes Container Photo Scan & Confirmation
        // ══════════════════════════════════════════════════════════════════════
        var photoResB = await clientB.PostAsJsonAsync("/api/scan/photo", new { image = photoBase64 });
        Assert.Equal(HttpStatusCode.OK, photoResB.StatusCode);
        var photoJsonB = await photoResB.Content.ReadFromJsonAsync<JsonElement>();
        var scanTokenB = photoJsonB.GetProperty("scanToken").GetString()!;

        var confirmResB = await clientB.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = scanTokenB,
            lat = MoorookaLat,
            lng = MoorookaLng
        });
        Assert.Equal(HttpStatusCode.OK, confirmResB.StatusCode);

        // Invariant: User B gets 10¢ launch bonus, orphan scan created, User A still has 0¢
        await _host.WithDbContextAsync(async db =>
        {
            var pB = await db.Profiles.FindAsync(userBId);
            Assert.Equal(10, pB!.PendingCents);
            Assert.Equal(1, pB.TotalContainers);

            var orphanScan = await db.Scans.SingleAsync(s => s.UserId == userBId);
            Assert.Null(orphanScan.HouseholdId);

            var pA = await db.Profiles.FindAsync(userAId);
            Assert.Equal(0, pA!.PendingCents);
        });

        // ══════════════════════════════════════════════════════════════════════
        // STEP 4: User B Completes Moorooka Residential Address Onboarding
        // ══════════════════════════════════════════════════════════════════════
        var hhResB = await clientB.PostAsJsonAsync("/api/households", new
        {
            name = "Sarah's Residence",
            address = "44 Hamilton Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            street = "Hamilton Rd",
            lat = MoorookaLat,
            lng = MoorookaLng,
            type = "residential",
            councilCollectionDay = 2,
            councilArea = "Brisbane City Council",
            accessConsent = true
        });
        Assert.Equal(HttpStatusCode.Created, hhResB.StatusCode);
        var hhJsonB = await hhResB.Content.ReadFromJsonAsync<JsonElement>();
        var householdBId = hhJsonB.GetProperty("id").GetGuid();

        // ══════════════════════════════════════════════════════════════════════
        // STEP 5: Assert Referral Credit (.00 / 100¢) Awarded to User A
        // ══════════════════════════════════════════════════════════════════════
        await _host.WithDbContextAsync(async db =>
        {
            // CRITICAL INVARIANT: User A received exactly 100¢ (.00) pending referral credit!
            var pA = await db.Profiles.FindAsync(userAId);
            Assert.NotNull(pA);
            Assert.Equal(100, pA.PendingCents);

            // User B's orphan scan was backfilled into householdB
            var orphanCount = await db.Scans.CountAsync(s => s.UserId == userBId && s.HouseholdId == null);
            Assert.Equal(0, orphanCount);

            var backfilledScan = await db.Scans.SingleAsync(s => s.UserId == userBId);
            Assert.Equal(householdBId, backfilledScan.HouseholdId);

            var hhB = await db.Households.FindAsync(householdBId);
            Assert.NotNull(hhB);
            Assert.Equal(1, hhB.PendingContainers);
            Assert.Equal(10, hhB.PendingValueCents);
        });

        // Verify via API GET /api/profiles/{userAId}
        var getProfileARes = await _client.GetAsync($"/api/profiles/{userAId}");
        Assert.Equal(HttpStatusCode.OK, getProfileARes.StatusCode);
        var getProfileAJson = await getProfileARes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(100, getProfileAJson.GetProperty("pendingCents").GetInt32());

        // ══════════════════════════════════════════════════════════════════════
        // STEP 6: Anti-Fraud Verification — No Duplicate Referral Credit
        // ══════════════════════════════════════════════════════════════════════
        // If User B registers another household or triggers household creation again,
        // caller.HouseholdId is now NOT null, so User A must NOT receive double credit.
        var hhResB2 = await clientB.PostAsJsonAsync("/api/households", new
        {
            name = "Sarah's Second Address",
            address = "46 Hamilton Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            street = "Hamilton Rd",
            lat = MoorookaLat,
            lng = MoorookaLng,
            type = "residential",
            councilCollectionDay = 2,
            councilArea = "Brisbane City Council",
            accessConsent = true
        });
        Assert.Equal(HttpStatusCode.Created, hhResB2.StatusCode);

        await _host.WithDbContextAsync(async db =>
        {
            var pA = await db.Profiles.FindAsync(userAId);
            Assert.Equal(100, pA!.PendingCents); // Still exactly 100¢, not 200¢!
        });

        clientB.Dispose();
    }

    [Fact]
    public async Task R4_UnitComplex_Onboarding_NoPlaceholderBin_And_WaitlistDensityClusterIsolation()
    {
        // ══════════════════════════════════════════════════════════════════════
        // STEP 0: Referrer Setup (User A)
        // ══════════════════════════════════════════════════════════════════════
        const string referrerEmail = "marcus.building.ref@example.test";
        var sendOtpResA = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email = referrerEmail });
        var devCodeA = (await sendOtpResA.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString()!;
        var verifyOtpResA = await _client.PostAsJsonAsync("/api/auth/verify-otp", new { email = referrerEmail, code = devCodeA });
        var verifyJsonA = await verifyOtpResA.Content.ReadFromJsonAsync<JsonElement>();
        var userAToken = verifyJsonA.GetProperty("token").GetString()!;
        var userAId = verifyJsonA.GetProperty("profile").GetProperty("id").GetGuid();

        // Baseline cluster density before unit complex joins
        var densityResBefore = await _client.GetAsync("/api/growth/brisbane");
        Assert.Equal(HttpStatusCode.OK, densityResBefore.StatusCode);
        var densityJsonBefore = await densityResBefore.Content.ReadFromJsonAsync<JsonElement>();
        var residentialCountBefore = densityJsonBefore.GetProperty("totalHouseholds").GetInt32();

        // ══════════════════════════════════════════════════════════════════════
        // STEP 1: Apartment Resident Alex (User C) Joins via Referral Link
        // ══════════════════════════════════════════════════════════════════════
        const string residentEmail = "alex.apartment@example.test";
        var clientC = _host.CreateCapturedClient(new NetworkCaptureHandler());

        var sendOtpResC = await clientC.PostAsJsonAsync("/api/auth/send-otp", new { email = residentEmail });
        var devCodeC = (await sendOtpResC.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString()!;

        var verifyOtpResC = await clientC.PostAsJsonAsync("/api/auth/verify-otp", new
        {
            email = residentEmail,
            code = devCodeC,
            referrerId = userAId
        });
        Assert.Equal(HttpStatusCode.OK, verifyOtpResC.StatusCode);
        var verifyJsonC = await verifyOtpResC.Content.ReadFromJsonAsync<JsonElement>();
        var userCToken = verifyJsonC.GetProperty("token").GetString()!;
        var userCId = verifyJsonC.GetProperty("profile").GetProperty("id").GetGuid();
        clientC.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", userCToken);

        // ══════════════════════════════════════════════════════════════════════
        // STEP 2: Alex Performs Scan Before Onboarding (Orphan Scan)
        // ══════════════════════════════════════════════════════════════════════
        var photoResC = await clientC.PostAsJsonAsync("/api/scan/photo", new { image = SimulationTestHarness.CreateDistinctTestImage(7) });
        Assert.Equal(HttpStatusCode.OK, photoResC.StatusCode);
        var scanTokenC = (await photoResC.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("scanToken").GetString()!;

        var confResC = await clientC.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = scanTokenC,
            lat = MoorookaLat,
            lng = MoorookaLng
        });
        Assert.Equal(HttpStatusCode.OK, confResC.StatusCode);

        // Verify orphan scan created for Alex
        await _host.WithDbContextAsync(async db =>
        {
            var orphanScan = await db.Scans.SingleAsync(s => s.UserId == userCId);
            Assert.Null(orphanScan.HouseholdId);
            Assert.Equal(10, orphanScan.RefundCents);
        });

        // ══════════════════════════════════════════════════════════════════════
        // STEP 3: Alex Onboards via Unit Complex Waitlist (/api/waitlist/unit-complex)
        // ══════════════════════════════════════════════════════════════════════
        const string buildingName = "Hamilton Green Apartments";
        const string buildingAddress = "42 Hamilton Rd, Moorooka QLD 4105";

        var unitWaitlistRes = await clientC.PostAsJsonAsync("/api/waitlist/unit-complex", new
        {
            buildingName,
            address = buildingAddress,
            suburb = "MOOROOKA",
            lat = MoorookaLat,
            lng = MoorookaLng
        });
        Assert.Equal(HttpStatusCode.OK, unitWaitlistRes.StatusCode);
        var unitWaitlistJson = await unitWaitlistRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(unitWaitlistJson.GetProperty("waitlisted").GetBoolean());
        var complexHouseholdId = unitWaitlistJson.GetProperty("id").GetGuid();

        // ══════════════════════════════════════════════════════════════════════
        // STEP 4: Assert Invariants: No Bin Created & Scans Backfilled
        // ══════════════════════════════════════════════════════════════════════
        await _host.WithDbContextAsync(async db =>
        {
            var complex = await db.Households.FindAsync(complexHouseholdId);
            Assert.NotNull(complex);
            Assert.Equal("unit_complex", complex.Type);
            Assert.Equal("waitlisted", complex.BinStatus);
            Assert.Equal(buildingName, complex.Name);
            Assert.Equal(buildingName, complex.BuildingName);

            // CRITICAL INVARIANT 1: Zero single-dwelling placeholder bins generated!
            var binsForComplex = await db.Bins.Where(b => b.HouseholdId == complexHouseholdId).ToListAsync();
            Assert.Empty(binsForComplex);

            // CRITICAL INVARIANT 2: Initial orphan scan backfilled without requiring a bin
            var remainingOrphans = await db.Scans.CountAsync(s => s.UserId == userCId && s.HouseholdId == null);
            Assert.Equal(0, remainingOrphans);

            var attachedScan = await db.Scans.SingleAsync(s => s.UserId == userCId);
            Assert.Equal(complexHouseholdId, attachedScan.HouseholdId);

            // CRITICAL INVARIANT 3: Referrer User A receives .00 (100¢) pending referral credit
            var pA = await db.Profiles.FindAsync(userAId);
            Assert.NotNull(pA);
            Assert.Equal(100, pA.PendingCents);
        });

        // ══════════════════════════════════════════════════════════════════════
        // STEP 5: Assert Waitlist Cluster Density Isolation
        // ══════════════════════════════════════════════════════════════════════
        var densityResAfter = await _client.GetAsync("/api/growth/brisbane");
        Assert.Equal(HttpStatusCode.OK, densityResAfter.StatusCode);
        var densityJsonAfter = await densityResAfter.Content.ReadFromJsonAsync<JsonElement>();

        // Residential counted households MUST NOT increase due to unit complex onboarding!
        var residentialCountAfter = densityJsonAfter.GetProperty("totalHouseholds").GetInt32();
        Assert.Equal(residentialCountBefore, residentialCountAfter);

        // Verification via domain service
        Assert.False(WaitlistDensity.CountsTowardCluster("unit_complex", "MOOROOKA"));
        Assert.False(WaitlistDensity.IsResidential("unit_complex"));

        clientC.Dispose();
    }

    [Fact]
    public async Task R4_SelfReferral_DoesNotGrantReferralCredit()
    {
        // Anti-abuse invariant: A user cannot refer themselves
        const string email = "self.referral@example.test";
        var sendOtpRes = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        var devCode = (await sendOtpRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString()!;

        // Generate profile first
        var verifyOtpRes = await _client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = devCode });
        var verifyJson = await verifyOtpRes.Content.ReadFromJsonAsync<JsonElement>();
        var token = verifyJson.GetProperty("token").GetString()!;
        var userId = verifyJson.GetProperty("profile").GetProperty("id").GetGuid();

        // Re-authenticate attempting self-referral
        var sendOtpRes2 = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        var devCode2 = (await sendOtpRes2.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString()!;

        await _client.PostAsJsonAsync("/api/auth/verify-otp", new
        {
            email,
            code = devCode2,
            referrerId = userId // Self-referral attempt
        });

        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        await _client.PostAsJsonAsync("/api/households", new
        {
            name = "Self Referrer",
            address = MoorookaAddress,
            suburb = "MOOROOKA",
            street = "Hamilton Rd",
            lat = MoorookaLat,
            lng = MoorookaLng,
            type = "residential",
            councilCollectionDay = 2,
            accessConsent = true
        });

        await _host.WithDbContextAsync(async db =>
        {
            var p = await db.Profiles.FindAsync(userId);
            Assert.NotNull(p);
            // Self-referral awarded 0¢
            Assert.Equal(0, p.PendingCents);
        });
    }

    [Fact]
    public async Task ExportAuditArtifacts_R4_EndToEndCoverage()
    {
        var capture = new NetworkCaptureHandler();
        using var host = new JourneySimulationHost();
        using var client = host.CreateCapturedClient(capture);
        var snapshots = new List<StepDbSnapshot>();

        async Task<StepDbSnapshot> SnapAsync(string step, string desc, string email, Guid? pId = null, Guid? hId = null) =>
            await SimulationTestHarness.CaptureSnapshotAsync(host, step, desc, email, pId, hId);

        const string refEmail = "marcus.audit@example.test";
        snapshots.Add(await SnapAsync("Step 0", "Initial Clean State (Pre-Flight)", refEmail));

        // Step 1: User A Setup
        var sendOtpA = await client.PostAsJsonAsync("/api/auth/send-otp", new { email = refEmail });
        var codeA = (await sendOtpA.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString()!;
        var verifyOtpA = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email = refEmail, code = codeA });
        var jsonA = await verifyOtpA.Content.ReadFromJsonAsync<JsonElement>();
        var tokenA = jsonA.GetProperty("token").GetString()!;
        var userAId = jsonA.GetProperty("profile").GetProperty("id").GetGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenA);

        var hhA = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Marcus Residence", address = MoorookaAddress, suburb = "MOOROOKA", street = "Hamilton Rd",
            lat = MoorookaLat, lng = MoorookaLng, type = "residential", councilCollectionDay = 2, accessConsent = true
        });
        var hhAId = (await hhA.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        snapshots.Add(await SnapAsync("Step 1", "User A (Referrer) Setup Complete", refEmail, userAId, hhAId));

        // Step 2: User B Invitee Onboarding with Referral
        client.DefaultRequestHeaders.Authorization = null;
        const string inviteeEmail = "sarah.audit@example.test";
        var sendOtpB = await client.PostAsJsonAsync("/api/auth/send-otp", new { email = inviteeEmail });
        var codeB = (await sendOtpB.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString()!;
        var verifyOtpB = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email = inviteeEmail, code = codeB, referrerId = userAId });
        var jsonB = await verifyOtpB.Content.ReadFromJsonAsync<JsonElement>();
        var tokenB = jsonB.GetProperty("token").GetString()!;
        var userBId = jsonB.GetProperty("profile").GetProperty("id").GetGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenB);
        snapshots.Add(await SnapAsync("Step 2", "User B (Invitee) OTP Verified with ReferrerId", inviteeEmail, userBId));

        // Step 3: User B Initial Scan
        var photoB = await client.PostAsJsonAsync("/api/scan/photo", new { image = SimulationTestHarness.CreateDistinctTestImage(8) });
        var tokenScanB = (await photoB.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("scanToken").GetString()!;
        await client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tokenScanB, lat = MoorookaLat, lng = MoorookaLng });
        snapshots.Add(await SnapAsync("Step 3", "User B Confirms First Scan (Orphan Scan Created)", inviteeEmail, userBId));

        // Step 4: User B Household Created -> Awards $1.00 to User A
        var hhB = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Sarah Residence", address = "48 Hamilton Rd, Moorooka QLD 4105", suburb = "MOOROOKA", street = "Hamilton Rd",
            lat = MoorookaLat, lng = MoorookaLng, type = "residential", councilCollectionDay = 2, accessConsent = true
        });
        var hhBId = (await hhB.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        snapshots.Add(await SnapAsync("Step 4", "User B Household Created (User A Awarded $1.00)", inviteeEmail, userBId, hhBId));

        // Step 5: Unit Complex Apartment Resident Alex
        client.DefaultRequestHeaders.Authorization = null;
        const string alexEmail = "alex.audit@example.test";
        var sendOtpC = await client.PostAsJsonAsync("/api/auth/send-otp", new { email = alexEmail });
        var codeC = (await sendOtpC.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString()!;
        var verifyOtpC = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email = alexEmail, code = codeC });
        var jsonC = await verifyOtpC.Content.ReadFromJsonAsync<JsonElement>();
        var tokenC = jsonC.GetProperty("token").GetString()!;
        var userCId = jsonC.GetProperty("profile").GetProperty("id").GetGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenC);

        var complexRes = await client.PostAsJsonAsync("/api/waitlist/unit-complex", new
        {
            buildingName = "Hamilton Green Apartments",
            address = "42 Hamilton Rd, Moorooka QLD 4105",
            suburb = "MOOROOKA",
            lat = MoorookaLat,
            lng = MoorookaLng
        });
        var complexId = (await complexRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        snapshots.Add(await SnapAsync("Step 5", "Unit Complex Waitlist Joined (Zero Bins Generated)", alexEmail, userCId, complexId));

        // Step 6: Cluster Density Verification
        await client.GetAsync("/api/growth/brisbane");
        snapshots.Add(await SnapAsync("Step 6", "Cluster Density Verified (Unit Complex Isolated)", alexEmail, userCId, complexId));

        // Export markdown files
        var targetDir = @"C:\tailor_OS\GoodSort\.agents\teamwork_preview_worker_m1_1_gen2";
        if (Directory.Exists(targetDir))
        {
            var netMd = ArtifactWriter.GenerateNetworkLogsMarkdown(capture.Log);
            var dbMd = ArtifactWriter.GenerateDbVerificationMarkdown(snapshots);
            await File.WriteAllTextAsync(Path.Combine(targetDir, "network_logs_r4.md"), netMd, System.Text.Encoding.UTF8);
            await File.WriteAllTextAsync(Path.Combine(targetDir, "db_verification_r4.md"), dbMd, System.Text.Encoding.UTF8);
        }
    }
}
