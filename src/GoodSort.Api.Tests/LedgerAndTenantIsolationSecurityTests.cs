using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Tests.OpaqueBox;

namespace GoodSort.Api.Tests;

/// <summary>
/// Pins the three privilege-escalation and ledger-injection vectors closed in
/// Overnight QA Pass 3 (TailorAU/tailor-group#600):
/// 1. POST /api/bins requires AdminPolicy and ignores client-supplied ledger fields.
/// 2. DELETE /api/profiles/{id} + POST /api/profiles cannot mint ClearedCents or hijack HouseholdId.
/// 3. PATCH /api/profiles/{id} forbids attaching to another member's HouseholdId.
/// </summary>
public class LedgerAndTenantIsolationSecurityTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;

    public LedgerAndTenantIsolationSecurityTests(OpaqueBoxHost host) => _host = host;

    [Fact]
    public async Task Non_admin_cannot_create_public_bins_to_fabricate_marketplace_runs()
    {
        var (attackerClient, _, _) = await _host.SignInMemberAsync($"bin-attacker-{Guid.NewGuid():N}@example.test");

        var res = await attackerClient.PostAsJsonAsync("/api/bins", new
        {
            name = "Fake High-Volume Bin",
            address = "100 Ipswich Rd, Annerley QLD 4103",
            lat = -27.5101,
            lng = 153.0322,
            pendingContainers = 50_000,
        });

        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
    }

    [Fact]
    public async Task Delete_then_recreate_profile_ignores_client_supplied_balances_and_household()
    {
        var (victimClient, _, _) = await _host.SignInMemberAsync($"victim-{Guid.NewGuid():N}@example.test");
        var hhRes = await victimClient.PostAsJsonAsync("/api/households", new
        {
            name = "Victim Home",
            address = "12 Ekibin Rd East, Annerley QLD 4103",
            suburb = "ANNERLEY",
            street = "Ekibin Rd East",
            lat = -27.5150,
            lng = 153.0350,
            type = "residential",
            councilCollectionDay = 3,
            councilArea = "Brisbane City Council",
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hhRes.StatusCode);
        var victimHhId = (await hhRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var (attackerClient, _, attackerId) = await _host.SignInMemberAsync($"mint-attacker-{Guid.NewGuid():N}@example.test");

        // Delete row while stateless JWT remains valid, then POST /api/profiles with forged ledger balances.
        var delRes = await attackerClient.DeleteAsync($"/api/profiles/{attackerId}");
        Assert.Equal(HttpStatusCode.OK, delRes.StatusCode);

        var recreateRes = await attackerClient.PostAsJsonAsync("/api/profiles", new
        {
            name = "Forged Balance",
            clearedCents = 99_999_900,
            pendingCents = 50_000_00,
            totalContainers = 500_000,
            householdId = victimHhId,
            isAdmin = true,
            role = "admin",
        });
        Assert.Equal(HttpStatusCode.Created, recreateRes.StatusCode);

        var profile = await _host.GetProfileAsync(attackerClient, attackerId);
        Assert.Equal(0, profile.GetProperty("clearedCents").GetInt32());
        Assert.Equal(0, profile.GetProperty("pendingCents").GetInt32());
        Assert.Equal(0, profile.GetProperty("totalContainers").GetInt32());
        Assert.Equal(JsonValueKind.Null, profile.GetProperty("householdId").ValueKind);
        Assert.False(profile.GetProperty("isAdmin").GetBoolean());
    }

    [Fact]
    public async Task Member_cannot_hijack_another_members_household_via_profile_patch()
    {
        var (victimClient, _, _) = await _host.SignInMemberAsync($"hh-victim-{Guid.NewGuid():N}@example.test");
        var hhRes = await victimClient.PostAsJsonAsync("/api/households", new
        {
            name = "Private Annerley Home",
            address = "44 Cracknell Rd, Annerley QLD 4103",
            suburb = "ANNERLEY",
            street = "Cracknell Rd",
            lat = -27.5162,
            lng = 153.0281,
            type = "residential",
            councilCollectionDay = 4,
            councilArea = "Brisbane City Council",
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hhRes.StatusCode);
        var victimHhId = (await hhRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var (attackerClient, _, attackerId) = await _host.SignInMemberAsync($"hh-attacker-{Guid.NewGuid():N}@example.test");
        var hijackPatch = await attackerClient.PatchAsJsonAsync($"/api/profiles/{attackerId}", new
        {
            name = "Attacker",
            householdId = victimHhId,
        });
        Assert.Equal(HttpStatusCode.Forbidden, hijackPatch.StatusCode);

        // Victim household remains unreadable to attacker.
        var readVictimHh = await attackerClient.GetAsync($"/api/households/{victimHhId}");
        Assert.Equal(HttpStatusCode.Forbidden, readVictimHh.StatusCode);
    }

    [Fact]
    public async Task Runner_profile_patch_rejects_out_of_bounds_capacity_and_radius()
    {
        var (runnerClient, _, runnerProfileId) = await _host.SignInMemberAsync($"runner-bounds-{Guid.NewGuid():N}@example.test");
        var regRes = await runnerClient.PostAsJsonAsync("/api/runner/register", new
        {
            profileId = runnerProfileId,
            vehicleType = "ute",
            capacityBags = 12,
            serviceRadiusKm = 15.0,
        });
        Assert.Equal(HttpStatusCode.Created, regRes.StatusCode);

        var negBags = await runnerClient.PatchAsJsonAsync($"/api/runner/profile/{runnerProfileId}", new
        {
            capacityBags = -10,
        });
        Assert.Equal(HttpStatusCode.BadRequest, negBags.StatusCode);

        var hugeRadius = await runnerClient.PatchAsJsonAsync($"/api/runner/profile/{runnerProfileId}", new
        {
            serviceRadiusKm = 9999.0,
        });
        Assert.Equal(HttpStatusCode.BadRequest, hugeRadius.StatusCode);
    }
}
