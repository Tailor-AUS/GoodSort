using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Xml.Linq;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using GoodSort.Api.Tests.OpaqueBox;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace GoodSort.Api.Tests;

/// <summary>
/// Pins the Pass 4 security, data-integrity, and SQL-safety fixes (TailorAU/tailor-group#600):
/// 1. GET /api/bins/{id}/qr XML-encodes hosted venue names (& / < / >) so SVG stays valid XML and XSS-free.
/// 2. NotificationService.Html & SingleLineSubject neutralize HTML/header injection in emails.
/// 3. CashoutService.SanitizeSingleLine keeps Cemtex ABA Record 1 lines strictly 120 chars even when AccountName contains CR/LF/TAB.
/// 4. CrpSettlement.BuildLedger clamps AreaName (<= 128) and CoexDocketRef (<= 64) to SQL column limits.
/// 5. GET /api/runner/leaderboard and GET /api/scans clamp negative/oversized limits safely.
/// 6. GET /api/marketplace/runs validates lat/lng/radiusKm and rounds centroids to 3dp.
/// 7. DELETE /api/profiles/{id} removes RunnerRatings (NoAction FK), CashoutRequests, ReferrerId links, and releases claimed runs.
/// </summary>
public class Pass4HardeningTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;

    public Pass4HardeningTests(OpaqueBoxHost host) => _host = host;

    [Fact]
    public async Task Bin_qr_svg_xml_encodes_ampersands_and_angle_brackets_in_hosted_venue_name()
    {
        Guid binId;
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var bin = new Bin
            {
                Code = $"GS-AMP{Random.Shared.Next(100, 999)}",
                Name = "Smith & Sons <script>alert(1)</script> Cafe",
                Address = "10 Beaudesert Rd, Moorooka QLD 4105",
                Lat = -27.535,
                Lng = 153.025,
                HouseholdId = null,
            };
            db.Bins.Add(bin);
            await db.SaveChangesAsync();
            binId = bin.Id;
        }

        var client = _host.CreateAnonymousClient();
        var res = await client.GetAsync($"/api/bins/{binId}/qr");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var svg = await res.Content.ReadAsStringAsync();

        // Must parse as valid XML (raw '&' or '<script>' breaks XDocument.Parse or injects elements).
        var doc = XDocument.Parse(svg);
        Assert.DoesNotContain(doc.Descendants(), e => e.Name.LocalName.Equals("script", StringComparison.OrdinalIgnoreCase));
        Assert.Contains("Smith &amp; Sons &lt;script&gt;alert(1)&lt;/script&gt; Cafe", svg);
    }

    [Fact]
    public void Notification_html_and_subject_helpers_escape_markup_and_newlines()
    {
        var encoded = NotificationService.Html("Alex <a href='https://evil.test'>Click & Win</a>");
        Assert.DoesNotContain("<a", encoded);
        Assert.Contains("&lt;a", encoded);
        Assert.Contains("&amp;", encoded);

        var subject = NotificationService.SingleLineSubject("Moorooka\r\nBcc: victim@example.test");
        Assert.DoesNotContain("\r", subject);
        Assert.DoesNotContain("\n", subject);
    }

    [Fact]
    public async Task Aba_export_keeps_120_char_lines_when_account_name_contains_newlines_or_tabs()
    {
        var options = new DbContextOptionsBuilder<GoodSortDbContext>()
            .UseInMemoryDatabase($"aba-newline-{Guid.NewGuid():N}")
            .Options;
        await using var db = new GoodSortDbContext(options);

        var user = new Profile
        {
            Name = "Jane Citizen",
            Email = "jane@example.test",
            ClearedCents = 5000,
        };
        db.Profiles.Add(user);
        await db.SaveChangesAsync();

        var cfg = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ABA_PAYOUTS_ENABLED"] = "true",
            ["ABA_TRACE_BSB"] = "084234",
            ["ABA_TRACE_ACCOUNT"] = "556677889",
            ["ABA_USER_ID"] = "TAILOR01",
        }).Build();

        var svc = new CashoutService(db, cfg);
        var (ok, err) = await svc.RequestCashout(user.Id, 2500, "064-000", "1234 5678", "Jane\r\n\tCitizen");
        Assert.True(ok, err);

        var aba = await svc.GenerateAbaFile();
        var lines = aba.Replace("\r\n", "\n").TrimEnd('\n').Split('\n');
        Assert.Equal(3, lines.Length);
        Assert.All(lines, line => Assert.Equal(120, line.Length));
        Assert.Contains("Jane Citizen", lines[1]);
    }

    [Fact]
    public void Crp_settlement_ledger_clamps_area_name_and_docket_ref_to_sql_column_lengths()
    {
        var longArea = new string('M', 200);
        var longDocket = new string('D', 100);

        var ledger = CrpSettlement.BuildLedger(
            runId: Guid.NewGuid(),
            areaName: longArea,
            crpActive: true,
            verifiedContainers: 1000,
            bagsVerified: 8,
            discrepancyStops: 0,
            householdPayoutCents: 10_000,
            containerMafiaCents: 1_000,
            runnerPayoutCents: 3_000,
            coexDocketRef: longDocket);

        Assert.Equal(128, ledger.AreaName.Length);
        Assert.NotNull(ledger.CoexDocketRef);
        Assert.Equal(64, ledger.CoexDocketRef!.Length);
    }

    [Fact]
    public async Task Leaderboard_and_scans_clamp_negative_limits_and_marketplace_runs_validates_coords()
    {
        var anon = _host.CreateAnonymousClient();

        var lbRes = await anon.GetAsync("/api/runner/leaderboard?limit=-10");
        Assert.Equal(HttpStatusCode.OK, lbRes.StatusCode);

        var badRuns = await anon.GetAsync("/api/marketplace/runs?lat=999&lng=153.0");
        Assert.Equal(HttpStatusCode.BadRequest, badRuns.StatusCode);

        var badRadius = await anon.GetAsync("/api/marketplace/runs?lat=-27.5&lng=153.0&radiusKm=-5");
        Assert.Equal(HttpStatusCode.BadRequest, badRadius.StatusCode);

        var (memberClient, _, memberId) = await _host.SignInMemberAsync($"scans-limit-{Guid.NewGuid():N}@example.test");
        var emptyBarcode = await memberClient.PostAsJsonAsync("/api/scans", new
        {
            userId = memberId,
            barcode = "   ",
            containerName = "Can",
            material = "aluminium",
        });
        Assert.Equal(HttpStatusCode.BadRequest, emptyBarcode.StatusCode);

        var okScan = await memberClient.PostAsJsonAsync("/api/scans", new
        {
            userId = memberId,
            barcode = "9300675001113",
            containerName = "Coca-Cola 375ml",
            material = "aluminium",
        });
        Assert.Equal(HttpStatusCode.OK, okScan.StatusCode);

        var scansNegLimit = await memberClient.GetAsync($"/api/scans?userId={memberId}&limit=-5");
        Assert.Equal(HttpStatusCode.OK, scansNegLimit.StatusCode);
        var scansArr = await scansNegLimit.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, scansArr.GetArrayLength());
    }

    [Fact]
    public async Task Deleting_runner_profile_cleans_up_ratings_cashouts_referrals_and_releases_claimed_runs()
    {
        var (runnerClient, _, runnerUserId) = await _host.SignInMemberAsync($"del-runner-{Guid.NewGuid():N}@example.test");
        var (_, _, childUserId) = await _host.SignInMemberAsync($"referred-child-{Guid.NewGuid():N}@example.test", referrerId: runnerUserId);

        var regRes = await runnerClient.PostAsJsonAsync("/api/runner/register", new
        {
            profileId = runnerUserId,
            vehicleType = "car",
            capacityBags = 10,
            serviceRadiusKm = 15.0,
        });
        Assert.Equal(HttpStatusCode.Created, regRes.StatusCode);
        var runnerProfileId = (await regRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        Guid claimedRunId;
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var depot = await db.Depots.FirstAsync();
            var settledRun = new Run { Status = "settled", RunnerId = runnerProfileId, DropPointId = depot.Id };
            var claimedRun = new Run { Status = "claimed", RunnerId = runnerProfileId, ClaimedAt = DateTime.UtcNow, DropPointId = depot.Id };
            db.Runs.AddRange(settledRun, claimedRun);
            db.RunnerRatings.Add(new RunnerRating { RunId = settledRun.Id, RunnerId = runnerProfileId, Stars = 5, OverallScore = 1.0 });
            db.CashoutRequests.Add(new CashoutRequest { UserId = runnerUserId, AmountCents = 2500, PayoutMethod = "payid", PayIdType = "email", PayIdValue = "r@example.test", AccountName = "Runner", Status = "pending" });
            await db.SaveChangesAsync();
            claimedRunId = claimedRun.Id;
        }

        var delRes = await runnerClient.DeleteAsync($"/api/profiles/{runnerUserId}");
        Assert.Equal(HttpStatusCode.OK, delRes.StatusCode);

        using (var checkScope = _host.Services.CreateScope())
        {
            var db = checkScope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            Assert.False(await db.Profiles.AnyAsync(p => p.Id == runnerUserId));
            Assert.False(await db.RunnerProfiles.AnyAsync(rp => rp.Id == runnerProfileId));
            Assert.False(await db.RunnerRatings.AnyAsync(rr => rr.RunnerId == runnerProfileId));
            Assert.False(await db.CashoutRequests.AnyAsync(c => c.UserId == runnerUserId));

            var child = await db.Profiles.FindAsync(childUserId);
            Assert.NotNull(child);
            Assert.Null(child!.ReferrerId);

            var releasedRun = await db.Runs.FindAsync(claimedRunId);
            Assert.NotNull(releasedRun);
            Assert.Equal("available", releasedRun!.Status);
            Assert.Null(releasedRun.RunnerId);
        }
    }
}
