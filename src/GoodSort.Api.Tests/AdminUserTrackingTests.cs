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

public class AdminUserTrackingTests : IDisposable
{
    private readonly WebApplicationFactory<Program> _factory;
    private readonly string _dbName = $"admin-tracking-{Guid.NewGuid():N}";

    public AdminUserTrackingTests()
    {
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                services.RemoveAll<GoodSortDbContext>();
                services.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(_dbName));
                services.RemoveAll<IHostedService>();
            });
        });
    }

    public void Dispose() => _factory.Dispose();

    private async Task<(Profile Admin, Profile Member, Profile Orphan)> SeedAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();

        var admin = new Profile
        {
            Name = "Ops Admin",
            Email = "hello@thegoodsort.org",
            IsAdmin = true,
            Role = "sorter",
        };
        var hh = new Household
        {
            Name = "Moorooka Home",
            Address = "12 Hamilton Rd, Moorooka QLD 4105",
            Suburb = "MOOROOKA",
            Lat = -27.531,
            Lng = 153.028,
            PendingContainers = 3,
            PendingValueCents = 30,
        };
        var member = new Profile
        {
            Name = "Sarah Sorter",
            Email = "sarah@example.test",
            HouseholdId = hh.Id,
            ReferrerId = admin.Id,
            TotalContainers = 3,
            PendingCents = 30,
            PreferredPayoutMethod = "aba",
            BankBsb = "064-000",
            BankAccountNumber = "12345678",
            BankAccountName = "Sarah Sorter",
        };
        var orphan = new Profile
        {
            Name = "No Address Yet",
            Email = "orphan@example.test",
            TotalContainers = 0,
            PendingCents = 0,
        };

        db.Households.Add(hh);
        db.Profiles.AddRange(admin, member, orphan);
        db.Scans.Add(new Scan
        {
            UserId = member.Id,
            HouseholdId = hh.Id,
            ContainerName = "Coca-Cola 375mL Can",
            Material = "aluminium",
            Barcode = "9300675024235",
            RefundCents = 10,
        });
        db.SortedBags.Add(new SortedBag
        {
            HouseholdId = hh.Id,
            CreatorProfileId = member.Id,
            Code = "GSB-ALU-TRACK01",
            Stream = "aluminium",
            DeclaredContainers = 3,
            LinkedScanCount = 3,
            Status = "on_kerb",
        });
        await db.SaveChangesAsync();
        return (admin, member, orphan);
    }

    private HttpClient ClientFor(Profile p)
    {
        using var scope = _factory.Services.CreateScope();
        var auth = scope.ServiceProvider.GetRequiredService<AuthService>();
        var token = auth.GenerateJwt(p);
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    [Fact]
    public async Task New_growth_events_including_points_swap_and_bag_tagged_persist_and_appear_in_ordered_funnel()
    {
        var (admin, _, _) = await SeedAsync();
        using var anon = _factory.CreateClient();
        using var adminClient = ClientFor(admin);

        foreach (var ev in new[] { "landing_viewed", "suburb_page_viewed", "map_viewed", "bag_tagged", "flyer_printed", "points_swap_voted", "cash_payout_selected" })
        {
            var post = await anon.PostAsJsonAsync("/api/growth/events", new { name = ev, suburb = "Moorooka", path = "/sort" });
            Assert.Equal(HttpStatusCode.Accepted, post.StatusCode);
        }

        var funnelRes = await adminClient.GetAsync("/api/admin/funnel?days=7&suburb=Moorooka");
        Assert.Equal(HttpStatusCode.OK, funnelRes.StatusCode);
        var json = await funnelRes.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal("MOOROOKA", json.GetProperty("suburb").GetString());
        Assert.Equal(1, json.GetProperty("events").GetProperty("points_swap_voted").GetInt64());
        Assert.Equal(1, json.GetProperty("events").GetProperty("bag_tagged").GetInt64());
        Assert.Equal(1, json.GetProperty("events").GetProperty("flyer_printed").GetInt64());

        var stages = json.GetProperty("orderedStages").EnumerateArray().ToList();
        Assert.True(stages.Count >= 10);
        Assert.Equal("views", stages[0].GetProperty("key").GetString());
        Assert.Equal(3, stages[0].GetProperty("count").GetInt64());
        Assert.True(json.GetProperty("dailyTrend").GetArrayLength() == 7);
    }

    [Fact]
    public async Task Admin_users_list_detail_and_activity_return_enriched_crm_mask_bank_account_and_reject_non_admins()
    {
        var (admin, member, orphan) = await SeedAsync();
        using var memberClient = ClientFor(member);
        using var adminClient = ClientFor(admin);

        // Non-admin must be forbidden on all new CRM & activity routes
        Assert.Equal(HttpStatusCode.Forbidden, (await memberClient.GetAsync($"/api/admin/users/{member.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await memberClient.GetAsync("/api/admin/activity")).StatusCode);

        // Filter no_address returns orphan only
        var noAddrRes = await adminClient.GetAsync("/api/admin/users?filter=no_address");
        Assert.Equal(HttpStatusCode.OK, noAddrRes.StatusCode);
        var noAddr = await noAddrRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, noAddr.GetArrayLength());
        Assert.Equal(orphan.Id, noAddr[0].GetProperty("id").GetGuid());
        Assert.Equal("needs_address", noAddr[0].GetProperty("statusTag").GetString());

        // Single-user drill-down masks BankAccountNumber and returns scans, bags, and referrer
        var detailRes = await adminClient.GetAsync($"/api/admin/users/{member.Id}");
        Assert.Equal(HttpStatusCode.OK, detailRes.StatusCode);
        var detail = await detailRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("****5678", detail.GetProperty("payout").GetProperty("bankAccountMasked").GetString());
        Assert.True(detail.GetProperty("payout").GetProperty("hasPayoutDetails").GetBoolean());
        Assert.Equal(admin.Id, detail.GetProperty("referrer").GetProperty("id").GetGuid());
        Assert.Equal(1, detail.GetProperty("recentScans").GetArrayLength());
        Assert.Equal(1, detail.GetProperty("bags").GetArrayLength());
        Assert.Equal("GSB-ALU-TRACK01", detail.GetProperty("bags")[0].GetProperty("code").GetString());

        // Live activity stream returns signups, scan, and bag events in reverse chronological order
        var actRes = await adminClient.GetAsync("/api/admin/activity?limit=20");
        Assert.Equal(HttpStatusCode.OK, actRes.StatusCode);
        var act = await actRes.Content.ReadFromJsonAsync<JsonElement>();
        var items = act.GetProperty("items").EnumerateArray().ToList();
        Assert.Contains(items, x => x.GetProperty("kind").GetString() == "scan");
        Assert.Contains(items, x => x.GetProperty("kind").GetString() == "bag");
        Assert.Contains(items, x => x.GetProperty("kind").GetString() == "signup");
    }
}
