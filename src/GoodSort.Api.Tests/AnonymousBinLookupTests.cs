using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace GoodSort.Api.Tests;

/// <summary>
/// What an anonymous caller may learn from a bin code.
///
/// /api/bins/code/{code} has to be anonymous — the scanner resolves a bin from
/// the code printed on it before the member has signed in. It used to return
/// the whole Bin entity: the household's Name, full Address, exact Lat/Lng and
/// HouseholdId.
///
/// Household bin codes are derived as GS-H{hash % 100000}, so the space is a
/// hundred thousand values and can simply be walked. Anyone could enumerate it
/// and harvest every member's name, address and coordinates with no account at
/// all. Unlike the /api/routes leak, this one was reachable — a bin is created
/// for every residential household that joins.
///
/// These assert on the response body rather than the status code, because the
/// endpoint was never meant to be closed. It was meant to say less.
/// </summary>
public class AnonymousBinLookupTests : IClassFixture<AnonymousBinLookupTests.Host>
{
    private readonly Host _host;
    public AnonymousBinLookupTests(Host host) => _host = host;

    public class Host : WebApplicationFactory<Program>
    {
        public string DbName { get; } = $"binlookup-{Guid.NewGuid():N}";
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

    private async Task Seed(Bin bin)
    {
        using var scope = _host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
        db.Bins.Add(bin);
        await db.SaveChangesAsync();
    }

    /// <summary>Anonymous — no Authorization header, as the scanner is.</summary>
    private async Task<(HttpStatusCode Status, string Body)> Lookup(string code)
    {
        var res = await _host.CreateClient().GetAsync($"/api/bins/code/{code}");
        return (res.StatusCode, await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_household_bin_never_reveals_where_the_household_is()
    {
        await Seed(new Bin
        {
            Code = "GS-H12345",
            Name = "The Smith House",
            Address = "12 Beaudesert Rd, Moorooka QLD 4105",
            Lat = -27.5333, Lng = 153.0167,
            HouseholdId = Guid.NewGuid(),
        });

        var (status, body) = await Lookup("GS-H12345");

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.DoesNotContain("Beaudesert", body);
        Assert.DoesNotContain("The Smith House", body);
        Assert.DoesNotContain("-27.5333", body);
        Assert.DoesNotContain("153.0167", body);
    }

    [Fact]
    public async Task A_household_bin_does_not_leak_the_household_id_either()
    {
        var householdId = Guid.NewGuid();
        await Seed(new Bin { Code = "GS-H22222", Name = "A House", Address = "1 St", HouseholdId = householdId });

        var (_, body) = await Lookup("GS-H22222");

        Assert.DoesNotContain(householdId.ToString(), body);
    }

    [Fact]
    public async Task A_public_bin_still_gives_the_scanner_a_venue_name()
    {
        // The feature has to keep working: a hosted bin's name is a venue, not
        // a person, and the scanner shows it so the member knows where they are.
        await Seed(new Bin
        {
            Code = "GS-0042",
            Name = "The Burrow Cafe",
            Address = "5 Cafe Ln, West End",
            Lat = -27.48, Lng = 153.01,
            HostedBy = "The Burrow Cafe",
            HouseholdId = null,
        });

        var (status, body) = await Lookup("GS-0042");
        var json = JsonDocument.Parse(body).RootElement;

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("The Burrow Cafe", json.GetProperty("name").GetString());
        Assert.Equal("GS-0042", json.GetProperty("code").GetString());
        // Still no address or coordinates: no caller needs them, and the
        // geofence reads the bin's position from the signed token server-side.
        Assert.DoesNotContain("Cafe Ln", body);
        Assert.DoesNotContain("-27.48", body);
    }

    [Fact]
    public async Task An_unknown_code_is_a_plain_not_found()
    {
        var (status, _) = await Lookup("GS-H99999");
        Assert.Equal(HttpStatusCode.NotFound, status);
    }

    [Fact]
    public async Task The_scanner_still_gets_what_it_needs_to_identify_the_bin()
    {
        await Seed(new Bin { Code = "GS-0043", Name = "Public Bin", Status = "active", HouseholdId = null });

        var (_, body) = await Lookup("GS-0043");
        var json = JsonDocument.Parse(body).RootElement;

        Assert.True(json.TryGetProperty("id", out _));
        Assert.Equal("GS-0043", json.GetProperty("code").GetString());
        Assert.Equal("active", json.GetProperty("status").GetString());
    }
}
