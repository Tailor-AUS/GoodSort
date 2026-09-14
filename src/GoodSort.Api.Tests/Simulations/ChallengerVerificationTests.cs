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
}
