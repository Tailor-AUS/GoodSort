using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using GoodSort.Api.Tests.OpaqueBox;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GoodSort.Api.Tests;

/// <summary>
/// Pins the Pass 16 QA &amp; vision/onboarding hardening fixes (TailorAU/tailor-group#600):
/// 1. VisionService.MapMaterial, NormalizeContainer, and ParseChatVisionJson normalize US/LLM
///    material aliases ("Aluminum", "CAN", "PET_CLEAR", "plastic", "GLASS_BROWN", "carton"),
///    clamp per-item counts to [0, 100], and bound container names to &lt;= 200 chars.
/// 2. VisionResult.LooksLikeMoney catches attached ASCII cent amounts ("10c", "5c", "30c", "17.68c")
///    without false-positiving on "3 cans", "40°C", or "-196".
/// 3. Incomplete household creation (POST /api/households with suburb "BRISBANE") followed by
///    PATCH /api/households/{id}/street updates the household + Bin to MOOROOKA and backfills orphan scans.
/// 4. POST /api/scan/photo/confirm normalizes signed token items ("Aluminum", count 250, 300-char name)
///    into canonical "aluminium", 100 Scan rows, Household.Materials.Aluminium == 100, and Bin.Materials.Aluminium == 100.
/// </summary>
public class Pass16HardeningTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;

    public Pass16HardeningTests(OpaqueBoxHost host) => _host = host;

    [Theory]
    [InlineData("aluminium", "aluminium")]
    [InlineData("Aluminum", "aluminium")]
    [InlineData("CAN", "aluminium")]
    [InlineData("cans", "aluminium")]
    [InlineData("PET", "pet")]
    [InlineData("pet_clear", "pet")]
    [InlineData("pet_coloured", "pet")]
    [InlineData("Plastic", "pet")]
    [InlineData("GLASS", "glass")]
    [InlineData("glass_brown", "glass")]
    [InlineData("carton", "liquid_paperboard")]
    [InlineData("popper", "liquid_paperboard")]
    [InlineData("liquid_paperboard", "liquid_paperboard")]
    [InlineData("ceramics", "other")]
    [InlineData(null, "other")]
    public void MapMaterial_normalizes_tailor_and_llm_material_aliases(string? raw, string expected)
    {
        Assert.Equal(expected, VisionService.MapMaterial(raw));
    }

    [Theory]
    [InlineData("Nice haul — worth 30c!")]
    [InlineData("Earn 10c per can at home")]
    [InlineData("5c sorting credit")]
    [InlineData("17.68c COEX scheme")]
    [InlineData("WORTH 20C IN THE BAG")]
    public void VisionResult_replaces_attached_ascii_cent_amounts(string modelText)
    {
        var res = new VisionResult { Message = modelText };
        Assert.Equal("Point the camera at cans or bottles to add them to your sort.", res.Message);
    }

    [Theory]
    [InlineData("3 cans and 2 bottles ready to sort.")]
    [InlineData("Suntory -196 Double Lemon 330ml can spotted!")]
    [InlineData("Classic choice on a 40°C Brisbane afternoon!")]
    public void VisionResult_preserves_non_money_copy_with_c_tokens(string modelText)
    {
        var res = new VisionResult { Message = modelText };
        Assert.Equal(modelText, res.Message);
    }

    [Fact]
    public void ParseChatVisionJson_normalizes_fenced_json_and_legacy_arrays()
    {
        var longName = new string('X', 260);
        var fenced = $$"""
            ```json
            {
              "containers": [
                { "name": "  {{longName}}  ", "material": "Aluminum", "count": 999, "eligible": true, "confidence": 9.5 },
                { "name": "   ", "material": "Plastic", "count": -4, "eligible": false, "confidence": -1 }
              ],
              "message": "3 cans worth 30c!"
            }
            ```
            """;

        var parsed = VisionService.ParseChatVisionJson(fenced);
        Assert.NotNull(parsed);
        Assert.Equal(2, parsed!.Containers.Count);
        Assert.Equal(200, parsed.Containers[0].Name.Length);
        Assert.Equal("aluminium", parsed.Containers[0].Material);
        Assert.Equal(100, parsed.Containers[0].Count);
        Assert.Equal(0, parsed.Containers[0].Confidence);

        Assert.Equal("Beverage container", parsed.Containers[1].Name);
        Assert.Equal("pet", parsed.Containers[1].Material);
        Assert.Equal(0, parsed.Containers[1].Count);
        Assert.Equal("Point the camera at cans or bottles to add them to your sort.", parsed.Message);

        var legacy = """[{"name":"VB Stubby","material":"GLASS_BROWN","count":3,"eligible":true}]""";
        var parsedLegacy = VisionService.ParseChatVisionJson(legacy);
        Assert.NotNull(parsedLegacy);
        Assert.Single(parsedLegacy!.Containers);
        Assert.Equal("glass", parsedLegacy.Containers[0].Material);
        Assert.Equal("Found 3 containers!", parsedLegacy.Message);
    }

    [Fact]
    public async Task Incomplete_household_retry_via_PATCH_street_updates_suburb_bin_and_backfills_orphan_scans()
    {
        var (client, _, userId) = await _host.SignInMemberAsync($"pass16-retry-{Guid.NewGuid():N}@example.test");

        // Member has a legacy incomplete household (Suburb = null, CouncilCollectionDay = null)
        // linked on the server (e.g. signed in on a fresh phone where localStorage lacked householdId).
        Guid legacyHhId;
        using (var seedScope = _host.Services.CreateScope())
        {
            var seedDb = seedScope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var incompleteHh = new Household
            {
                Name = "Alex's Place",
                Address = "Brisbane QLD",
                Suburb = null,
                CouncilCollectionDay = null,
                Type = "residential",
                BinStatus = BinStatuses.Waitlisted,
                Lat = -27.4705,
                Lng = 153.0260,
            };
            seedDb.Households.Add(incompleteHh);
            seedDb.Bins.Add(new Bin
            {
                Code = $"GS-H{Random.Shared.Next(10000, 99999)}",
                Name = incompleteHh.Name,
                Address = incompleteHh.Address,
                Lat = incompleteHh.Lat,
                Lng = incompleteHh.Lng,
                HouseholdId = incompleteHh.Id,
            });
            var prof = await seedDb.Profiles.FirstAsync(p => p.Id == userId);
            prof.HouseholdId = incompleteHh.Id;

            // Plus an orphan scan recorded before household linkage
            seedDb.Scans.Add(new Scan
            {
                UserId = userId,
                HouseholdId = null,
                Barcode = "9300675001113",
                ContainerName = "Coca-Cola 375ml",
                Material = "aluminium",
                RefundCents = 10,
                Status = "pending",
            });
            await seedDb.SaveChangesAsync();
            legacyHhId = incompleteHh.Id;
        }

        // Attempt 1 (fresh browser without cached householdId): POST /api/households returns
        // 200 OK idempotently with the existing incomplete household (suburb still null!).
        var postHh = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Alex's Place",
            address = "42 Mayfield Rd, Moorooka QLD 4105",
            lat = -27.5352,
            lng = 153.0258,
            type = "residential",
            suburb = "MOOROOKA",
            councilCollectionDay = 3,
            usesDivider = true,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, postHh.StatusCode);
        var hhBody = await postHh.Content.ReadFromJsonAsync<JsonElement>();
        var hhId = hhBody.GetProperty("id").GetGuid();
        Assert.Equal(legacyHhId, hhId);
        Assert.True(hhBody.GetProperty("suburb").ValueKind == JsonValueKind.Null);

        // Attempt 2 (fixed client flow): Persisted hh.id drives PATCH /api/households/{id}/street
        var patchRes = await client.PatchAsJsonAsync($"/api/households/{hhId}/street", new
        {
            address = "42 Mayfield Rd, Moorooka QLD 4105",
            lat = -27.5352,
            lng = 153.0258,
            suburb = "MOOROOKA",
            councilCollectionDay = 3,
            councilArea = "Brisbane City Council",
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.OK, patchRes.StatusCode);
        var patched = await patchRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("MOOROOKA", patched.GetProperty("suburb").GetString());

        using var scope = _host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
        var hh = await db.Households.AsNoTracking().FirstAsync(h => h.Id == hhId);
        var bin = await db.Bins.AsNoTracking().FirstAsync(b => b.HouseholdId == hhId);
        var orphanCount = await db.Scans.CountAsync(s => s.UserId == userId && s.HouseholdId == null);

        Assert.Equal("MOOROOKA", hh.Suburb);
        Assert.Equal(1, hh.PendingContainers);
        Assert.Equal(10, hh.PendingValueCents);
        Assert.Equal("42 Mayfield Rd, Moorooka QLD 4105", bin.Address);
        Assert.Equal(1, bin.PendingContainers);
        Assert.Equal(10, bin.PendingValueCents);
        Assert.Equal(0, orphanCount);
    }

    [Fact]
    public async Task Photo_confirm_normalizes_material_clamps_count_and_bounds_name_from_scan_token()
    {
        var (client, _, userId) = await _host.SignInMemberAsync($"pass16-photo-{Guid.NewGuid():N}@example.test");

        var postHh = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Photo Normalization House",
            address = "15 Gainsborough St, Moorooka QLD 4105",
            lat = -27.5340,
            lng = 153.0270,
            type = "residential",
            suburb = "MOOROOKA",
            councilCollectionDay = 2,
            usesDivider = true,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, postHh.StatusCode);
        var hhId = (await postHh.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        string token;
        using (var scope = _host.Services.CreateScope())
        {
            var tokenSvc = scope.ServiceProvider.GetRequiredService<ScanTokenService>();
            token = tokenSvc.Issue(new ScanTokenPayload
            {
                Uid = userId,
                Items =
                [
                    new ScanTokenItem
                    {
                        Name = new string('A', 280),
                        Material = "Aluminum",
                        Count = 250,
                        Eligible = true,
                    }
                ],
            }, TimeSpan.FromMinutes(5));
        }

        var confirmRes = await client.PostAsJsonAsync("/api/scan/photo/confirm", new
        {
            scanToken = token,
        });
        Assert.Equal(HttpStatusCode.OK, confirmRes.StatusCode);
        var confirmBody = await confirmRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(100, confirmBody.GetProperty("totalContainers").GetInt32());
        Assert.Equal(1000, confirmBody.GetProperty("totalCents").GetInt32());

        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var scans = await db.Scans.AsNoTracking().Where(s => s.UserId == userId).ToListAsync();
            var hh = await db.Households.AsNoTracking().FirstAsync(h => h.Id == hhId);
            var bin = await db.Bins.AsNoTracking().FirstAsync(b => b.HouseholdId == hhId);

            Assert.Equal(100, scans.Count);
            Assert.All(scans, s =>
            {
                Assert.Equal("aluminium", s.Material);
                Assert.Equal(200, s.ContainerName.Length);
            });
            Assert.Equal(100, hh.Materials.Aluminium);
            Assert.Equal(0, hh.Materials.Other);
            Assert.Equal(100, bin.Materials.Aluminium);
            Assert.Equal(1000, bin.PendingValueCents);
        }
    }
}
