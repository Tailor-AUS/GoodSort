using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace GoodSort.Api.Tests;

/// <summary>
/// A scan has to reach the counter dispatch actually reads.
///
/// Household.PendingContainers and Bin.PendingContainers are meant to mirror,
/// and settle decrements both. Nothing ever incremented the bin — it was a
/// counter that could only go down and never had anywhere to go down from.
///
/// RunGenerationService selects candidates on b.PendingContainers, orders them
/// by EstimatedContainers(b.PendingContainers), and prices the run from the
/// total. With the bin stuck at zero that helper returns the flat
/// DefaultUnscannedEstimate for every household bin, so a member who scanned
/// five hundred containers looked exactly like one who scanned none: same
/// queue position, same estimated volume, same payout quoted to the driver.
/// </summary>
public class BinCounterTests : IClassFixture<BinCounterTests.Host>
{
    private readonly Host _host;
    public BinCounterTests(Host host) => _host = host;

    public class Host : WebApplicationFactory<Program>
    {
        public string DbName { get; } = $"bincounter-{Guid.NewGuid():N}";
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
            builder.ConfigureServices(s =>
            {
                s.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                s.RemoveAll<GoodSortDbContext>();
                s.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(DbName));
                s.RemoveAll<IHostedService>();
            });
        }
    }

    private GoodSortDbContext Db() =>
        _host.Services.CreateScope().ServiceProvider.GetRequiredService<GoodSortDbContext>();

    private async Task<HttpClient> SignIn(string email)
    {
        var client = _host.CreateClient();
        var send = await client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        var code = (await send.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("devCode").GetString();
        var verify = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        var token = (await verify.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task Join(HttpClient client, string suburb = "MOOROOKA")
    {
        var res = await client.PostAsJsonAsync("/api/households", new
        {
            name = "Test House", address = $"12 Test St, {suburb} QLD 4105", suburb,
            street = "TEST ST", lat = -27.53, lng = 153.02, type = "residential",
            councilCollectionDay = 3, councilArea = "BCC", accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
    }

    private static async Task Scan(HttpClient client, int times, string material = "aluminium")
    {
        for (var i = 0; i < times; i++)
        {
            var res = await client.PostAsJsonAsync("/api/scans", new
            {
                barcode = "9300675024235", containerName = "Coca-Cola 375ml Can", material,
            });
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        }
    }

    private async Task<Bin> BinFor(string email)
    {
        using var db = Db();
        var profile = await db.Profiles.AsNoTracking().FirstAsync(p => p.Email == email);
        return await db.Bins.AsNoTracking().FirstAsync(b => b.HouseholdId == profile.HouseholdId);
    }

    [Fact]
    public async Task Scanning_fills_the_bin_that_dispatch_reads()
    {
        const string email = "bincounter-basic@example.test";
        var client = await SignIn(email);
        await Join(client);
        await Scan(client, 7);

        var bin = await BinFor(email);
        Assert.Equal(7, bin.PendingContainers);
    }

    [Fact]
    public async Task The_bin_and_the_household_agree()
    {
        // They are decremented together at settle, so they have to be
        // incremented together too, or settle drives one of them to zero while
        // the other still holds a balance.
        const string email = "bincounter-mirror@example.test";
        var client = await SignIn(email);
        await Join(client);
        await Scan(client, 5);

        using var db = Db();
        var profile = await db.Profiles.AsNoTracking().FirstAsync(p => p.Email == email);
        var household = await db.Households.AsNoTracking().FirstAsync(h => h.Id == profile.HouseholdId);
        var bin = await db.Bins.AsNoTracking().FirstAsync(b => b.HouseholdId == profile.HouseholdId);

        Assert.Equal(household.PendingContainers, bin.PendingContainers);
        Assert.Equal(household.PendingValueCents, bin.PendingValueCents);
    }

    [Fact]
    public async Task A_scanned_bin_no_longer_reads_as_the_default_guess()
    {
        // The consequence in one assertion. EstimatedContainers falls back to a
        // flat DefaultUnscannedEstimate when the bin is empty, which is what
        // made every household bin look identical to dispatch.
        const string email = "bincounter-estimate@example.test";
        var client = await SignIn(email);
        await Join(client);
        await Scan(client, HouseholdCredit.DefaultUnscannedEstimate + 13);

        var bin = await BinFor(email);
        var estimate = HouseholdCredit.EstimatedContainers(bin.PendingContainers);

        Assert.NotEqual(HouseholdCredit.DefaultUnscannedEstimate, estimate);
        Assert.Equal(HouseholdCredit.DefaultUnscannedEstimate + 13, estimate);
    }

    [Fact]
    public async Task The_bins_material_breakdown_matches_what_was_scanned()
    {
        const string email = "bincounter-materials@example.test";
        var client = await SignIn(email);
        await Join(client);
        await Scan(client, 3, "aluminium");
        await Scan(client, 2, "glass");

        var bin = await BinFor(email);
        Assert.Equal(3, bin.Materials.Aluminium);
        Assert.Equal(2, bin.Materials.Glass);
        Assert.Equal(0, bin.Materials.Pet);
    }

    [Fact]
    public void A_member_with_no_bin_yet_is_not_a_crash()
    {
        // Scan-first: a member can scan before they have an address, and so
        // before a bin exists. The household counter is still the record.
        BinCounter.AddScan(null, 5, 25, "aluminium");
    }

    [Fact]
    public void A_zero_or_negative_count_moves_nothing()
    {
        var bin = new Bin { Code = "GS-TEST", PendingContainers = 4, PendingValueCents = 20 };
        BinCounter.AddScan(bin, 0, 0, "aluminium");
        BinCounter.AddScan(bin, -3, -15, "aluminium");

        Assert.Equal(4, bin.PendingContainers);
        Assert.Equal(20, bin.PendingValueCents);
    }
}
