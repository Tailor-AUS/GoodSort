using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using GoodSort.Api.Tests.Simulations.Harness;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace GoodSort.Api.Tests.Simulations;

/// <summary>
/// Milestone 1: Automated Integration Test Suite for the R1 First-Time User Journey (PLG Scan -> Onboarding).
/// Simulates the end-to-end user lifecycle using WebApplicationFactory<Program>:
/// 1. Anonymous landing and email OTP request (/api/auth/send-otp)
/// 2. OTP verification, profile creation with HouseholdId = null, and 30-day JWT issuance (/api/auth/verify-otp)
/// 3. Authenticated photo analysis with 10¢ launch bonus preview and signed scanToken (/api/scan/photo)
/// 4. Deposit confirmation with atomic single-use redemption, orphan scan creation, and profile pending credit (/api/scan/photo/confirm)
/// 5. Council bin-day lookup (/api/households/lookup-bin-day)
/// 6. Household registration with waitlist placement and orphan scan backfill (/api/households)
/// 7. Post-onboarding profile inspection (/api/profiles/{id})
/// </summary>
public class R1FirstTimeJourneySimulationTests : IDisposable
{
    private readonly JourneySimulationHost _host;
    private readonly NetworkCaptureHandler _captureHandler;
    private readonly HttpClient _client;

    public R1FirstTimeJourneySimulationTests()
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

    private async Task<StepDbSnapshot> CaptureSnapshotAsync(string stepName, string description, string email, Guid? profileId = null, Guid? householdId = null)
    {
        return await _host.WithDbContextAsync(async db =>
        {
            var profile = profileId.HasValue ? await db.Profiles.FindAsync(profileId.Value) : await db.Profiles.FirstOrDefaultAsync(p => p.Email == email);
            var otp = await db.OtpCodes.Where(o => o.Email == email).OrderByDescending(o => o.CreatedAt).FirstOrDefaultAsync();
            var scans = profile != null ? await db.Scans.Where(s => s.UserId == profile.Id).ToListAsync() : [];
            var firstScan = scans.FirstOrDefault();
            var usedTokens = profile != null ? await db.UsedScanTokens.Where(u => u.UserId == profile.Id).ToListAsync() : [];
            var household = householdId.HasValue ? await db.Households.FindAsync(householdId.Value) : (profile?.HouseholdId != null ? await db.Households.FindAsync(profile.HouseholdId.Value) : null);
            var bin = household != null ? await db.Bins.FirstOrDefaultAsync(b => b.HouseholdId == household.Id) : null;

            return new StepDbSnapshot
            {
                StepName = stepName,
                Description = description,
                ProfileCount = profile != null ? 1 : 0,
                ProfileId = profile?.Id,
                ProfileEmail = profile?.Email,
                ProfileHouseholdId = profile?.HouseholdId,
                ProfilePendingCents = profile?.PendingCents ?? 0,
                ProfileTotalContainers = profile?.TotalContainers ?? 0,
                OtpCodeCount = otp != null ? 1 : 0,
                OtpUsed = otp?.Used,
                OtpAttempts = otp?.Attempts,
                ScanCount = scans.Count,
                OrphanScanCount = scans.Count(s => s.HouseholdId == null),
                AttachedScanCount = scans.Count(s => s.HouseholdId != null),
                FirstScanRefundCents = firstScan?.RefundCents,
                FirstScanStatus = firstScan?.Status,
                UsedScanTokenCount = usedTokens.Count,
                HouseholdCount = household != null ? 1 : 0,
                HouseholdId = household?.Id,
                HouseholdBinStatus = household?.BinStatus,
                HouseholdPendingContainers = household?.PendingContainers ?? 0,
                HouseholdPendingValueCents = household?.PendingValueCents ?? 0,
                BinCount = bin != null ? 1 : 0,
                BinCode = bin?.Code
            };
        });
    }

    [Fact]
    public async Task R1_FirstTimeUserJourney_FullSimulation_SucceedsWithExactInvariants()
    {
        const string email = "first.time.sorter@example.test";
        var testImageBase64 = TestImageHelper.CreateValidTestImageBase64(32, 32);
        var snapshots = new List<StepDbSnapshot>();

        // ══════════════════════════════════════════════════════════════════════
        // STEP 0: Initial State Invariant Verification (Clean Database)
        // ══════════════════════════════════════════════════════════════════════
        await _host.WithDbContextAsync(async db =>
        {
            var initialProfiles = await db.Profiles.CountAsync(p => p.Email == email);
            var initialOtps = await db.OtpCodes.CountAsync(o => o.Email == email);
            var initialScans = await db.Scans.CountAsync();
            var initialHouseholds = await db.Households.CountAsync();
            var initialUsedTokens = await db.UsedScanTokens.CountAsync();

            Assert.Equal(0, initialProfiles);
            Assert.Equal(0, initialOtps);
            Assert.Equal(0, initialScans);
            Assert.Equal(0, initialHouseholds);
            Assert.Equal(0, initialUsedTokens);
        });
        snapshots.Add(await CaptureSnapshotAsync("Step 0", "Initial Clean State (Pre-Flight)", email));

        // ══════════════════════════════════════════════════════════════════════
        // STEP 1: Anonymous Request for Email OTP (POST /api/auth/send-otp)
        // ══════════════════════════════════════════════════════════════════════
        var sendOtpRes = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        Assert.Equal(HttpStatusCode.OK, sendOtpRes.StatusCode);

        var sendOtpBody = await sendOtpRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(sendOtpBody.GetProperty("sent").GetBoolean());
        var devCode = sendOtpBody.GetProperty("devCode").GetString();
        Assert.False(string.IsNullOrWhiteSpace(devCode), "Development mode must return devCode for automated test suites.");

        // Assert DB state after Step 1
        await _host.WithDbContextAsync(async db =>
        {
            var otpRows = await db.OtpCodes.Where(o => o.Email == email).ToListAsync();
            Assert.Single(otpRows);
            var otp = otpRows[0];
            Assert.False(otp.Used, "Newly issued OTP must have Used = false.");
            Assert.Equal(0, otp.Attempts);
            Assert.True(otp.ExpiresAt > DateTime.UtcNow, "Newly issued OTP must have future expiration.");
        });
        snapshots.Add(await CaptureSnapshotAsync("Step 1", "POST /api/auth/send-otp (Code Issued)", email));

        // ══════════════════════════════════════════════════════════════════════
        // STEP 2: Verify OTP & Profile Provisioning (POST /api/auth/verify-otp)
        // ══════════════════════════════════════════════════════════════════════
        var verifyOtpRes = await _client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = devCode });
        Assert.Equal(HttpStatusCode.OK, verifyOtpRes.StatusCode);

        var verifyOtpBody = await verifyOtpRes.Content.ReadFromJsonAsync<JsonElement>();
        var token = verifyOtpBody.GetProperty("token").GetString();
        Assert.False(string.IsNullOrWhiteSpace(token), "verify-otp must return a signed 30-day JWT Bearer token.");

        var profileEl = verifyOtpBody.GetProperty("profile");
        var profileId = profileEl.GetProperty("id").GetGuid();
        Assert.NotEqual(Guid.Empty, profileId);
        Assert.Equal(JsonValueKind.Null, profileEl.GetProperty("householdId").ValueKind);
        Assert.Equal(0, profileEl.GetProperty("pendingCents").GetInt32());
        Assert.Equal(0, profileEl.GetProperty("clearedCents").GetInt32());
        Assert.Equal(0, profileEl.GetProperty("totalContainers").GetInt32());
        Assert.Equal("sorter", profileEl.GetProperty("role").GetString());

        // Authenticate the client for subsequent steps
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        // Assert DB state after Step 2
        await _host.WithDbContextAsync(async db =>
        {
            var otp = await db.OtpCodes.SingleAsync(o => o.Email == email);
            Assert.True(otp.Used, "Verified OTP must be marked Used = true.");
            Assert.Equal(1, otp.Attempts);

            var profile = await db.Profiles.SingleAsync(p => p.Id == profileId);
            Assert.Equal(email, profile.Email);
            Assert.Null(profile.HouseholdId);
            Assert.Equal(0, profile.PendingCents);
            Assert.Equal(0, profile.ClearedCents);
            Assert.Equal(0, profile.TotalContainers);
        });
        snapshots.Add(await CaptureSnapshotAsync("Step 2", "POST /api/auth/verify-otp (Profile Provisioned)", email, profileId));

        // ══════════════════════════════════════════════════════════════════════
        // STEP 3: Container Photo Analysis & Preview (POST /api/scan/photo)
        // ══════════════════════════════════════════════════════════════════════
        var scanPhotoRes = await _client.PostAsJsonAsync("/api/scan/photo", new
        {
            image = $"data:image/jpeg;base64,{testImageBase64}",
            binCode = (string?)null
        });
        Assert.Equal(HttpStatusCode.OK, scanPhotoRes.StatusCode);

        var scanPhotoBody = await scanPhotoRes.Content.ReadFromJsonAsync<JsonElement>();
        var scanToken = scanPhotoBody.GetProperty("scanToken").GetString();
        Assert.False(string.IsNullOrWhiteSpace(scanToken), "photo scan must return a signed scanToken.");
        Assert.Equal(1, scanPhotoBody.GetProperty("totalItems").GetInt32());

        // Container #1 gets 10¢ launch bonus preview (LaunchBonus.TotalCents(0, 1, 10))
        Assert.Equal(10, scanPhotoBody.GetProperty("totalCents").GetInt32());

        var containersArr = scanPhotoBody.GetProperty("containers");
        Assert.Equal(1, containersArr.GetArrayLength());
        var firstContainer = containersArr[0];
        Assert.Equal("Coca-Cola 375ml can", firstContainer.GetProperty("name").GetString());
        Assert.Equal("aluminium", firstContainer.GetProperty("material").GetString());
        Assert.True(firstContainer.GetProperty("eligible").GetBoolean());

        // Assert DB state after Step 3: Analysis does NOT write deposit scans or credit
        await _host.WithDbContextAsync(async db =>
        {
            var calls = await db.VisionCalls.Where(v => v.UserId == profileId).ToListAsync();
            Assert.Single(calls);
            Assert.Equal("tailor", calls[0].Provider);
            Assert.True(calls[0].Success);
            Assert.Equal(1, calls[0].ContainerCount);

            var scansCount = await db.Scans.CountAsync(s => s.UserId == profileId);
            Assert.Equal(0, scansCount);

            var profile = await db.Profiles.SingleAsync(p => p.Id == profileId);
            Assert.Equal(0, profile.PendingCents);
        });
        snapshots.Add(await CaptureSnapshotAsync("Step 3", "POST /api/scan/photo (Credit Previewed)", email, profileId));

        // ══════════════════════════════════════════════════════════════════════
        // STEP 4: Confirm Deposit & Orphan Scan Creation (POST /api/scan/photo/confirm)
        // ══════════════════════════════════════════════════════════════════════
        var confirmRes = await _client.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken,
            lat = -27.4812,
            lng = 153.0135
        });
        Assert.Equal(HttpStatusCode.OK, confirmRes.StatusCode);

        var confirmBody = await confirmRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, confirmBody.GetProperty("totalContainers").GetInt32());
        Assert.Equal(10, confirmBody.GetProperty("totalCents").GetInt32());
        Assert.Equal(10, confirmBody.GetProperty("pendingCents").GetInt32());

        // Assert DB state after Step 4: Single-use token recorded, orphan scan created, profile credited
        await _host.WithDbContextAsync(async db =>
        {
            // UsedScanTokens row
            var usedTokens = await db.UsedScanTokens.Where(u => u.UserId == profileId).ToListAsync();
            Assert.Single(usedTokens);

            // Orphan scan verification
            var scans = await db.Scans.Where(s => s.UserId == profileId).ToListAsync();
            Assert.Single(scans);
            var scan = scans[0];
            Assert.Null(scan.HouseholdId); // MUST BE NULL (ORPHAN SCAN)
            Assert.Equal(10, scan.RefundCents); // Launch bonus double rate
            Assert.Equal("pending", scan.Status);
            Assert.Equal("PHOTO", scan.Barcode);
            Assert.Equal("Coca-Cola 375ml can", scan.ContainerName);
            Assert.Equal("aluminium", scan.Material);
            Assert.False(string.IsNullOrWhiteSpace(scan.PhotoHash));

            // Profile ledger update
            var profile = await db.Profiles.SingleAsync(p => p.Id == profileId);
            Assert.Equal(10, profile.PendingCents);
            Assert.Equal(1, profile.TotalContainers);
            Assert.Null(profile.HouseholdId);
        });
        snapshots.Add(await CaptureSnapshotAsync("Step 4", "POST /api/scan/photo/confirm (Orphan Scan Created)", email, profileId));

        // ══════════════════════════════════════════════════════════════════════
        // STEP 5: Council Bin Day Lookup (POST /api/households/lookup-bin-day)
        // ══════════════════════════════════════════════════════════════════════
        var lookupRes = await _client.PostAsJsonAsync("/api/households/lookup-bin-day", new
        {
            lat = -27.4812,
            lng = 153.0135,
            address = "120 Vulture Street, West End QLD 4101"
        });
        Assert.Equal(HttpStatusCode.OK, lookupRes.StatusCode);

        var lookupBody = await lookupRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(lookupBody.GetProperty("found").GetBoolean());
        Assert.Equal(2, lookupBody.GetProperty("dayOfWeek").GetInt32()); // Tuesday = 2
        snapshots.Add(await CaptureSnapshotAsync("Step 5", "POST /api/households/lookup-bin-day (Read-Only)", email, profileId));

        // ══════════════════════════════════════════════════════════════════════
        // STEP 6: Household Creation & Orphan Scan Backfill (POST /api/households)
        // ══════════════════════════════════════════════════════════════════════
        var householdRes = await _client.PostAsJsonAsync("/api/households", new
        {
            name = "First Timer's Place",
            address = "120 Vulture Street, West End QLD 4101",
            suburb = "West End",
            street = "Vulture Street",
            lat = -27.4812,
            lng = 153.0135,
            type = "residential",
            councilCollectionDay = 2,
            councilArea = "Brisbane City Council",
            accessConsent = true
        });
        Assert.Equal(HttpStatusCode.Created, householdRes.StatusCode);

        var householdBody = await householdRes.Content.ReadFromJsonAsync<JsonElement>();
        var householdId = householdBody.GetProperty("id").GetGuid();
        Assert.NotEqual(Guid.Empty, householdId);
        Assert.Equal("waitlisted", householdBody.GetProperty("binStatus").GetString());
        Assert.Equal(1, householdBody.GetProperty("pendingContainers").GetInt32());
        Assert.Equal(10, householdBody.GetProperty("pendingValueCents").GetInt32());

        // Assert DB state after Step 6: CRITICAL BACKFILL INVARIANTS
        await _host.WithDbContextAsync(async db =>
        {
            // Household entity
            var household = await db.Households.SingleAsync(h => h.Id == householdId);
            Assert.Equal("WEST END", household.Suburb);
            Assert.Equal("waitlisted", household.BinStatus);
            Assert.Equal(1, household.PendingContainers);
            Assert.Equal(10, household.PendingValueCents);
            Assert.Equal(1, household.Materials.Aluminium);

            // Bins entity created for the household
            var bin = await db.Bins.SingleAsync(b => b.HouseholdId == householdId);
            Assert.StartsWith("GS-H", bin.Code);

            // Profile updated
            var profile = await db.Profiles.SingleAsync(p => p.Id == profileId);
            Assert.Equal(householdId, profile.HouseholdId);
            Assert.Equal(10, profile.PendingCents);
            Assert.Equal(1, profile.TotalContainers);

            // Scan backfill invariant: Zero orphan scans remaining!
            var orphanScansCount = await db.Scans.CountAsync(s => s.UserId == profileId && s.HouseholdId == null);
            Assert.Equal(0, orphanScansCount);

            // The scan is now attached to the household
            var scan = await db.Scans.SingleAsync(s => s.UserId == profileId);
            Assert.Equal(householdId, scan.HouseholdId);
        });
        snapshots.Add(await CaptureSnapshotAsync("Step 6", "POST /api/households (Orphan Scan Backfilled)", email, profileId, householdId));

        // ══════════════════════════════════════════════════════════════════════
        // STEP 7: Inspect Final Profile (GET /api/profiles/{id})
        // ══════════════════════════════════════════════════════════════════════
        var profileRes = await _client.GetAsync($"/api/profiles/{profileId}");
        Assert.Equal(HttpStatusCode.OK, profileRes.StatusCode);

        var finalProfileBody = await profileRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(profileId, finalProfileBody.GetProperty("id").GetGuid());
        Assert.Equal(householdId, finalProfileBody.GetProperty("householdId").GetGuid());
        Assert.Equal(10, finalProfileBody.GetProperty("pendingCents").GetInt32());
        Assert.Equal(1, finalProfileBody.GetProperty("totalContainers").GetInt32());
        snapshots.Add(await CaptureSnapshotAsync("Step 7", "GET /api/profiles/{id} (Final State)", email, profileId, householdId));

        // Verify total HTTP exchanges captured during the complete journey
        Assert.True(_captureHandler.Log.Count >= 7, $"Expected at least 7 HTTP exchanges captured, got {_captureHandler.Log.Count}");

        // ══════════════════════════════════════════════════════════════════════
        // EXPORT AUDIT ARTIFACTS
        // ══════════════════════════════════════════════════════════════════════
        const string agentWorkingDir = @"C:\tailor_OS\GoodSort\.agents\teamwork_preview_worker_m1_1";
        if (Directory.Exists(agentWorkingDir))
        {
            var networkLogsMd = ArtifactWriter.GenerateNetworkLogsMarkdown(_captureHandler.Log);
            var dbVerificationMd = ArtifactWriter.GenerateDbVerificationMarkdown(snapshots);

            await File.WriteAllTextAsync(Path.Combine(agentWorkingDir, "network_logs.md"), networkLogsMd);
            await File.WriteAllTextAsync(Path.Combine(agentWorkingDir, "db_verification.md"), dbMarkdownVerification(snapshots));
        }
    }

    private static string dbMarkdownVerification(IReadOnlyList<StepDbSnapshot> snapshots) =>
        ArtifactWriter.GenerateDbVerificationMarkdown(snapshots);

    [Fact]
    public async Task ScanToken_CannotBeRedeemedTwice_ReturnsBadRequest()
    {
        const string email = "replay.check@example.test";
        var testImageBase64 = TestImageHelper.CreateValidTestImageBase64(32, 32);

        // 1. Authenticate
        var sendOtp = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        var devCode = (await sendOtp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verifyOtp = await _client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = devCode });
        var token = (await verifyOtp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        // 2. Scan photo
        var scan = await _client.PostAsJsonAsync("/api/scan/photo", new { image = testImageBase64 });
        var scanToken = (await scan.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("scanToken").GetString();

        // 3. First confirm succeeds
        var confirm1 = await _client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken, lat = -27.4812, lng = 153.0135 });
        Assert.Equal(HttpStatusCode.OK, confirm1.StatusCode);

        // 4. Second confirm with same token MUST be rejected
        var confirm2 = await _client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken, lat = -27.4812, lng = 153.0135 });
        Assert.Equal(HttpStatusCode.BadRequest, confirm2.StatusCode);
        var err = (await confirm2.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString();
        Assert.Contains("already been added", err);

        // 5. Assert DB state has exactly 1 scan and 1 used token (no double spend)
        await _host.WithDbContextAsync(async db =>
        {
            var scans = await db.Scans.ToListAsync();
            Assert.Single(scans);
            var used = await db.UsedScanTokens.ToListAsync();
            Assert.Single(used);
        });
    }

    [Fact]
    public async Task PhotoScan_WithoutAuthToken_ReturnsUnauthorized()
    {
        var anonClient = _host.CreateDefaultClient();
        var testImageBase64 = TestImageHelper.CreateValidTestImageBase64(32, 32);

        var res = await anonClient.PostAsJsonAsync("/api/scan/photo", new { image = testImageBase64 });
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task ScanToken_ConfirmedByDifferentUser_ReturnsForbidden()
    {
        var testImageBase64 = TestImageHelper.CreateValidTestImageBase64(32, 32);

        // User 1 signs up and scans
        var send1 = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email = "user1@example.test" });
        var code1 = (await send1.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verify1 = await _client.PostAsJsonAsync("/api/auth/verify-otp", new { email = "user1@example.test", code = code1 });
        var token1 = (await verify1.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();

        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token1);
        var scan1 = await _client.PostAsJsonAsync("/api/scan/photo", new { image = testImageBase64 });
        var scanToken1 = (await scan1.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("scanToken").GetString();

        // User 2 signs up
        var user2Client = _host.CreateDefaultClient();
        var send2 = await user2Client.PostAsJsonAsync("/api/auth/send-otp", new { email = "user2@example.test" });
        var code2 = (await send2.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verify2 = await user2Client.PostAsJsonAsync("/api/auth/verify-otp", new { email = "user2@example.test", code = code2 });
        var token2 = (await verify2.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        user2Client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token2);

        // User 2 attempts to confirm User 1's scan token
        var theftAttempt = await user2Client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = scanToken1, lat = -27.4812, lng = 153.0135 });
        Assert.Equal(HttpStatusCode.Forbidden, theftAttempt.StatusCode);
    }

    private static string CreateDistinctTestImage(int stripeColumn)
    {
        using var image = new SixLabors.ImageSharp.Image<SixLabors.ImageSharp.PixelFormats.Rgba32>(32, 32);
        for (var y = 0; y < 32; y++)
        {
            for (var x = 0; x < 32; x++)
            {
                var isWhite = (x >= stripeColumn * 6 && x < stripeColumn * 6 + 4);
                image[x, y] = isWhite
                    ? new SixLabors.ImageSharp.PixelFormats.Rgba32(255, 255, 255)
                    : new SixLabors.ImageSharp.PixelFormats.Rgba32(0, 0, 0);
            }
        }
        using var ms = new MemoryStream();
        image.SaveAsJpeg(ms);
        return Convert.ToBase64String(ms.ToArray());
    }



    [Fact]
    public async Task VerifyOtp_WithIncorrectCode_ReturnsUnauthorizedAndIncrementsAttempts()
    {
        const string email = "wrong.otp@example.test";
        var sendOtpRes = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        Assert.Equal(HttpStatusCode.OK, sendOtpRes.StatusCode);

        // Minimal API endpoint returns 401 Unauthorized when OTP is invalid or expired
        var wrongVerify = await _client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = "000000" });
        Assert.Equal(HttpStatusCode.Unauthorized, wrongVerify.StatusCode);

        await _host.WithDbContextAsync(async db =>
        {
            var profileExists = await db.Profiles.AnyAsync(p => p.Email == email);
            Assert.False(profileExists, "Profile must not be created on failed OTP verification.");

            var otp = await db.OtpCodes.SingleAsync(o => o.Email == email);
            Assert.Equal(1, otp.Attempts);
            Assert.False(otp.Used);
        });
    }

    [Fact]
    public async Task VerifyOtp_WithExpiredCode_ReturnsUnauthorized()
    {
        const string email = "expired.otp@example.test";
        var sendOtpRes = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        Assert.Equal(HttpStatusCode.OK, sendOtpRes.StatusCode);
        var devCode = (await sendOtpRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();

        await _host.WithDbContextAsync(async db =>
        {
            var otp = await db.OtpCodes.SingleAsync(o => o.Email == email);
            otp.ExpiresAt = DateTime.UtcNow.AddMinutes(-5);
            await db.SaveChangesAsync();
        });

        var expiredVerify = await _client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = devCode });
        Assert.Equal(HttpStatusCode.Unauthorized, expiredVerify.StatusCode);

        await _host.WithDbContextAsync(async db =>
        {
            var profileExists = await db.Profiles.AnyAsync(p => p.Email == email);
            Assert.False(profileExists, "Profile must not be created with expired OTP.");
        });
    }

    [Fact]
    public async Task VerifyOtp_ExceedingMaxAttempts_LocksOutOtp()
    {
        const string email = "lockout.otp@example.test";
        var sendOtpRes = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        Assert.Equal(HttpStatusCode.OK, sendOtpRes.StatusCode);
        var devCode = (await sendOtpRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();

        // Send 5 incorrect attempts
        for (var i = 0; i < 5; i++)
        {
            var failRes = await _client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = "999999" });
            Assert.Equal(HttpStatusCode.Unauthorized, failRes.StatusCode);
        }

        // The 6th attempt with the CORRECT code must be rejected due to attempt limit (>5 attempts locks out and marks Used = true)
        var lockedRes = await _client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = devCode });
        Assert.Equal(HttpStatusCode.Unauthorized, lockedRes.StatusCode);

        await _host.WithDbContextAsync(async db =>
        {
            var otp = await db.OtpCodes.SingleAsync(o => o.Email == email);
            Assert.True(otp.Used, "Exceeding max attempts must mark OTP as Used (locked).");
            Assert.True(otp.Attempts >= 6);

            var profileExists = await db.Profiles.AnyAsync(p => p.Email == email);
            Assert.False(profileExists, "Profile must not be created when OTP is locked out.");
        });
    }


    [Fact]
    public async Task SendOtp_ExceedingHourlyRateLimit_ReturnsBadRequest()
    {
        const string email = "ratelimit.otp@example.test";

        // 5 successful requests
        for (var i = 0; i < 5; i++)
        {
            var res = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email });
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        }

        // 6th request within the hour must be rejected by rate limit
        var limitRes = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        Assert.Equal(HttpStatusCode.BadRequest, limitRes.StatusCode);
        var body = await limitRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("Too many requests", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task ScanToken_TamperedPayloadOrSignature_ReturnsBadRequestAndNoCreditsAwarded()
    {
        const string email = "tamper.tester@example.test";
        var testImageBase64 = TestImageHelper.CreateValidTestImageBase64(32, 32);

        var sendOtp = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        var devCode = (await sendOtp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verifyOtp = await _client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = devCode });
        var jwt = (await verifyOtp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwt);

        var scanRes = await _client.PostAsJsonAsync("/api/scan/photo", new { image = testImageBase64 });
        var genuineScanToken = (await scanRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("scanToken").GetString();

        var parts = genuineScanToken!.Split('.');
        Assert.Equal(2, parts.Length);

        // Tamper 1: modify payload
        var tamperedPayloadToken = (parts[0].StartsWith("A") ? "B" + parts[0][1..] : "A" + parts[0][1..]) + "." + parts[1];
        var res1 = await _client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tamperedPayloadToken, lat = -27.4812, lng = 153.0135 });
        Assert.Equal(HttpStatusCode.BadRequest, res1.StatusCode);

        // Tamper 2: modify signature
        var tamperedSigToken = $"{parts[0]}.tamperedsignature1234567890";
        var res2 = await _client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tamperedSigToken, lat = -27.4812, lng = 153.0135 });
        Assert.Equal(HttpStatusCode.BadRequest, res2.StatusCode);

        // Tamper 3: completely bogus token
        var res3 = await _client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = "totally.fraudulent.token", lat = -27.4812, lng = 153.0135 });
        Assert.Equal(HttpStatusCode.BadRequest, res3.StatusCode);

        // In DB: no scans, no used tokens, no pending credits
        await _host.WithDbContextAsync(async db =>
        {
            var profile = await db.Profiles.SingleAsync(p => p.Email == email);
            Assert.Equal(0, profile.PendingCents);
            Assert.Equal(0, profile.TotalContainers);
            Assert.Equal(0, await db.Scans.CountAsync(s => s.UserId == profile.Id));
            Assert.Equal(0, await db.UsedScanTokens.CountAsync(u => u.UserId == profile.Id));
        });
    }

    [Fact]
    public async Task ScanToken_Expired_ReturnsBadRequest()
    {
        const string email = "expired.token@example.test";
        var sendOtp = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        var devCode = (await sendOtp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verifyOtp = await _client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = devCode });
        var verifyBody = await verifyOtp.Content.ReadFromJsonAsync<JsonElement>();
        var jwt = verifyBody.GetProperty("token").GetString();
        var profileId = verifyBody.GetProperty("profile").GetProperty("id").GetGuid();
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwt);

        var tokenService = _host.Services.GetRequiredService<ScanTokenService>();
        var expiredToken = tokenService.Issue(new ScanTokenPayload
        {
            Uid = profileId,
            Items = [new ScanTokenItem { Name = "Expired Can", Material = "aluminium", Count = 1, Eligible = true }]
        }, TimeSpan.FromMinutes(-5));

        var confirmRes = await _client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = expiredToken, lat = -27.4812, lng = 153.0135 });
        Assert.Equal(HttpStatusCode.BadRequest, confirmRes.StatusCode);
        var errBody = await confirmRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("expired", errBody.GetProperty("error").GetString(), StringComparison.OrdinalIgnoreCase);

        await _host.WithDbContextAsync(async db =>
        {
            var scans = await db.Scans.Where(s => s.UserId == profileId).ToListAsync();
            Assert.Empty(scans);
        });
    }

    [Fact]
    public async Task ScanToken_ConcurrentRedemption_AllowsExactlyOneSuccess()
    {
        const string email = "concurrent.redemption@example.test";
        var testImageBase64 = TestImageHelper.CreateValidTestImageBase64(32, 32);

        var sendOtp = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        var devCode = (await sendOtp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verifyOtp = await _client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = devCode });
        var verifyBody = await verifyOtp.Content.ReadFromJsonAsync<JsonElement>();
        var jwt = verifyBody.GetProperty("token").GetString();
        var profileId = verifyBody.GetProperty("profile").GetProperty("id").GetGuid();
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwt);

        var scanRes = await _client.PostAsJsonAsync("/api/scan/photo", new { image = testImageBase64 });
        var scanToken = (await scanRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("scanToken").GetString();

        var task1 = _client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken, lat = -27.4812, lng = 153.0135 });
        var task2 = _client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken, lat = -27.4812, lng = 153.0135 });

        var responses = await Task.WhenAll(task1, task2);
        var statusCodes = responses.Select(r => r.StatusCode).ToList();

        Assert.Contains(HttpStatusCode.OK, statusCodes);
        Assert.Contains(HttpStatusCode.BadRequest, statusCodes);

        await _host.WithDbContextAsync(async db =>
        {
            var scans = await db.Scans.Where(s => s.UserId == profileId).ToListAsync();
            Assert.Single(scans);

            var usedTokens = await db.UsedScanTokens.Where(u => u.UserId == profileId).ToListAsync();
            Assert.Single(usedTokens);

            var profile = await db.Profiles.SingleAsync(p => p.Id == profileId);
            Assert.Equal(10, profile.PendingCents);
            Assert.Equal(1, profile.TotalContainers);
        });
    }

    [Fact]
    public async Task PhotoScan_IdenticalPhotoReplay_ReturnsBadRequestDueToPerceptualHash()
    {
        const string email = "replay.hash@example.test";
        var testImageBase64 = CreateDistinctTestImage(1);

        var sendOtp = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        var devCode = (await sendOtp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verifyOtp = await _client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = devCode });
        var jwt = (await verifyOtp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwt);

        // 1. First scan with image
        var scan1 = await _client.PostAsJsonAsync("/api/scan/photo", new { image = testImageBase64 });
        var st1 = (await scan1.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("scanToken").GetString();
        var confirm1 = await _client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = st1, lat = -27.4812, lng = 153.0135 });
        Assert.Equal(HttpStatusCode.OK, confirm1.StatusCode);

        // 2. Second scan with IDENTICAL image from same depositor generates a new scanToken, but confirm must reject it
        var scan2 = await _client.PostAsJsonAsync("/api/scan/photo", new { image = testImageBase64 });
        var st2 = (await scan2.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("scanToken").GetString();
        var confirm2 = await _client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = st2, lat = -27.4812, lng = 153.0135 });
        Assert.Equal(HttpStatusCode.BadRequest, confirm2.StatusCode);
        var errBody = await confirm2.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("already deposited", errBody.GetProperty("error").GetString());

        // 3. Third scan with a DISTINCT image succeeds cleanly
        var distinctImage = CreateDistinctTestImage(2);
        var scan3 = await _client.PostAsJsonAsync("/api/scan/photo", new { image = distinctImage });
        var st3 = (await scan3.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("scanToken").GetString();
        var confirm3 = await _client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = st3, lat = -27.4812, lng = 153.0135 });
        Assert.Equal(HttpStatusCode.OK, confirm3.StatusCode);
    }

    [Fact]
    public async Task OrphanScanBackfill_MultipleScansAndUserIsolation_StrictlyEliminatesOnlyUserOrphans()
    {
        // User A setup
        var sendA = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email = "userA@example.test" });
        var codeA = (await sendA.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verifyA = await _client.PostAsJsonAsync("/api/auth/verify-otp", new { email = "userA@example.test", code = codeA });
        var bodyA = await verifyA.Content.ReadFromJsonAsync<JsonElement>();
        var tokenA = bodyA.GetProperty("token").GetString();
        var userAId = bodyA.GetProperty("profile").GetProperty("id").GetGuid();

        // User B setup
        var clientB = _host.CreateCapturedClient(new NetworkCaptureHandler());
        var sendB = await clientB.PostAsJsonAsync("/api/auth/send-otp", new { email = "userB@example.test" });
        var codeB = (await sendB.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verifyB = await clientB.PostAsJsonAsync("/api/auth/verify-otp", new { email = "userB@example.test", code = codeB });
        var bodyB = await verifyB.Content.ReadFromJsonAsync<JsonElement>();
        var tokenB = bodyB.GetProperty("token").GetString();
        var userBId = bodyB.GetProperty("profile").GetProperty("id").GetGuid();
        clientB.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenB);

        // User A performs 2 scans with distinct images (modes 1 and 2)
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenA);
        for (var i = 1; i <= 2; i++)
        {
            var img = CreateDistinctTestImage(i);
            var scan = await _client.PostAsJsonAsync("/api/scan/photo", new { image = img });
            var st = (await scan.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("scanToken").GetString();
            var confirm = await _client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = st, lat = -27.4812, lng = 153.0135 });
            Assert.Equal(HttpStatusCode.OK, confirm.StatusCode);
        }

        // User B performs 1 scan with distinct image (mode 3)
        var imgB = CreateDistinctTestImage(3);
        var scanB = await clientB.PostAsJsonAsync("/api/scan/photo", new { image = imgB });
        var stB = (await scanB.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("scanToken").GetString();
        var confirmB = await clientB.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = stB, lat = -27.4812, lng = 153.0135 });
        Assert.Equal(HttpStatusCode.OK, confirmB.StatusCode);

        // Verify pre-condition: User A has 2 orphans, User B has 1 orphan
        await _host.WithDbContextAsync(async db =>
        {
            var orphansA = await db.Scans.CountAsync(s => s.UserId == userAId && s.HouseholdId == null);
            var orphansB = await db.Scans.CountAsync(s => s.UserId == userBId && s.HouseholdId == null);
            Assert.Equal(2, orphansA);
            Assert.Equal(1, orphansB);
        });

        // User A creates household
        var hhRes = await _client.PostAsJsonAsync("/api/households", new
        {
            name = "User A Household",
            address = "10 Annerley Rd, Woolloongabba QLD 4102",
            suburb = "Woolloongabba",
            street = "Annerley Rd",
            lat = -27.4850,
            lng = 153.0280,
            type = "residential",
            councilCollectionDay = 3,
            councilArea = "Brisbane City Council",
            accessConsent = true
        });
        Assert.Equal(HttpStatusCode.Created, hhRes.StatusCode);
        var hhBody = await hhRes.Content.ReadFromJsonAsync<JsonElement>();
        var householdAId = hhBody.GetProperty("id").GetGuid();

        // Invariants check:
        await _host.WithDbContextAsync(async db =>
        {
            // 1. User A orphans strictly eliminated: 0 orphans remaining for User A
            var remainingOrphansA = await db.Scans.CountAsync(s => s.UserId == userAId && s.HouseholdId == null);
            Assert.Equal(0, remainingOrphansA);

            // 2. User A scans attached to Household A
            var attachedA = await db.Scans.CountAsync(s => s.UserId == userAId && s.HouseholdId == householdAId);
            Assert.Equal(2, attachedA);

            // 3. User B orphan is completely UNTOUCHED (user isolation preserved)
            var remainingOrphansB = await db.Scans.CountAsync(s => s.UserId == userBId && s.HouseholdId == null);
            Assert.Equal(1, remainingOrphansB);

            // 4. Household A metrics
            var hh = await db.Households.SingleAsync(h => h.Id == householdAId);
            Assert.Equal(2, hh.PendingContainers);
            Assert.Equal(20, hh.PendingValueCents);
        });

        // 5. Subsequent scan by User A immediately attaches to Household A (mode 4)
        var imgPostHh = CreateDistinctTestImage(4);
        var scanPostHh = await _client.PostAsJsonAsync("/api/scan/photo", new { image = imgPostHh });
        var stPostHh = (await scanPostHh.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("scanToken").GetString();
        var confirmPostHh = await _client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = stPostHh, lat = -27.4812, lng = 153.0135 });
        Assert.Equal(HttpStatusCode.OK, confirmPostHh.StatusCode);

        await _host.WithDbContextAsync(async db =>
        {
            var finalOrphansA = await db.Scans.CountAsync(s => s.UserId == userAId && s.HouseholdId == null);
            Assert.Equal(0, finalOrphansA);

            var totalScansA = await db.Scans.CountAsync(s => s.UserId == userAId && s.HouseholdId == householdAId);
            Assert.Equal(3, totalScansA);
        });

        clientB.Dispose();
    }



    [Fact]
    public async Task BackfillBin_UncommittedChangeTracker_DefectEsc01_VerifiedEmpirically()
    {
        var testImageBase64 = TestImageHelper.CreateValidTestImageBase64(32, 32);

        // Sign up and confirm 1 orphan scan
        var sendOtp = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email = "esc01.check@example.test" });
        var devCode = (await sendOtp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verifyOtp = await _client.PostAsJsonAsync("/api/auth/verify-otp", new { email = "esc01.check@example.test", code = devCode });
        var jwt = (await verifyOtp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwt);

        var scanRes = await _client.PostAsJsonAsync("/api/scan/photo", new { image = testImageBase64 });
        var scanToken = (await scanRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("scanToken").GetString();
        var confirmRes = await _client.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken, lat = -27.4812, lng = 153.0135 });
        Assert.Equal(HttpStatusCode.OK, confirmRes.StatusCode);

        // Register household
        var hhRes = await _client.PostAsJsonAsync("/api/households", new
        {
            name = "ESC01 Household",
            address = "50 Grey St, South Brisbane QLD 4101",
            suburb = "South Brisbane",
            street = "Grey St",
            lat = -27.4760,
            lng = 153.0180,
            type = "residential",
            councilCollectionDay = 4,
            councilArea = "Brisbane City Council",
            accessConsent = true
        });
        Assert.Equal(HttpStatusCode.Created, hhRes.StatusCode);
        var householdId = (await hhRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        // Verify Defect ESC-01 is resolved:
        // Both Household entity and placeholder bin.PendingContainers reflect the 1 backfilled container.
        await _host.WithDbContextAsync(async db =>
        {
            var hh = await db.Households.SingleAsync(h => h.Id == householdId);
            Assert.Equal(1, hh.PendingContainers);

            var bin = await db.Bins.SingleAsync(b => b.HouseholdId == householdId);
            Assert.Equal(1, bin.PendingContainers);
        });
    }

    /// <summary>
    /// Helper exposing captured network exchanges for audit reporting.
    /// </summary>
    public IReadOnlyList<NetworkExchange> GetCapturedNetworkLogs() => _captureHandler.Log;
}

