using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using GoodSort.Api.Tests.Simulations.Harness;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace GoodSort.Api.Tests.Simulations;

/// <summary>
/// Milestone 2: Automated Integration Test Suite for the R2 Existing User Journey
/// (Authenticated Re-Entry, OTP Bypass, Direct Household Attribution, Balance Refresh, Credential Expiry).
///
/// Persona: Liam (Returning Power Sorter)
/// - Has an established account and residential household in Moorooka.
/// - Returns to /sort and transitions to /scan.
/// - Session detected via valid 30-day JWT; OTP screen bypassed completely.
/// - Submits photo scan; deposit is directly attributed to existing household (0 orphan scans).
/// - Accumulates multi-batch scans, updates Profile.PendingCents and Household.PendingContainers.
/// - Returns cleanly to /sort dashboard; verifies refreshed ledger balance.
/// - Audits expired credentials, 401 handling, and the client-side retake loop defect.
/// </summary>
public class R2ExistingUserJourneySimulationTests : IDisposable
{
    private readonly JourneySimulationHost _host;
    private readonly NetworkCaptureHandler _captureHandler;
    private readonly HttpClient _client;
    private const string MoorookaAddress = "25 Hamilton Rd, Moorooka QLD 4105";
    private const double MoorookaLat = -27.5333;
    private const double MoorookaLng = 153.0167;
    private const string TestJwtSecret = "test-only-signing-key-not-a-real-secret-0123456789";

    public R2ExistingUserJourneySimulationTests()
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

    private string CreateJwt(Guid userId, string email, string name, DateTime? expires = null, string? secret = null)
    {
        var key = secret ?? TestJwtSecret;
        var securityKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key));
        var credentials = new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new("email", email),
            new("name", name),
            new("role", "sorter"),
        };

        var token = new JwtSecurityToken(
            issuer: "goodsort-api",
            audience: "goodsort-app",
            claims: claims,
            expires: expires ?? DateTime.UtcNow.AddDays(30),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private string MintScanToken(
        Guid userId,
        List<ScanTokenItem>? items = null,
        string? binCode = null,
        double? binLat = null,
        double? binLng = null,
        string? photoHash = null,
        TimeSpan? ttl = null)
    {
        var tokens = _host.Services.GetRequiredService<ScanTokenService>();
        var payload = new ScanTokenPayload
        {
            Uid = userId,
            Items = items ?? [new ScanTokenItem { Name = "Coca-Cola 375ml Can", Material = "aluminium", Count = 1, Eligible = true }],
            BinCode = binCode,
            BinLat = binLat,
            BinLng = binLng,
            PhotoHash = photoHash,
        };
        return tokens.Issue(payload, ttl ?? TimeSpan.FromMinutes(10));
    }

    private static string CreateDistinctTestImage(int stripeColumn)
    {
        using var image = new Image<Rgba32>(32, 32);
        for (var y = 0; y < 32; y++)
        {
            for (var x = 0; x < 32; x++)
            {
                var isWhite = (x >= stripeColumn * 6 && x < stripeColumn * 6 + 4);
                image[x, y] = isWhite
                    ? new Rgba32(255, 255, 255)
                    : new Rgba32(0, 0, 0);
            }
        }
        using var ms = new MemoryStream();
        image.SaveAsJpeg(ms);
        return Convert.ToBase64String(ms.ToArray());
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
    public async Task R2_ExistingUser_ReEntry_OTP_Bypass_DirectHouseholdAttribution_And_BalanceRefresh()
    {
        const string email = "liam.power@example.test";
        var snapshots = new List<StepDbSnapshot>();

        // ══════════════════════════════════════════════════════════════════════
        // STEP 0: Initial Setup — Establish Existing Account & Household
        // ══════════════════════════════════════════════════════════════════════
        var sendOtpRes = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        Assert.Equal(HttpStatusCode.OK, sendOtpRes.StatusCode);
        var devCode = (await sendOtpRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString()!;

        var verifyRes = await _client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = devCode });
        Assert.Equal(HttpStatusCode.OK, verifyRes.StatusCode);
        var verifyJson = await verifyRes.Content.ReadFromJsonAsync<JsonElement>();
        var token = verifyJson.GetProperty("token").GetString()!;
        var profileId = verifyJson.GetProperty("profile").GetProperty("id").GetGuid();

        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        // Register household
        var hhCreateRes = await _client.PostAsJsonAsync("/api/households", new
        {
            name = "Liam's Residence",
            address = MoorookaAddress,
            suburb = "MOOROOKA",
            street = "Hamilton Rd",
            lat = MoorookaLat,
            lng = MoorookaLng,
            type = "residential",
            councilCollectionDay = 2,
            councilArea = "Brisbane City Council",
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hhCreateRes.StatusCode);
        var hhJson = await hhCreateRes.Content.ReadFromJsonAsync<JsonElement>();
        var householdId = hhJson.GetProperty("id").GetGuid();

        snapshots.Add(await CaptureSnapshotAsync("Step 0", "Account Established with Linked Household", email, profileId, householdId));

        // Invariant: Profile is linked to Household; total containers = 0, pending cents = 0
        await _host.WithDbContextAsync(async db =>
        {
            var p = await db.Profiles.FindAsync(profileId);
            Assert.NotNull(p);
            Assert.Equal(householdId, p.HouseholdId);
            Assert.Equal(0, p.TotalContainers);
            Assert.Equal(0, p.PendingCents);
        });

        // ══════════════════════════════════════════════════════════════════════
        // STEP 1: Re-Entry Simulation — Returning to /sort with Active JWT
        // ══════════════════════════════════════════════════════════════════════
        // Client returns to dashboard: checks profile and household status
        var profRes = await _client.GetAsync($"/api/profiles/{profileId}");
        Assert.Equal(HttpStatusCode.OK, profRes.StatusCode);
        var profJson = await profRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(profileId, profJson.GetProperty("id").GetGuid());
        Assert.Equal(householdId, profJson.GetProperty("householdId").GetGuid());

        var hhGetRes = await _client.GetAsync($"/api/households/{householdId}");
        Assert.Equal(HttpStatusCode.OK, hhGetRes.StatusCode);
        var hhGetJson = await hhGetRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, hhGetJson.GetProperty("pendingContainers").GetInt32());

        snapshots.Add(await CaptureSnapshotAsync("Step 1", "Re-Entry to /sort Dashboard (Active Session)", email, profileId, householdId));

        // ══════════════════════════════════════════════════════════════════════
        // STEP 2: Navigate to /scan — Session Detected, OTP Bypassed Completely
        // ══════════════════════════════════════════════════════════════════════
        // Verify that client hasValidToken() == true bypasses OTP entirely:
        // ZERO calls to /api/auth/send-otp or /api/auth/verify-otp are dispatched.
        var exchangesBeforeScan = _captureHandler.Log.Count;

        // Directly post photo to /api/scan/photo
        var photo1Base64 = CreateDistinctTestImage(1);
        var photoRes1 = await _client.PostAsJsonAsync("/api/scan/photo", new { image = photo1Base64 });
        Assert.Equal(HttpStatusCode.OK, photoRes1.StatusCode);
        var photoJson1 = await photoRes1.Content.ReadFromJsonAsync<JsonElement>();
        var scanToken1 = photoJson1.GetProperty("scanToken").GetString()!;
        Assert.False(string.IsNullOrEmpty(scanToken1));

        // Verify zero OTP requests happened during this transition
        var otpRequestsDuringScan = _captureHandler.Log
            .Skip(exchangesBeforeScan)
            .Count(ex => ex.Path.Contains("/api/auth/"));
        Assert.Equal(0, otpRequestsDuringScan);

        snapshots.Add(await CaptureSnapshotAsync("Step 2", "Photo Analysis with OTP Bypassed (Token Issued)", email, profileId, householdId));

        // ══════════════════════════════════════════════════════════════════════
        // STEP 3: Confirm First Deposit — Direct Household Attribution
        // ══════════════════════════════════════════════════════════════════════
        var confirmRes1 = await _client.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = scanToken1,
            lat = MoorookaLat,
            lng = MoorookaLng
        });
        Assert.Equal(HttpStatusCode.OK, confirmRes1.StatusCode);
        var confirmJson1 = await confirmRes1.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(10, confirmJson1.GetProperty("totalCents").GetInt32());
        Assert.True(confirmJson1.GetProperty("bonusApplied").GetBoolean());

        snapshots.Add(await CaptureSnapshotAsync("Step 3", "First Deposit Confirmed (Direct Household Attribution)", email, profileId, householdId));

        // Assert Direct Attribution Invariants:
        await _host.WithDbContextAsync(async db =>
        {
            // Zero orphan scans created!
            var orphanCount = await db.Scans.CountAsync(s => s.UserId == profileId && s.HouseholdId == null);
            Assert.Equal(0, orphanCount);

            // Exactly 1 scan created, attached directly to HouseholdId
            var attachedScans = await db.Scans.Where(s => s.UserId == profileId && s.HouseholdId == householdId).ToListAsync();
            Assert.Single(attachedScans);
            Assert.Equal(10, attachedScans[0].RefundCents);
            Assert.Equal("aluminium", attachedScans[0].Material);

            // Profile pending cents and total containers updated
            var prof = await db.Profiles.FindAsync(profileId);
            Assert.NotNull(prof);
            Assert.Equal(10, prof.PendingCents);
            Assert.Equal(1, prof.TotalContainers);

            // Household pending counters updated
            var hh = await db.Households.FindAsync(householdId);
            Assert.NotNull(hh);
            Assert.Equal(1, hh.PendingContainers);
            Assert.Equal(10, hh.PendingValueCents);
            Assert.Equal(1, hh.Materials.Aluminium);

            // Placeholder bin counter updated via BinCounter
            var bin = await db.Bins.FirstOrDefaultAsync(b => b.HouseholdId == householdId);
            Assert.NotNull(bin);
            Assert.Equal(1, bin.PendingContainers);
        });

        // ══════════════════════════════════════════════════════════════════════
        // STEP 4: Multi-Batch Scan Continuation (3 items in batch 2)
        // ══════════════════════════════════════════════════════════════════════
        var batchItems = new List<ScanTokenItem>
        {
            new() { Name = "Solo Can", Material = "aluminium", Count = 2, Eligible = true },
            new() { Name = "Cascade Stubby", Material = "glass", Count = 1, Eligible = true }
        };
        var scanToken2 = MintScanToken(profileId, items: batchItems);

        var confirmRes2 = await _client.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = scanToken2,
            lat = MoorookaLat,
            lng = MoorookaLng
        });
        Assert.Equal(HttpStatusCode.OK, confirmRes2.StatusCode);

        snapshots.Add(await CaptureSnapshotAsync("Step 4", "Second Batch Deposit Confirmed (Multi-Item)", email, profileId, householdId));

        // Cumulative Invariant Verification:
        await _host.WithDbContextAsync(async db =>
        {
            // Still zero orphan scans
            var orphanCount = await db.Scans.CountAsync(s => s.UserId == profileId && s.HouseholdId == null);
            Assert.Equal(0, orphanCount);

            // Total 4 container scans attached to household (1 from scan1 + 3 from scan2)
            var totalScans = await db.Scans.CountAsync(s => s.UserId == profileId && s.HouseholdId == householdId);
            Assert.Equal(4, totalScans);

            // Material streams tracked accurately
            var hh = await db.Households.FindAsync(householdId);
            Assert.NotNull(hh);
            Assert.Equal(4, hh.PendingContainers);
            Assert.Equal(40, hh.PendingValueCents);
            Assert.Equal(3, hh.Materials.Aluminium);
            Assert.Equal(1, hh.Materials.Glass);

            // Profile metrics accumulated
            var prof = await db.Profiles.FindAsync(profileId);
            Assert.NotNull(prof);
            Assert.Equal(4, prof.TotalContainers);
            Assert.Equal(40, prof.PendingCents);
        });

        // ══════════════════════════════════════════════════════════════════════
        // STEP 5: Return to /sort — Balance Refresh Verification
        // ══════════════════════════════════════════════════════════════════════
        var finalProfRes = await _client.GetAsync($"/api/profiles/{profileId}");
        Assert.Equal(HttpStatusCode.OK, finalProfRes.StatusCode);
        var finalProf = await finalProfRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(4, finalProf.GetProperty("totalContainers").GetInt32());
        Assert.Equal(40, finalProf.GetProperty("pendingCents").GetInt32());

        var finalHhRes = await _client.GetAsync($"/api/households/{householdId}");
        Assert.Equal(HttpStatusCode.OK, finalHhRes.StatusCode);
        var finalHh = await finalHhRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(4, finalHh.GetProperty("pendingContainers").GetInt32());
        Assert.Equal(40, finalHh.GetProperty("pendingValueCents").GetInt32());

        snapshots.Add(await CaptureSnapshotAsync("Step 5", "Final Dashboard Refresh at /sort (Balance Verified)", email, profileId, householdId));
    }

    [Fact]
    public async Task R2_ExpiredCredentials_PastExpiryJwt_RejectedByServerWith401()
    {
        var testUserId = Guid.NewGuid();
        var expiredJwt = CreateJwt(testUserId, "expired.user@example.test", "Expired User", expires: DateTime.UtcNow.AddHours(-2));

        var expiredClient = _host.CreateClient();
        expiredClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", expiredJwt);

        // 1. Calling /api/scan/photo with expired token -> 401
        var photoRes = await expiredClient.PostAsJsonAsync("/api/scan/photo", new { image = CreateDistinctTestImage(1) });
        Assert.Equal(HttpStatusCode.Unauthorized, photoRes.StatusCode);

        // 2. Calling /api/scan/photo/confirm with expired token -> 401
        var confirmRes = await expiredClient.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = "dummy.token" });
        Assert.Equal(HttpStatusCode.Unauthorized, confirmRes.StatusCode);

        // 3. Calling /api/profiles/{id} with expired token -> 401
        var profRes = await expiredClient.GetAsync($"/api/profiles/{testUserId}");
        Assert.Equal(HttpStatusCode.Unauthorized, profRes.StatusCode);

        // 4. Calling /api/scans with expired token -> 401
        var scanRes = await expiredClient.PostAsJsonAsync("/api/scans", new
        {
            barcode = "9300675024235",
            containerName = "Can",
            material = "aluminium"
        });
        Assert.Equal(HttpStatusCode.Unauthorized, scanRes.StatusCode);

        // Zero mutations occurred
        await _host.WithDbContextAsync(async db =>
        {
            Assert.Equal(0, await db.Scans.CountAsync(s => s.UserId == testUserId));
            Assert.Equal(0, await db.UsedScanTokens.CountAsync(u => u.UserId == testUserId));
        });
    }

    [Fact]
    public async Task R2_Server401_RetakeLoop_UXFrictionAudit()
    {
        // Audit test: When the server returns 401 for an apparently valid token format
        // (e.g. signed with a different secret or revoked on the server),
        // verify that the API properly returns 401, and document the client-side retake loop defect.
        var foreignSecretJwt = CreateJwt(
            Guid.NewGuid(),
            "tampered.session@example.test",
            "Tampered User",
            expires: DateTime.UtcNow.AddDays(1),
            secret: "foreign-untrusted-secret-key-99999999999999999999999999");

        var badClient = _host.CreateClient();
        badClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", foreignSecretJwt);

        // Server responds 401 Unauthorized
        var photoRes = await badClient.PostAsJsonAsync("/api/scan/photo", new { image = CreateDistinctTestImage(1) });
        Assert.Equal(HttpStatusCode.Unauthorized, photoRes.StatusCode);

        // Client analysis:
        // In app/scan/page.tsx line 320-332:
        //   const res = await fetch(apiUrl("/api/scan/photo"), ...);
        //   if (!res.ok) { setApiStatus(res.status); throw new Error("API error"); }
        //   catch { setResults([]); setApiError(true); } setStep("results");
        // scanErrorMessage(401) says: "Your session expired. Sign in again and re-take the photo."
        // BUG: app/scan/page.tsx does NOT call clearAuth().
        // When user taps "Retake", step is set back to "camera".
        // Taking a new photo checks hasValidToken(), which reads localStorage.
        // Because clearAuth() was never called, hasValidToken() returns true!
        // The client repeatedly sends the bad token to /api/scan/photo and gets 401 indefinitely.
    }

    [Fact]
    public async Task R2_AnonymousAccess_ProtectedEndpoints_EnforceAuthGuard()
    {
        var anonClient = _host.CreateClient();

        // 1. /api/scan/photo -> 401
        var photoRes = await anonClient.PostAsJsonAsync("/api/scan/photo", new { image = CreateDistinctTestImage(1) });
        Assert.Equal(HttpStatusCode.Unauthorized, photoRes.StatusCode);

        // 2. /api/scan/photo/confirm -> 401
        var confirmRes = await anonClient.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = "dummy" });
        Assert.Equal(HttpStatusCode.Unauthorized, confirmRes.StatusCode);

        // 3. /api/profiles/{id} -> 401
        var profRes = await anonClient.GetAsync($"/api/profiles/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.Unauthorized, profRes.StatusCode);

        // 4. Spoofed userId in JSON body is strictly rejected
        var spoofRes = await anonClient.PostAsJsonAsync("/api/scans", new
        {
            userId = Guid.NewGuid(),
            barcode = "9300675024235",
            containerName = "Can",
            material = "aluminium"
        });
        Assert.Equal(HttpStatusCode.Unauthorized, spoofRes.StatusCode);
    }

    [Fact]
    public async Task R2_MalformedOrTamperedJwt_Returns401()
    {
        var client = _host.CreateClient();

        // Malformed scheme
        client.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", "NotBearer someToken");
        var res1 = await client.GetAsync($"/api/profiles/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.Unauthorized, res1.StatusCode);

        // Tampered signature
        var validJwt = CreateJwt(Guid.NewGuid(), "test@example.test", "Test User");
        var tamperedJwt = validJwt + "tamperedSignature123";
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tamperedJwt);
        var res2 = await client.GetAsync($"/api/profiles/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.Unauthorized, res2.StatusCode);
    }

    public IReadOnlyList<NetworkExchange> GetCapturedNetworkLogs() => _captureHandler.Log;
}
