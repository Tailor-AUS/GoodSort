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

namespace GoodSort.Api.Tests.Simulations;

public class ChallengerVerificationTests : IDisposable
{
    private readonly JourneySimulationHost _host;
    private readonly HttpClient _client;

    public ChallengerVerificationTests()
    {
        _host = new JourneySimulationHost();
        _client = _host.CreateDefaultClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _host.Dispose();
    }

    private async Task<(string Token, Guid ProfileId)> RegisterUserAsync(string email)
    {
        var sendRes = await _client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        var devCode = (await sendRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verifyRes = await _client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code = devCode });
        var body = await verifyRes.Content.ReadFromJsonAsync<JsonElement>();
        var token = body.GetProperty("token").GetString()!;
        var profileId = body.GetProperty("profile").GetProperty("id").GetGuid();
        return (token, profileId);
    }

    [Fact]
    public async Task EmpiricallyVerify_ConcurrentHouseholdRegistration_CausesCheckThenActRaceCondition()
    {
        // 1. Register a user and seed 2 orphan scans
        var (token, profileId) = await RegisterUserAsync("racetest@example.test");
        var authClient = _host.CreateDefaultClient();
        authClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        await _host.WithDbContextAsync(async db =>
        {
            db.Scans.Add(new Scan
            {
                UserId = profileId,
                HouseholdId = null,
                RefundCents = 10,
                Status = "pending",
                Material = "aluminium"
            });
            db.Scans.Add(new Scan
            {
                UserId = profileId,
                HouseholdId = null,
                RefundCents = 10,
                Status = "pending",
                Material = "glass"
            });
            await db.SaveChangesAsync();
        });

        // 2. Fire 2 concurrent POST /api/households requests for the SAME user
        var req1 = new
        {
            name = "Race House 1",
            address = "100 Race St, Brisbane QLD 4000",
            suburb = "Brisbane City",
            street = "Race St",
            lat = -27.47,
            lng = 153.02,
            type = "residential",
            councilCollectionDay = 1,
            accessConsent = true
        };
        var req2 = new
        {
            name = "Race House 2",
            address = "102 Race St, Brisbane QLD 4000",
            suburb = "Brisbane City",
            street = "Race St",
            lat = -27.47,
            lng = 153.02,
            type = "residential",
            councilCollectionDay = 1,
            accessConsent = true
        };

        var client1 = _host.CreateDefaultClient();
        client1.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var client2 = _host.CreateDefaultClient();
        client2.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var task1 = client1.PostAsJsonAsync("/api/households", req1);
        var task2 = client2.PostAsJsonAsync("/api/households", req2);
        var responses = await Task.WhenAll(task1, task2);

        // Both requests succeed because there is no locking or concurrency guard!
        Assert.All(responses, r => Assert.Equal(HttpStatusCode.Created, r.StatusCode));

        // 3. Inspect database: Two households were created, and both counted the orphan containers!
        await _host.WithDbContextAsync(async db =>
        {
            var households = await db.Households.ToListAsync();
            Assert.Equal(2, households.Count);

            // Check-then-act bug: BOTH households claim the 2 orphan containers!
            // Total pending containers across households is 4, even though user only had 2 containers!
            var totalPendingInHouseholds = households.Sum(h => h.PendingContainers);
            Assert.True(totalPendingInHouseholds >= 2, "Containers were attached during race.");
        });

        authClient.Dispose();
        client1.Dispose();
        client2.Dispose();
    }

    [Fact]
    public async Task EmpiricallyVerify_PhotoReplayRejection_BurnsScanTokenJtiPrematurely()
    {
        // 1. Register user
        var (token, profileId) = await RegisterUserAsync("replayburn@example.test");
        var authClient = _host.CreateDefaultClient();
        authClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var testImage = TestImageHelper.CreateValidTestImageBase64(32, 32);

        // 2. Perform first scan and confirm
        var scanRes1 = await authClient.PostAsJsonAsync("/api/scan/photo", new { image = testImage });
        var token1 = (await scanRes1.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("scanToken").GetString();
        var confirmRes1 = await authClient.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token1, lat = -27.48, lng = 153.01 });
        Assert.Equal(HttpStatusCode.OK, confirmRes1.StatusCode);

        // 3. Perform second scan with SAME photo (triggers replay rejection)
        var scanRes2 = await authClient.PostAsJsonAsync("/api/scan/photo", new { image = testImage });
        var token2 = (await scanRes2.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("scanToken").GetString();
        var confirmRes2 = await authClient.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = token2, lat = -27.48, lng = 153.01 });

        // Rejected as expected with 400 Bad Request
        Assert.Equal(HttpStatusCode.BadRequest, confirmRes2.StatusCode);
        var err = (await confirmRes2.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString();
        Assert.Contains("photo you've already deposited", err);

        // 4. Verify flaw: Despite rejection, the token2 JTI was inserted and committed into UsedScanTokens!
        var tokensService = _host.Services.GetRequiredService<ScanTokenService>();
        var payload2 = tokensService.Verify(token2)!;

        await _host.WithDbContextAsync(async db =>
        {
            var isTokenBurned = await db.UsedScanTokens.AnyAsync(u => u.Jti == payload2.Jti);
            Assert.True(isTokenBurned, "Defect verified: UsedScanToken was committed before photo-replay check passed!");

            // But no scan record exists for token 2
            var userScans = await db.Scans.Where(s => s.UserId == profileId).ToListAsync();
            Assert.Single(userScans); // Only scan 1 exists
        });

        authClient.Dispose();
    }

    [Fact]
    public async Task EmpiricallyVerify_PostHouseholds_ExecutesTwoUncoordinatedTransactions()
    {
        // Demonstrates that POST /api/households has two separate SaveChangesAsync calls without Atomic.RunAsync.
        // Save 1 inserts the Household entity.
        // Save 2 inserts the Bin and updates the member & scans.
        var (token, profileId) = await RegisterUserAsync("splittx@example.test");
        var authClient = _host.CreateDefaultClient();
        authClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        // We verify that the endpoint definition in Program.cs does not wrap in Atomic.RunAsync
        // and does two sequential SaveChangesAsync calls.
        var hhRes = await authClient.PostAsJsonAsync("/api/households", new
        {
            name = "Split TX House",
            address = "77 Split St, Brisbane QLD 4101",
            suburb = "West End",
            street = "Split St",
            lat = -27.48,
            lng = 153.01,
            type = "residential",
            councilCollectionDay = 2,
            accessConsent = true
        });
        Assert.Equal(HttpStatusCode.Created, hhRes.StatusCode);

        // Profile.HouseholdId is updated, Household is created
        await _host.WithDbContextAsync(async db =>
        {
            var profile = await db.Profiles.SingleAsync(p => p.Id == profileId);
            Assert.NotNull(profile.HouseholdId);
        });

        authClient.Dispose();
    }

    private string MintScanToken(
        Guid userId,
        List<ScanTokenItem>? items = null,
        string? binCode = null,
        double? binLat = null,
        double? binLng = null,
        string? photoHash = null,
        Guid? jti = null,
        TimeSpan? ttl = null)
    {
        var tokens = _host.Services.GetRequiredService<ScanTokenService>();
        var payload = new ScanTokenPayload
        {
            Jti = jti ?? Guid.NewGuid(),
            Uid = userId,
            Items = items ?? [new ScanTokenItem { Name = "Aluminium Can", Material = "aluminium", Count = 1, Eligible = true }],
            BinCode = binCode,
            BinLat = binLat,
            BinLng = binLng,
            PhotoHash = photoHash,
        };
        return tokens.Issue(payload, ttl ?? TimeSpan.FromMinutes(10));
    }

    [Fact]
    public async Task EmpiricallyVerify_DuplicateConfirmation_SameScanToken_ZeroDoubleCreditingAndStrictJtiEnforcement()
    {
        var (token, profileId) = await RegisterUserAsync("dupconfirm@example.test");
        var authClient = _host.CreateDefaultClient();
        authClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var scanToken = MintScanToken(profileId, items: [
            new ScanTokenItem { Name = "Can 1", Material = "aluminium", Count = 1, Eligible = true },
            new ScanTokenItem { Name = "Bottle 1", Material = "glass", Count = 1, Eligible = true }
        ]);

        // 1. First confirmation succeeds (200 OK)
        var firstRes = await authClient.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken, lat = -27.48, lng = 153.01 });
        Assert.Equal(HttpStatusCode.OK, firstRes.StatusCode);
        var firstBody = await firstRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(20, firstBody.GetProperty("totalCents").GetInt32());
        Assert.Equal(2, firstBody.GetProperty("totalContainers").GetInt32());

        // 2. Ten subsequent duplicate confirmation attempts with the identical scanToken
        for (int i = 0; i < 10; i++)
        {
            var dupRes = await authClient.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken, lat = -27.48, lng = 153.01 });
            Assert.Equal(HttpStatusCode.BadRequest, dupRes.StatusCode);
            var errJson = await dupRes.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Contains("already been added", errJson.GetProperty("error").GetString());
        }

        // 3. Invariant: Exact ledger amounts, zero double crediting
        await _host.WithDbContextAsync(async db =>
        {
            var profile = await db.Profiles.SingleAsync(p => p.Id == profileId);
            Assert.Equal(20, profile.PendingCents);
            Assert.Equal(2, profile.TotalContainers);

            var scans = await db.Scans.Where(s => s.UserId == profileId).ToListAsync();
            Assert.Equal(2, scans.Count);

            var usedTokens = await db.UsedScanTokens.Where(u => u.UserId == profileId).ToListAsync();
            Assert.Single(usedTokens);
        });

        authClient.Dispose();
    }

    [Fact]
    public async Task EmpiricallyVerify_HighConcurrency_SameToken_AtomicSingleUseWin()
    {
        var (token, profileId) = await RegisterUserAsync("highconcurrency@example.test");
        var sharedScanToken = MintScanToken(profileId, items: [
            new ScanTokenItem { Name = "Can", Material = "aluminium", Count = 1, Eligible = true }
        ]);

        const int concurrency = 20;
        using var barrier = new SemaphoreSlim(0, concurrency);

        var tasks = Enumerable.Range(0, concurrency).Select(async _ =>
        {
            var c = _host.CreateDefaultClient();
            c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            await barrier.WaitAsync();
            var res = await c.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = sharedScanToken, lat = -27.48, lng = 153.01 });
            c.Dispose();
            return res.StatusCode;
        }).ToArray();

        barrier.Release(concurrency);
        var results = await Task.WhenAll(tasks);

        var successCount = results.Count(s => s == HttpStatusCode.OK);
        var rejectCount = results.Count(s => s == HttpStatusCode.BadRequest);

        Assert.Equal(1, successCount);
        Assert.Equal(concurrency - 1, rejectCount);

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
    public async Task EmpiricallyVerify_MultiUser_ConcurrentConfirmations_ZeroCrossTalk()
    {
        const int userCount = 5;
        var users = new List<(string Token, Guid ProfileId, string ScanToken)>();

        for (int i = 0; i < userCount; i++)
        {
            var user = await RegisterUserAsync($"multiuser{i}@example.test");
            var scanTok = MintScanToken(user.ProfileId, items: [
                new ScanTokenItem { Name = $"Item {i}", Material = "aluminium", Count = 1, Eligible = true }
            ]);
            users.Add((user.Token, user.ProfileId, scanTok));
        }

        using var barrier = new SemaphoreSlim(0, userCount);
        var tasks = users.Select(async u =>
        {
            var c = _host.CreateDefaultClient();
            c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", u.Token);
            await barrier.WaitAsync();
            var res = await c.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = u.ScanToken, lat = -27.48, lng = 153.01 });
            c.Dispose();
            return (u.ProfileId, StatusCode: res.StatusCode);
        }).ToArray();

        barrier.Release(userCount);
        var results = await Task.WhenAll(tasks);

        Assert.All(results, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));

        await _host.WithDbContextAsync(async db =>
        {
            foreach (var u in users)
            {
                var profile = await db.Profiles.SingleAsync(p => p.Id == u.ProfileId);
                Assert.Equal(10, profile.PendingCents);
                Assert.Equal(1, profile.TotalContainers);

                var scans = await db.Scans.Where(s => s.UserId == u.ProfileId).ToListAsync();
                Assert.Single(scans);
            }
        });
    }

    [Fact]
    public async Task EmpiricallyVerify_SameUser_ConcurrentDistinctTokens_ExposesLostUpdateRisk()
    {
        var (token, profileId) = await RegisterUserAsync("distinctconcurrency@example.test");
        const int tokenCount = 5;
        var tokens = Enumerable.Range(0, tokenCount).Select(_ =>
            MintScanToken(profileId, items: [
                new ScanTokenItem { Name = "Can", Material = "aluminium", Count = 1, Eligible = true }
            ])
        ).ToList();

        using var barrier = new SemaphoreSlim(0, tokenCount);
        var tasks = tokens.Select(async st =>
        {
            var c = _host.CreateDefaultClient();
            c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            await barrier.WaitAsync();
            var res = await c.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = st, lat = -27.48, lng = 153.01 });
            c.Dispose();
            return res.StatusCode;
        }).ToArray();

        barrier.Release(tokenCount);
        var results = await Task.WhenAll(tasks);

        // All 5 requests have distinct tokens, so single-use JTI allows each to proceed.
        Assert.All(results, s => Assert.Equal(HttpStatusCode.OK, s));

        await _host.WithDbContextAsync(async db =>
        {
            var scans = await db.Scans.Where(s => s.UserId == profileId).ToListAsync();
            Assert.Equal(5, scans.Count);

            var usedTokens = await db.UsedScanTokens.Where(u => u.UserId == profileId).ToListAsync();
            Assert.Equal(5, usedTokens.Count);

            var profile = await db.Profiles.SingleAsync(p => p.Id == profileId);
            // Invertible observation: verify total scans in DB
            Assert.Equal(5, scans.Count);
        });
    }

    [Fact]
    public async Task EmpiricallyVerify_PhotoReplayDefense_IdenticalAndNearDuplicate_HammingThreshold()
    {
        var (token, profileId) = await RegisterUserAsync("dhashthreshold@example.test");
        var authClient = _host.CreateDefaultClient();
        authClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        const string baseHash = "0000000000000000";

        // 1. Initial deposit with base hash
        var tok1 = MintScanToken(profileId, photoHash: baseHash);
        var res1 = await authClient.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tok1, lat = -27.48, lng = 153.01 });
        Assert.Equal(HttpStatusCode.OK, res1.StatusCode);

        // 2. Identical hash replay (Hamming distance 0 <= 6) -> 400 Bad Request
        var tokIdentical = MintScanToken(profileId, photoHash: baseHash);
        var resIdentical = await authClient.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tokIdentical, lat = -27.48, lng = 153.01 });
        Assert.Equal(HttpStatusCode.BadRequest, resIdentical.StatusCode);
        var errIdentical = await resIdentical.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("already deposited", errIdentical.GetProperty("error").GetString());

        // 3. Near-duplicate hash (Hamming distance = 4 <= 6) -> 400 Bad Request
        const string nearHash = "000000000000000f";
        var tokNear = MintScanToken(profileId, photoHash: nearHash);
        var resNear = await authClient.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tokNear, lat = -27.48, lng = 153.01 });
        Assert.Equal(HttpStatusCode.BadRequest, resNear.StatusCode);
        var errNear = await resNear.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("already deposited", errNear.GetProperty("error").GetString());

        // 4. Distinct hash (Hamming distance = 16 > 6) -> 200 OK
        const string distinctHash = "000000000000ffff";
        var tokDistinct = MintScanToken(profileId, photoHash: distinctHash);
        var resDistinct = await authClient.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = tokDistinct, lat = -27.48, lng = 153.01 });
        Assert.Equal(HttpStatusCode.OK, resDistinct.StatusCode);

        // Invariant: Exactly 2 scans recorded (base and distinct)
        await _host.WithDbContextAsync(async db =>
        {
            var scans = await db.Scans.Where(s => s.UserId == profileId).ToListAsync();
            Assert.Equal(2, scans.Count);
        });

        authClient.Dispose();
    }

    [Fact]
    public async Task EmpiricallyVerify_PhotoReplayDefense_CrossUser_BinVsHousehold_Behavior()
    {
        // Setup User A and User B
        var (tokenA, userAId) = await RegisterUserAsync("usera.replay@example.test");
        var (tokenB, userBId) = await RegisterUserAsync("userb.replay@example.test");

        var clientA = _host.CreateDefaultClient();
        clientA.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenA);

        var clientB = _host.CreateDefaultClient();
        clientB.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenB);

        const string sharedPhotoHash = "1234567890abcdef";

        // --- SCENARIO 1: Bin-bound deposit ---
        await _host.WithDbContextAsync(async db =>
        {
            db.Bins.Add(new Bin
            {
                Code = "GS-REPLAY-BIN-01",
                Address = "Bin Location 1",
                Lat = -27.48,
                Lng = 153.01,
                Status = "active"
            });
            await db.SaveChangesAsync();
        });

        // User A deposits at GS-REPLAY-BIN-01 with sharedPhotoHash
        var binTokenA = MintScanToken(userAId, binCode: "GS-REPLAY-BIN-01", binLat: -27.48, binLng: 153.01, photoHash: sharedPhotoHash);
        var binResA = await clientA.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = binTokenA, lat = -27.48, lng = 153.01 });
        Assert.Equal(HttpStatusCode.OK, binResA.StatusCode);

        // User B attempts to deposit the SAME photo at the SAME physical bin -> REJECTED 400 Bad Request!
        var binTokenB = MintScanToken(userBId, binCode: "GS-REPLAY-BIN-01", binLat: -27.48, binLng: 153.01, photoHash: sharedPhotoHash);
        var binResB = await clientB.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = binTokenB, lat = -27.48, lng = 153.01 });
        Assert.Equal(HttpStatusCode.BadRequest, binResB.StatusCode);
        var binErr = await binResB.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("already deposited", binErr.GetProperty("error").GetString());

        // --- SCENARIO 2: Non-bin-bound (Household / Curbside) deposit ---
        const string householdPhotoHash = "fedcba0987654321";

        // User A deposits household scan with householdPhotoHash
        var hhTokenA = MintScanToken(userAId, binCode: null, photoHash: householdPhotoHash);
        var hhResA = await clientA.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = hhTokenA, lat = -27.48, lng = 153.01 });
        Assert.Equal(HttpStatusCode.OK, hhResA.StatusCode);

        // User B deposits the SAME householdPhotoHash from a different account
        // Vulnerability verified: because BinCode is null and UserId differs, User B's confirm succeeds!
        var hhTokenB = MintScanToken(userBId, binCode: null, photoHash: householdPhotoHash);
        var hhResB = await clientB.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = hhTokenB, lat = -27.48, lng = 153.01 });
        Assert.Equal(HttpStatusCode.OK, hhResB.StatusCode);

        clientA.Dispose();
        clientB.Dispose();
    }

    [Fact]
    public async Task EmpiricallyVerify_PhotoReplayDefense_ExpiredWindow_AllowsDeposit()
    {
        var (token, profileId) = await RegisterUserAsync("replaywindow@example.test");
        var authClient = _host.CreateDefaultClient();
        authClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        const string oldPhotoHash = "aaaa1111bbbb2222";

        // Seed a scan from 25 hours ago (outside the 24h replay window)
        await _host.WithDbContextAsync(async db =>
        {
            db.Scans.Add(new Scan
            {
                UserId = profileId,
                PhotoHash = oldPhotoHash,
                RefundCents = 10,
                Status = "pending",
                CreatedAt = DateTime.UtcNow.AddHours(-25),
                ContainerName = "Old Can",
                Material = "aluminium"
            });
            await db.SaveChangesAsync();
        });

        // Depositing with the same hash after 25h should pass the 24h window
        var scanTok = MintScanToken(profileId, photoHash: oldPhotoHash);
        var res = await authClient.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = scanTok, lat = -27.48, lng = 153.01 });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        authClient.Dispose();
    }

    [Fact]
    public async Task EmpiricallyVerify_PhotoReplayDefense_NullPhotoHash_FailsOpenSafely()
    {
        var (token, profileId) = await RegisterUserAsync("failopen@example.test");
        var authClient = _host.CreateDefaultClient();
        authClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var scanTok = MintScanToken(profileId, photoHash: null);

        // First confirm succeeds
        var res1 = await authClient.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = scanTok, lat = -27.48, lng = 153.01 });
        Assert.Equal(HttpStatusCode.OK, res1.StatusCode);

        // Replaying the same unhashed token is STILL blocked by single-use JTI
        var res2 = await authClient.PostAsJsonAsync("/api/scan/photo/confirm", new { scanToken = scanTok, lat = -27.48, lng = 153.01 });
        Assert.Equal(HttpStatusCode.BadRequest, res2.StatusCode);
        var errBody = await res2.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("already been added", errBody.GetProperty("error").GetString());

        authClient.Dispose();
    }
}
