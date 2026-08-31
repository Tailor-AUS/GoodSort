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
    public async Task The_public_leaderboard_never_carries_a_surname()
    {
        // Tests the CALLER, not the helper. PublicNameExposureTests proves the
        // rule works; it cannot see an endpoint that skips it — and skipping it
        // is exactly what the leaderboard did. Deleting the trim leaves every
        // helper test green, so this is the one that catches it.
        using var scope = _host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
        var profile = new Profile
        {
            Name = "Sarah Chen",
            Email = $"leaderboard-{Guid.NewGuid():N}@example.test",
            Phone = "leaderboard@example.test",
        };
        db.Profiles.Add(profile);
        db.RunnerProfiles.Add(new RunnerProfile
        {
            ProfileId = profile.Id,
            Level = "gold",
            TotalContainersCollected = 500,
            TotalRuns = 12,
        });
        await db.SaveChangesAsync();

        var res = await _host.CreateClient().GetAsync("/api/runner/leaderboard");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadAsStringAsync();

        Assert.Contains("Sarah", body);
        Assert.DoesNotContain("Chen", body);
    }

    [Fact]
    public async Task The_printable_label_does_not_carry_a_household_name()
    {
        // The second door. Projecting the code lookup in #64 stopped it
        // returning the address, but it still returns the bin id — and this
        // endpoint is anonymous too, and rendered bin.Name into the SVG. So the
        // enumerable GS-H{hash % 100000} space still led to the household name:
        // code -> id -> QR -> name. Closing one door is not closing the leak.
        var householdBin = new Bin
        {
            Code = "GS-H33333",
            Name = "The Okafor House",
            Address = "9 Sample St, Moorooka",
            HouseholdId = Guid.NewGuid(),
        };
        await Seed(householdBin);

        var res = await _host.CreateClient().GetAsync($"/api/bins/{householdBin.Id}/qr");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var svg = await res.Content.ReadAsStringAsync();

        Assert.Contains("GS-H33333", svg);            // the code still identifies it
        Assert.DoesNotContain("Okafor", svg);
        Assert.DoesNotContain("Sample St", svg);
    }

    [Fact]
    public async Task A_hosted_bins_label_still_shows_its_venue()
    {
        // The label has to stay useful: a venue name belongs on a public bin.
        var hosted = new Bin
        {
            Code = "GS-0099",
            Name = "The Burrow Cafe",
            HostedBy = "The Burrow Cafe",
            HouseholdId = null,
        };
        await Seed(hosted);

        var res = await _host.CreateClient().GetAsync($"/api/bins/{hosted.Id}/qr");
        var svg = await res.Content.ReadAsStringAsync();

        Assert.Contains("The Burrow Cafe", svg);
        Assert.Contains("GS-0099", svg);
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
