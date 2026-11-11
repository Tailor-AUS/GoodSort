using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using GoodSort.Api.Tests.OpaqueBox;
using Microsoft.Extensions.DependencyInjection;

namespace GoodSort.Api.Tests;

/// <summary>
/// Pins the Pass 9 QA &amp; hardening fixes (TailorAU/tailor-group#600):
/// 1. Bringing the last kerb QR bag inside ("sealed") or cancelling it ("cancelled") resets
///    household.BinIsOut = false while preserving BinIsOut = true when sibling kerb bags remain.
/// 2. POST /api/bags caps active uncollected ("sealed" / "on_kerb") bags at 50 per household, and
///    GET /api/bags/mine orders active bags ahead of already-verified bags.
/// 3. CashoutService.CsvSafeField restricts allowLeadingPlus to genuine E.164 phone numbers so
///    formula-prefixed email PayIDs (e.g. "+1+1@evil.example") and pipe formulas are escaped.
/// </summary>
public class Pass9HardeningTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;

    public Pass9HardeningTests(OpaqueBoxHost host) => _host = host;

    [Fact]
    public async Task Patch_bag_status_resets_household_binIsOut_only_when_last_kerb_bag_leaves_kerb()
    {
        var (client, _, _) = await _host.SignInMemberAsync($"pass9-kerb-{Guid.NewGuid():N}@example.test");

        var hhCreate = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Kerb Sync Home",
            address = "18 Gladstone Road, Highgate Hill QLD 4101",
            lat = -27.4852,
            lng = 153.0168,
            type = "residential",
            councilCollectionDay = 3,
            councilArea = "Brisbane City",
            suburb = "HIGHGATE HILL",
            usesDivider = true,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hhCreate.StatusCode);
        var hhId = (await hhCreate.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var bagARes = await client.PostAsJsonAsync("/api/bags", new
        {
            stream = "aluminium",
            declaredContainers = 25,
            putOnKerb = true,
        });
        Assert.Equal(HttpStatusCode.Created, bagARes.StatusCode);
        var bagAId = (await bagARes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var hhAfterA = await client.GetFromJsonAsync<JsonElement>($"/api/households/{hhId}");
        Assert.True(hhAfterA.GetProperty("binIsOut").GetBoolean());

        var bagBRes = await client.PostAsJsonAsync("/api/bags", new
        {
            stream = "pet_clear",
            declaredContainers = 15,
            putOnKerb = true,
        });
        Assert.Equal(HttpStatusCode.Created, bagBRes.StatusCode);
        var bagBId = (await bagBRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        // Bring Bag A inside while Bag B remains on the kerb -> BinIsOut stays true
        var sealARes = await client.PatchAsJsonAsync($"/api/bags/{bagAId}/status", new { status = "sealed" });
        Assert.Equal(HttpStatusCode.OK, sealARes.StatusCode);
        var hhAfterSealA = await client.GetFromJsonAsync<JsonElement>($"/api/households/{hhId}");
        Assert.True(hhAfterSealA.GetProperty("binIsOut").GetBoolean());

        // Bring Bag B inside -> zero bags remain on kerb -> BinIsOut resets to false
        var sealBRes = await client.PatchAsJsonAsync($"/api/bags/{bagBId}/status", new { status = "sealed" });
        Assert.Equal(HttpStatusCode.OK, sealBRes.StatusCode);
        var hhAfterSealB = await client.GetFromJsonAsync<JsonElement>($"/api/households/{hhId}");
        Assert.False(hhAfterSealB.GetProperty("binIsOut").GetBoolean());

        // Put Bag A back on kerb, then cancel it -> BinIsOut resets to false
        var kerbARes = await client.PatchAsJsonAsync($"/api/bags/{bagAId}/status", new { status = "on_kerb" });
        Assert.Equal(HttpStatusCode.OK, kerbARes.StatusCode);
        var hhAfterReKerb = await client.GetFromJsonAsync<JsonElement>($"/api/households/{hhId}");
        Assert.True(hhAfterReKerb.GetProperty("binIsOut").GetBoolean());

        var cancelARes = await client.PatchAsJsonAsync($"/api/bags/{bagAId}/status", new { status = "cancelled" });
        Assert.Equal(HttpStatusCode.OK, cancelARes.StatusCode);
        var hhAfterCancel = await client.GetFromJsonAsync<JsonElement>($"/api/households/{hhId}");
        Assert.False(hhAfterCancel.GetProperty("binIsOut").GetBoolean());
    }

    [Fact]
    public async Task Post_bags_caps_active_bags_at_50_and_get_bags_mine_orders_active_before_verified()
    {
        var (client, _, userId) = await _host.SignInMemberAsync($"pass9-cap-{Guid.NewGuid():N}@example.test");

        var hhCreate = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Bag Cap Home",
            address = "42 Dornoch Terrace, West End QLD 4101",
            lat = -27.4841,
            lng = 153.0094,
            type = "residential",
            councilCollectionDay = 1,
            councilArea = "Brisbane City",
            suburb = "WEST END",
            usesDivider = true,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, hhCreate.StatusCode);
        var hhId = (await hhCreate.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        Guid cancelTargetId;
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            for (var i = 0; i < 49; i++)
            {
                db.SortedBags.Add(new SortedBag
                {
                    Code = $"GS-ALU-P9{i:D4}",
                    HouseholdId = hhId,
                    CreatorProfileId = userId,
                    Stream = "aluminium",
                    DeclaredContainers = 10,
                    Status = "sealed",
                    CreatedAt = DateTime.UtcNow.AddMinutes(-60 + i),
                });
            }

            var fiftieth = new SortedBag
            {
                Code = "GS-ALU-P9LAST",
                HouseholdId = hhId,
                CreatorProfileId = userId,
                Stream = "aluminium",
                DeclaredContainers = 10,
                Status = "on_kerb",
                KerbAt = DateTime.UtcNow.AddMinutes(-5),
                CreatedAt = DateTime.UtcNow.AddMinutes(-5),
            };
            cancelTargetId = fiftieth.Id;
            db.SortedBags.Add(fiftieth);

            // Newer verified bag must NOT crowd out active sealed/on_kerb bags in GET /api/bags/mine
            db.SortedBags.Add(new SortedBag
            {
                Code = "GS-ALU-P9VER",
                HouseholdId = hhId,
                CreatorProfileId = userId,
                Stream = "glass",
                DeclaredContainers = 20,
                VerifiedContainers = 20,
                Status = "verified",
                CreatedAt = DateTime.UtcNow.AddMinutes(5),
                VerifiedAt = DateTime.UtcNow.AddMinutes(6),
            });

            await db.SaveChangesAsync();
        }

        // 51st active bag is rejected
        var overCapRes = await client.PostAsJsonAsync("/api/bags", new
        {
            stream = "glass",
            declaredContainers = 12,
            putOnKerb = false,
        });
        Assert.Equal(HttpStatusCode.BadRequest, overCapRes.StatusCode);

        // GET /api/bags/mine returns all 50 active bags ahead of the verified bag
        var mineJson = await client.GetFromJsonAsync<JsonElement>("/api/bags/mine");
        var bagsArr = mineJson.GetProperty("bags");
        Assert.Equal(50, bagsArr.GetArrayLength());
        for (var i = 0; i < bagsArr.GetArrayLength(); i++)
        {
            Assert.NotEqual("verified", bagsArr[i].GetProperty("status").GetString());
        }

        // Cancelling one active bag frees a slot for a new bag AND lets the verified bag appear in top 50
        var cancelRes = await client.PatchAsJsonAsync($"/api/bags/{cancelTargetId}/status", new { status = "cancelled" });
        Assert.Equal(HttpStatusCode.OK, cancelRes.StatusCode);

        var afterCancelMine = await client.GetFromJsonAsync<JsonElement>("/api/bags/mine");
        var afterCancelArr = afterCancelMine.GetProperty("bags");
        Assert.Equal(50, afterCancelArr.GetArrayLength());
        Assert.Equal("verified", afterCancelArr[49].GetProperty("status").GetString());

        var underCapRes = await client.PostAsJsonAsync("/api/bags", new
        {
            stream = "glass",
            declaredContainers = 12,
            putOnKerb = false,
        });
        Assert.Equal(HttpStatusCode.Created, underCapRes.StatusCode);
    }

    [Fact]
    public void CsvSafeField_escapes_formula_prefixes_while_preserving_e164_phone_payids()
    {
        Assert.Equal("+61412345678", CashoutService.CsvSafeField("+61412345678", allowLeadingPlus: true));
        Assert.Equal("'+61412345678", CashoutService.CsvSafeField("+61412345678", allowLeadingPlus: false));
        Assert.Equal("'+1+1@evil.example", CashoutService.CsvSafeField("+1+1@evil.example", allowLeadingPlus: true));
        Assert.Equal("'+SUM(A1:A2)", CashoutService.CsvSafeField("+SUM(A1:A2)", allowLeadingPlus: true));
        Assert.Equal("'|cmd|' /C calc'!A0", CashoutService.CsvSafeField("|cmd|' /C calc'!A0", allowLeadingPlus: true));
        Assert.Equal("'=HYPERLINK(\"https://evil.example\")",
            CashoutService.CsvSafeField("=HYPERLINK(\"https://evil.example\")", allowLeadingPlus: true).Replace("\"\"", "\"")[1..^1]);
    }
}
