using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Tests.OpaqueBox;

namespace GoodSort.Api.Tests;

/// <summary>
/// Pins the Pass 8 QA &amp; hardening fixes (TailorAU/tailor-group#600):
/// 1. GET &amp; PUT /api/profiles/me/payout expose householdId and profileName so multi-device
///    or cleared-localStorage sessions recover household state cleanly.
/// 2. PUT /api/profiles/me/payout sanitizes CR/LF/TAB and clamps MemberName to 128 characters.
/// 3. Failed payout validation leaves an already-saved household intact for immediate retry.
/// </summary>
public class Pass8HardeningTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;

    public Pass8HardeningTests(OpaqueBoxHost host) => _host = host;

    [Fact]
    public async Task Get_and_put_payout_expose_householdId_and_profileName_for_multi_device_recovery()
    {
        var (client, _, _) = await _host.SignInMemberAsync($"pass8-recover-{Guid.NewGuid():N}@example.test");

        var hhCreate = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Sarah's Place",
            address = "14 Beaudesert Road, Moorooka QLD 4105",
            lat = -27.5356,
            lng = 153.0212,
            type = "residential",
            councilCollectionDay = 2,
            councilArea = "Brisbane City",
            suburb = "MOOROOKA",
            usesDivider = true,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hhCreate.StatusCode);
        var hhJson = await hhCreate.Content.ReadFromJsonAsync<JsonElement>();
        var createdHouseholdId = hhJson.GetProperty("id").GetGuid();

        var initialGet = await client.GetFromJsonAsync<JsonElement>("/api/profiles/me/payout");
        Assert.False(initialGet.GetProperty("hasPayoutDetails").GetBoolean());
        Assert.Equal(createdHouseholdId, initialGet.GetProperty("householdId").GetGuid());

        var putRes = await client.PutAsJsonAsync("/api/profiles/me/payout", new
        {
            method = "payid",
            payIdType = "email",
            payIdValue = "sarah@example.test",
            accountName = "Sarah Example",
            memberName = "Sarah Example",
        });
        Assert.Equal(HttpStatusCode.OK, putRes.StatusCode);
        var putJson = await putRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(putJson.GetProperty("hasPayoutDetails").GetBoolean());
        Assert.Equal(createdHouseholdId, putJson.GetProperty("householdId").GetGuid());
        Assert.Equal("Sarah Example", putJson.GetProperty("profileName").GetString());

        var secondGet = await client.GetFromJsonAsync<JsonElement>("/api/profiles/me/payout");
        Assert.True(secondGet.GetProperty("hasPayoutDetails").GetBoolean());
        Assert.Equal(createdHouseholdId, secondGet.GetProperty("householdId").GetGuid());
        Assert.Equal("Sarah Example", secondGet.GetProperty("profileName").GetString());
    }

    [Fact]
    public async Task Put_payout_sanitizes_control_characters_and_clamps_memberName_to_128_chars()
    {
        var (client, _, userId) = await _host.SignInMemberAsync($"pass8-bounds-{Guid.NewGuid():N}@example.test");

        var noisyName = "Knox\r\n\tHart " + new string('X', 220);
        var putRes = await client.PutAsJsonAsync("/api/profiles/me/payout", new
        {
            method = "aba",
            bsb = "064-000",
            accountNumber = "1234 5678",
            accountName = "Knox\r\nHart",
            memberName = noisyName,
        });
        Assert.Equal(HttpStatusCode.OK, putRes.StatusCode);
        var putJson = await putRes.Content.ReadFromJsonAsync<JsonElement>();
        var savedName = putJson.GetProperty("profileName").GetString()!;

        Assert.Equal(128, savedName.Length);
        Assert.DoesNotContain("\r", savedName);
        Assert.DoesNotContain("\n", savedName);
        Assert.DoesNotContain("\t", savedName);
        Assert.Equal("064000", putJson.GetProperty("bankBsb").GetString());
        Assert.Equal("12345678", putJson.GetProperty("bankAccountNumber").GetString());

        var profileJson = await client.GetFromJsonAsync<JsonElement>($"/api/profiles/{userId}");
        Assert.Equal(savedName, profileJson.GetProperty("name").GetString());
    }

    [Fact]
    public async Task Put_payout_rejects_invalid_aba_without_losing_saved_household_and_succeeds_on_retry()
    {
        var (client, _, _) = await _host.SignInMemberAsync($"pass8-partial-{Guid.NewGuid():N}@example.test");

        var hhCreate = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Alex's Place",
            address = "22 Ipswich Road, Annerley QLD 4103",
            lat = -27.5123,
            lng = 153.0315,
            type = "residential",
            councilCollectionDay = 4,
            councilArea = "Brisbane City",
            suburb = "ANNERLEY",
            usesDivider = true,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hhCreate.StatusCode);
        var hhId = (await hhCreate.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        // Simulate typo in BSB after household creation succeeded
        var badPut = await client.PutAsJsonAsync("/api/profiles/me/payout", new
        {
            method = "aba",
            bsb = "064",
            accountNumber = "12345678",
            accountName = "Alex Sorter",
            memberName = "Alex Sorter",
        });
        Assert.Equal(HttpStatusCode.BadRequest, badPut.StatusCode);

        var midGet = await client.GetFromJsonAsync<JsonElement>("/api/profiles/me/payout");
        Assert.False(midGet.GetProperty("hasPayoutDetails").GetBoolean());
        Assert.Equal(hhId, midGet.GetProperty("householdId").GetGuid());

        // Retry payout only — household remains linked and payout saves cleanly
        var retryPut = await client.PutAsJsonAsync("/api/profiles/me/payout", new
        {
            method = "aba",
            bsb = "064-123",
            accountNumber = "12345678",
            accountName = "Alex Sorter",
            memberName = "Alex Sorter",
        });
        Assert.Equal(HttpStatusCode.OK, retryPut.StatusCode);
        var retryJson = await retryPut.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(retryJson.GetProperty("hasPayoutDetails").GetBoolean());
        Assert.Equal(hhId, retryJson.GetProperty("householdId").GetGuid());
        Assert.Equal("064123", retryJson.GetProperty("bankBsb").GetString());
    }
}
