using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace GoodSort.Api.Tests;

public class BuildingSyndicateTests : IClassFixture<BuildingSyndicateTests.SyndicateHost>
{
    private readonly SyndicateHost _host;
    public BuildingSyndicateTests(SyndicateHost host) => _host = host;

    public class SyndicateHost : WebApplicationFactory<Program>
    {
        public readonly string DbName = $"syndicate-{Guid.NewGuid():N}";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
            builder.UseSetting("ADMIN_SEED_EMAIL", "admin@syndicate.test");

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

    private async Task<AuthMember> SignUp(string email, string name, string address, string suburb, string type = "residential")
    {
        var client = _host.CreateClient();
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            await db.Database.EnsureCreatedAsync();
        }

        var send = await client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        Assert.Equal(HttpStatusCode.OK, send.StatusCode);
        var code = (await send.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString()!;

        var verify = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        var verifyJson = await verify.Content.ReadFromJsonAsync<JsonElement>();
        var token = verifyJson.GetProperty("token").GetString()!;
        var profileId = verifyJson.GetProperty("profile").GetProperty("id").GetGuid();

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var hhRes = await client.PostAsJsonAsync("/api/households", new
        {
            name = $"{name}'s Place",
            address,
            suburb,
            type,
            lat = -27.512,
            lng = 153.035,
            councilCollectionDay = 4,
            councilArea = "Brisbane City Council",
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hhRes.StatusCode);
        var hhId = (await hhRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var patchProfile = await client.PatchAsJsonAsync($"/api/profiles/{profileId}", new { name, householdId = hhId });
        Assert.Equal(HttpStatusCode.OK, patchProfile.StatusCode);

        return new AuthMember(client, profileId, email);
    }

    private static async Task ScanCans(AuthMember member, int count)
    {
        for (var i = 0; i < count; i++)
        {
            var res = await member.Client.PostAsJsonAsync("/api/scans", new
            {
                userId = member.ProfileId,
                barcode = $"93006750{10000 + i}",
                containerName = "Schweppes Can 375mL",
                material = "aluminium",
            });
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        }
    }

    [Fact]
    public void BuildingAddress_Normalizes_Units_Levels_And_Commercial_Towers()
    {
        var a1 = BuildingAddress.Analyze("Unit 12, 45 Ekibin Rd East, Annerley QLD 4103", "Annerley");
        var a2 = BuildingAddress.Analyze("12/45 Ekibin Road East, Annerley", "Annerley");
        var a3 = BuildingAddress.Analyze("Unit 12 45 Ekibin Rd East", "ANNERLEY");

        Assert.NotNull(a1.BuildingKey);
        Assert.Equal(a1.BuildingKey, a2.BuildingKey);
        Assert.Equal(a1.BuildingKey, a3.BuildingKey);
        Assert.True(a1.IsMultiUnitOrCommercial);
        Assert.Equal("residential", a1.BuildingKind);

        var c1 = BuildingAddress.Analyze("Level 18/1 William St, Brisbane City QLD 4000", "Brisbane City");
        var c2 = BuildingAddress.Analyze("Suite 4, 1 William Street, Brisbane City", "Brisbane City");
        var c3 = BuildingAddress.Analyze("Level 22 1 William Street", "Brisbane City");
        Assert.Equal(c1.BuildingKey, c2.BuildingKey);
        Assert.Equal(c1.BuildingKey, c3.BuildingKey);
        Assert.True(c1.IsMultiUnitOrCommercial);
        Assert.Equal("commercial", c1.BuildingKind);

        var house = BuildingAddress.Analyze("67 Northview Outlook, Moorooka QLD 4105", "Moorooka");
        Assert.NotNull(house.BuildingKey);
        Assert.False(house.IsMultiUnitOrCommercial);

        Assert.Equal("one-william-tower", BuildingAddress.Slugify("One William Tower"));
    }

    [Fact]
    public async Task EndToEnd_Anonymous_Syndicate_OptIn_ZeroPii_Coordination_And_Admin_Controls()
    {
        var admin = await SignUp("admin@syndicate.test", "GoodSort Admin", "10 Queen St, Brisbane City", "Brisbane City");
        var alice = await SignUp("alice.secret@syndicate.test", "Alice SecretName", "Unit 12, 45 Ekibin Rd East, Annerley QLD 4103", "Annerley");
        var bob = await SignUp("bob.secret@syndicate.test", "Bob SecretName", "3/45 Ekibin Road East, Annerley QLD 4103", "Annerley");
        var charlie = await SignUp("charlie.secret@syndicate.test", "Charlie SecretName", "Unit 9, 45 Ekibin Rd East, Annerley QLD 4103", "Annerley");
        var outsider = await SignUp("outsider@syndicate.test", "Outsider Neighbour", "Unit 1, 99 Ipswich Rd, Annerley QLD 4103", "Annerley");

        await ScanCans(alice, 3);
        await ScanCans(bob, 1);

        // 1. Auto-detect building for Alice without silently enrolling her
        var detectRes = await alice.Client.GetFromJsonAsync<JsonElement>("/api/syndicates/mine");
        Assert.True(detectRes.GetProperty("eligible").GetBoolean());
        Assert.Equal("none", detectRes.GetProperty("myMembership").GetProperty("status").GetString());
        Assert.Equal("detected", detectRes.GetProperty("syndicate").GetProperty("status").GetString());
        Assert.Equal(2, detectRes.GetProperty("syndicate").GetProperty("otherSortersCount").GetInt32());
        Assert.Empty(detectRes.GetProperty("messages").EnumerateArray());

        // 2. Alice opts in -> founding anonymous Captain ("Sorter #1", approved)
        var aliceJoin = await alice.Client.PostAsync("/api/syndicates/mine/request-join", null);
        Assert.Equal(HttpStatusCode.OK, aliceJoin.StatusCode);
        var aliceJoinJson = await aliceJoin.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("approved", aliceJoinJson.GetProperty("myMembership").GetProperty("status").GetString());
        Assert.Equal("captain", aliceJoinJson.GetProperty("myMembership").GetProperty("role").GetString());
        Assert.Equal("Sorter #1", aliceJoinJson.GetProperty("myMembership").GetProperty("anonHandle").GetString());

        // 3. Bob opts in -> pending ("Sorter #2"), blocked from chat and coordination until approved
        var bobJoin = await bob.Client.PostAsync("/api/syndicates/mine/request-join", null);
        Assert.Equal(HttpStatusCode.OK, bobJoin.StatusCode);
        var bobJoinJson = await bobJoin.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("pending", bobJoinJson.GetProperty("myMembership").GetProperty("status").GetString());
        Assert.Equal("Sorter #2", bobJoinJson.GetProperty("myMembership").GetProperty("anonHandle").GetString());
        var bobMemberId = bobJoinJson.GetProperty("myMembership").GetProperty("memberId").GetGuid();
        Assert.Empty(bobJoinJson.GetProperty("messages").EnumerateArray());

        var bobBlockedMsg = await bob.Client.PostAsJsonAsync("/api/syndicates/mine/messages", new { body = "Hi from pending!" });
        Assert.Equal(HttpStatusCode.Forbidden, bobBlockedMsg.StatusCode);

        var bobBlockedCoord = await bob.Client.PostAsJsonAsync("/api/syndicates/mine/coordination", new { readyToPool = true });
        Assert.Equal(HttpStatusCode.Forbidden, bobBlockedCoord.StatusCode);

        // 4. Outsider in different building joins their own syndicate and CANNOT approve Bob (IDOR check)
        var outsiderJoin = await outsider.Client.PostAsync("/api/syndicates/mine/request-join", null);
        Assert.Equal(HttpStatusCode.OK, outsiderJoin.StatusCode);
        var outsiderApproveBob = await outsider.Client.PostAsJsonAsync($"/api/syndicates/mine/members/{bobMemberId}/decision", new { decision = "approve" });
        Assert.Equal(HttpStatusCode.NotFound, outsiderApproveBob.StatusCode);

        // 5. Alice (captain) approves Bob
        var aliceApproveBob = await alice.Client.PostAsJsonAsync($"/api/syndicates/mine/members/{bobMemberId}/decision", new { decision = "approve" });
        Assert.Equal(HttpStatusCode.OK, aliceApproveBob.StatusCode);

        // 6. STRICT ZERO-PII CHECK: Bob's GET /api/syndicates/mine never leaks Alice's name, email, unit number, or ProfileId
        var bobRawJson = await bob.Client.GetStringAsync("/api/syndicates/mine");
        Assert.DoesNotContain("Alice", bobRawJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SecretName", bobRawJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("alice.secret", bobRawJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Unit 12", bobRawJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Unit 9", bobRawJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(alice.ProfileId.ToString(), bobRawJson, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Sorter #1", bobRawJson);
        Assert.Contains("Sorter #2", bobRawJson);

        // 7. Collaborative collection booking: drop spot + pickup window votes + ready toggle + request pickup
        var aliceCoord = await alice.Client.PostAsJsonAsync("/api/syndicates/mine/coordination", new
        {
            readyToPool = true,
            dropSpot = "bin_room",
            pickupWindow = "saturday_am",
            requestPickup = true,
        });
        Assert.Equal(HttpStatusCode.OK, aliceCoord.StatusCode);

        var bobCoord = await bob.Client.PostAsJsonAsync("/api/syndicates/mine/coordination", new
        {
            readyToPool = true,
            dropSpot = "bin_room",
            pickupWindow = "saturday_am",
        });
        Assert.Equal(HttpStatusCode.OK, bobCoord.StatusCode);
        var bobCoordJson = await bobCoord.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("requested", bobCoordJson.GetProperty("syndicate").GetProperty("pickupStatus").GetString());
        Assert.Equal("bin_room", bobCoordJson.GetProperty("syndicate").GetProperty("dropSpot").GetString());
        Assert.Equal("saturday_am", bobCoordJson.GetProperty("syndicate").GetProperty("pickupWindow").GetString());
        Assert.Equal(2, bobCoordJson.GetProperty("syndicate").GetProperty("readyCount").GetInt32());
        Assert.Equal(4, bobCoordJson.GetProperty("syndicate").GetProperty("totalContainers").GetInt32());
        Assert.Equal(25, bobCoordJson.GetProperty("myMembership").GetProperty("mySharePct").GetInt32());

        // 8. Anonymous chat + moderation auto-hide on 2 flags
        var msgRes = await alice.Client.PostAsJsonAsync("/api/syndicates/mine/messages", new
        {
            body = "Dropped 2 tagged aluminium bags in the bin room near the ramp.",
        });
        Assert.Equal(HttpStatusCode.OK, msgRes.StatusCode);
        var msgId = (await msgRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        // Alice cannot report her own message
        var selfReport = await alice.Client.PostAsync($"/api/syndicates/mine/messages/{msgId}/report", null);
        Assert.Equal(HttpStatusCode.BadRequest, selfReport.StatusCode);

        // Outsider cannot report Alice's message
        var outsiderReport = await outsider.Client.PostAsync($"/api/syndicates/mine/messages/{msgId}/report", null);
        Assert.Equal(HttpStatusCode.NotFound, outsiderReport.StatusCode);

        // Charlie joins and is approved by Alice so two peers can flag the message
        var charlieJoin = await charlie.Client.PostAsync("/api/syndicates/mine/request-join", null);
        var charlieMemberId = (await charlieJoin.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("myMembership").GetProperty("memberId").GetGuid();
        Assert.Equal(HttpStatusCode.OK, (await alice.Client.PostAsJsonAsync($"/api/syndicates/mine/members/{charlieMemberId}/decision", new { decision = "approve" })).StatusCode);

        var flag1 = await bob.Client.PostAsync($"/api/syndicates/mine/messages/{msgId}/report", null);
        Assert.Equal(HttpStatusCode.OK, flag1.StatusCode);
        Assert.False((await flag1.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("hidden").GetBoolean());

        var flag2 = await charlie.Client.PostAsync($"/api/syndicates/mine/messages/{msgId}/report", null);
        Assert.Equal(HttpStatusCode.OK, flag2.StatusCode);
        Assert.True((await flag2.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("hidden").GetBoolean());

        // Hidden message no longer appears in member feed
        var afterHide = await bob.Client.GetStringAsync("/api/syndicates/mine");
        Assert.DoesNotContain("near the ramp", afterHide);

        // 9. Admin governance: non-admin rejected (403); admin lists, promotes to official, schedules pickup, restores message
        var nonAdminRes = await alice.Client.GetAsync("/api/admin/syndicates");
        Assert.Equal(HttpStatusCode.Forbidden, nonAdminRes.StatusCode);

        var adminList = await admin.Client.GetFromJsonAsync<JsonElement>("/api/admin/syndicates");
        var ekibinSyndicate = adminList.GetProperty("syndicates").EnumerateArray()
            .First(s => s.GetProperty("displayName").GetString()!.Contains("Ekibin", StringComparison.OrdinalIgnoreCase));
        var syndicateId = ekibinSyndicate.GetProperty("id").GetGuid();
        Assert.True(ekibinSyndicate.GetProperty("flaggedCount").GetInt32() >= 1);

        var makeOfficial = await admin.Client.PatchAsJsonAsync($"/api/admin/syndicates/{syndicateId}", new
        {
            status = "official",
            pickupStatus = "scheduled",
        });
        Assert.Equal(HttpStatusCode.OK, makeOfficial.StatusCode);

        var promoteBob = await admin.Client.PostAsJsonAsync($"/api/admin/syndicates/{syndicateId}/members/{bobMemberId}", new { action = "make_captain" });
        Assert.Equal(HttpStatusCode.OK, promoteBob.StatusCode);

        var restoreMsg = await admin.Client.PostAsJsonAsync($"/api/admin/syndicates/{syndicateId}/messages/{msgId}/moderate", new { action = "restore" });
        Assert.Equal(HttpStatusCode.OK, restoreMsg.StatusCode);

        var bobFinal = await bob.Client.GetFromJsonAsync<JsonElement>("/api/syndicates/mine");
        Assert.Equal("official", bobFinal.GetProperty("syndicate").GetProperty("status").GetString());
        Assert.Equal("scheduled", bobFinal.GetProperty("syndicate").GetProperty("pickupStatus").GetString());
        Assert.Equal("captain", bobFinal.GetProperty("myMembership").GetProperty("role").GetString());

        // 10. Account deletion cleans up syndicate membership cleanly without FK errors
        var delCharlie = await charlie.Client.DeleteAsync($"/api/profiles/{charlie.ProfileId}");
        Assert.True(delCharlie.IsSuccessStatusCode, $"Expected 2xx deleting Charlie profile, got {delCharlie.StatusCode}");
    }
}
