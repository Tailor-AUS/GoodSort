using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Tests.OpaqueBox;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GoodSort.Api.Tests;

/// <summary>
/// Pins the Pass 17 QA &amp; barcode/scan hardening fixes (TailorAU/tailor-group#600):
/// 1. POST /api/scans normalizes LLM/client material aliases ("Aluminum", "PET_CLEAR",
///    "GLASS_BROWN", "carton") and blank/long container names consistently with VisionService,
///    so Household.Materials and Bin.Materials never misroute cans/PET/glass into Other.
/// 2. GET /api/barcode/{barcode} accepts 8..14 digit barcodes (including 14-digit GTIN-14),
///    clamps oversized upstream Open Food Facts strings/tags before caching in IMemoryCache,
///    and aborts safely on upstream payloads exceeding 256 KB without OOM or poisoning cache.
/// </summary>
public class Pass17HardeningTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;

    public Pass17HardeningTests(OpaqueBoxHost host) => _host = host;

    [Fact]
    public async Task Post_scans_normalizes_material_aliases_and_blank_container_names_across_household_and_bin()
    {
        var (client, _, userId) = await _host.SignInMemberAsync($"pass17-scans-{Guid.NewGuid():N}@example.test");

        var postHh = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Material Alias House",
            address = "19 Mayfield Rd, Moorooka QLD 4105",
            lat = -27.5350,
            lng = 153.0260,
            type = "residential",
            suburb = "MOOROOKA",
            councilCollectionDay = 4,
            usesDivider = true,
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, postHh.StatusCode);
        var hhId = (await postHh.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var inputs = new (string Barcode, string Name, string RawMaterial, string ExpectedMaterial)[]
        {
            ("09300675024457", "   ", "Aluminum", "aluminium"),
            ("9300675025157", new string('P', 250), "PET_CLEAR", "pet"),
            ("9310058100012", "XXXX Stubby", "GLASS_BROWN", "glass"),
            ("9310058999999", "Juice Popper", "carton", "liquid_paperboard"),
        };

        foreach (var item in inputs)
        {
            var res = await client.PostAsJsonAsync("/api/scans", new
            {
                barcode = item.Barcode,
                containerName = item.Name,
                material = item.RawMaterial,
            });
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        }

        using var scope = _host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
        var scans = await db.Scans.AsNoTracking()
            .Where(s => s.UserId == userId)
            .OrderBy(s => s.CreatedAt)
            .ToListAsync();
        var hh = await db.Households.AsNoTracking().FirstAsync(h => h.Id == hhId);
        var bin = await db.Bins.AsNoTracking().FirstAsync(b => b.HouseholdId == hhId);

        Assert.Equal(4, scans.Count);
        Assert.Contains(scans, s => s.Barcode == "09300675024457" && s.Material == "aluminium" && s.ContainerName == "Beverage container");
        Assert.Contains(scans, s => s.Barcode == "9300675025157" && s.Material == "pet" && s.ContainerName.Length == 200);
        Assert.Contains(scans, s => s.Barcode == "9310058100012" && s.Material == "glass");
        Assert.Contains(scans, s => s.Barcode == "9310058999999" && s.Material == "liquid_paperboard");

        Assert.Equal(1, hh.Materials.Aluminium);
        Assert.Equal(1, hh.Materials.Pet);
        Assert.Equal(1, hh.Materials.Glass);
        Assert.Equal(1, hh.Materials.Other);

        Assert.Equal(1, bin.Materials.Aluminium);
        Assert.Equal(1, bin.Materials.Pet);
        Assert.Equal(1, bin.Materials.Glass);
        Assert.Equal(1, bin.Materials.Other);
    }

    [Fact]
    public async Task Barcode_lookup_accepts_gtin14_clamps_oversized_fields_and_rejects_upstream_bombs()
    {
        var handler = new StubOffHandler();
        await using var factory = _host.WithWebHostBuilder(builder =>
        {
            builder.ConfigureTestServices(services =>
            {
                services.AddHttpClient("OpenFoodFacts", c =>
                {
                    c.BaseAddress = new Uri("https://world.openfoodfacts.org/");
                }).ConfigurePrimaryHttpMessageHandler(() => handler);
            });
        });

        using var client = factory.CreateClient();

        // Format validation: <8 and >14 rejected
        var shortRes = await client.GetAsync("/api/barcode/1234567");
        Assert.Equal(HttpStatusCode.BadRequest, shortRes.StatusCode);
        var longRes = await client.GetAsync("/api/barcode/123456789012345");
        Assert.Equal(HttpStatusCode.BadRequest, longRes.StatusCode);

        // 14-digit GTIN-14 with oversized community-edited OFF strings -> clamped cleanly
        var gtin14 = "09300675024457";
        var okRes = await client.GetAsync($"/api/barcode/{gtin14}");
        Assert.Equal(HttpStatusCode.OK, okRes.StatusCode);
        var body = await okRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("found").GetBoolean());
        Assert.Equal(200, body.GetProperty("productName").GetString()!.Length);
        Assert.Equal(120, body.GetProperty("brands").GetString()!.Length);
        Assert.Equal(60, body.GetProperty("quantity").GetString()!.Length);
        Assert.Equal(300, body.GetProperty("packaging").GetString()!.Length);
        Assert.Equal(300, body.GetProperty("categories").GetString()!.Length);
        var tags = body.GetProperty("packagingMaterialsTags");
        Assert.Equal(12, tags.GetArrayLength());
        Assert.Equal(80, tags[0].GetString()!.Length);

        // Upstream payload > 256 KB -> returns found=false without crashing or caching
        var bombBarcode = "9399999999990";
        var bombRes = await client.GetAsync($"/api/barcode/{bombBarcode}");
        Assert.Equal(HttpStatusCode.OK, bombRes.StatusCode);
        var bombBody = await bombRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(bombBody.GetProperty("found").GetBoolean());
    }

    private sealed class StubOffHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri?.AbsolutePath ?? "";
            if (path.Contains("9399999999990", StringComparison.Ordinal))
            {
                var huge = "{\"product\":{\"product_name\":\"" + new string('Z', 300_000) + "\"}}";
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(huge, Encoding.UTF8, "application/json"),
                });
            }

            var tagsJson = string.Join(",", Enumerable.Range(0, 18).Select(_ => $"\"{new string('t', 120)}\""));
            var json = $$"""
                {
                  "product": {
                    "product_name": "{{new string('N', 260)}}",
                    "brands": "{{new string('B', 180)}}",
                    "quantity": "{{new string('Q', 100)}}",
                    "packaging": "{{new string('P', 400)}}",
                    "categories": "{{new string('C', 400)}}",
                    "packaging_materials_tags": [{{tagsJson}}]
                  }
                }
                """;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            });
        }
    }
}
