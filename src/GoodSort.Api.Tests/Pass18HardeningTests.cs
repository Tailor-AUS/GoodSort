using System.Net;
using System.Net.Http.Json;
using System.Text;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using GoodSort.Api.Tests.OpaqueBox;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace GoodSort.Api.Tests;

/// <summary>
/// Pins Pass 18 QA hardening (TailorAU/tailor-group#600):
/// 1. CashoutService.GenerateAbaFile caps each batch at MaxAbaBatchRows (99) so Cemtex Record 7's
///    10-digit File Total and 6-digit Record Count never overflow 120 characters, and SanitizeAbaText
///    normalizes diacritics/smart-quotes/emojis into strict 7-bit ASCII (120 UTF-8 bytes per line).
/// 2. CashoutService.ValidatePayoutDetails and RequestPayIdCashout normalize PayID emails via
///    AuthService.NormalizeValidEmail and reject display-name/whitespace/CRLF payloads without debiting.
/// 3. POST /api/growth/events scrubs street addresses, postcodes, GUIDs, barcodes, emails, fragments,
///    and CR/LF payloads via GrowthEventSanitizer before persistence and logging.
/// </summary>
public class Pass18HardeningTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;

    public Pass18HardeningTests(OpaqueBoxHost host) => _host = host;

    private static IConfiguration OpenPayouts() =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ABA_PAYOUTS_ENABLED"] = "true",
            ["PAYID_PAYOUTS_ENABLED"] = "true",
            ["ABA_TRACE_BSB"] = "084234",
            ["ABA_TRACE_ACCOUNT"] = "556677889",
            ["ABA_USER_ID"] = "TAILOR01",
            ["ABA_USER_NAME"] = "TAILOR INTELLIGENCE",
            ["ABA_REMITTER"] = "THE GOOD SORT",
        }).Build();

    [Fact]
    public async Task AbaExport_CapsEachBatchAt99Rows_AndEmitsStrict120ByteAsciiRecords()
    {
        var db = new GoodSortDbContext(
            new DbContextOptionsBuilder<GoodSortDbContext>()
                .UseInMemoryDatabase($"aba-pass18-{Guid.NewGuid():N}")
                .Options);

        var baseTime = new DateTime(2026, 11, 12, 0, 0, 0, DateTimeKind.Utc);
        for (var i = 0; i < 105; i++)
        {
            var profile = new Profile
            {
                Name = $"Member {i}",
                Email = $"m{i}@example.test",
                Phone = $"m{i}@example.test",
            };
            db.Profiles.Add(profile);
            db.Set<CashoutRequest>().Add(new CashoutRequest
            {
                UserId = profile.Id,
                AmountCents = CashoutService.MaxSingleCashoutCents, // $999,999.99 each — 101+ would overflow 10 digits without cap!
                PayoutMethod = "aba",
                Bsb = "084234",
                AccountNumber = "123456789",
                AccountName = i == 0 ? "José O’Connor — Sorter 🎉" : $"Member {i}",
                Status = "pending",
                CreatedAt = baseTime.AddSeconds(i),
            });
        }
        await db.SaveChangesAsync();

        var svc = new CashoutService(db, OpenPayouts());

        // Batch 1 claims exactly 99 rows (total = 9,899,999,901 cents <= 9,999,999,999).
        var batch1 = await svc.GenerateAbaFile();
        var lines1 = batch1.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Length > 0).ToList();
        Assert.Equal(1 + CashoutService.MaxAbaBatchRows + 1, lines1.Count);
        foreach (var line in lines1)
        {
            Assert.Equal(120, line.Length);
            Assert.Equal(120, Encoding.UTF8.GetByteCount(line));
            Assert.All(line, ch => Assert.InRange(ch, ' ', '~'));
        }

        // First detail record has diacritics folded, smart quote/em-dash mapped to ASCII, emoji stripped.
        Assert.StartsWith("Jose O'Connor - Sorter", lines1[1].Substring(30, 32));
        var trailer1 = lines1[^1];
        Assert.Equal("9899999901", trailer1.Substring(20, 10));
        Assert.Equal("000099", trailer1.Substring(74, 6));

        Assert.Equal(99, await db.Set<CashoutRequest>().CountAsync(c => c.Status == "processing"));
        Assert.Equal(6, await db.Set<CashoutRequest>().CountAsync(c => c.Status == "pending"));

        // Batch 2 claims the remaining 6 rows cleanly.
        var batch2 = await svc.GenerateAbaFile();
        var lines2 = batch2.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Length > 0).ToList();
        Assert.Equal(8, lines2.Count);
        Assert.All(lines2, line =>
        {
            Assert.Equal(120, line.Length);
            Assert.Equal(120, Encoding.UTF8.GetByteCount(line));
        });
        Assert.Equal(0, await db.Set<CashoutRequest>().CountAsync(c => c.Status == "pending"));
        Assert.Equal(105, await db.Set<CashoutRequest>().CountAsync(c => c.Status == "processing"));
    }

    [Fact]
    public async Task PayIdValidation_NormalizesEmails_AndRejectsDisplayNameOrWhitespacePayloads()
    {
        var valid = CashoutService.ValidatePayoutDetails(
            "payid", "email", "  Alice.Sorter+Tag@TheGoodSort.ORG ", null, null, "Alice Sorter");
        Assert.True(valid.Valid, valid.Error);
        Assert.Equal("alice.sorter+tag@thegoodsort.org", valid.Details!.PayIdValue);

        foreach (var bad in new[]
        {
            "Bob <bob@example.com>",
            "alice @example.com",
            "alice@example.com\r\n0400000000,999.99",
            "alice@localhost",
            "alice@.example.com",
        })
        {
            var res = CashoutService.ValidatePayoutDetails("payid", "email", bad, null, null, "Alice Sorter");
            Assert.False(res.Valid);
        }

        var db = new GoodSortDbContext(
            new DbContextOptionsBuilder<GoodSortDbContext>()
                .UseInMemoryDatabase($"payid-pass18-{Guid.NewGuid():N}")
                .Options);
        var profile = new Profile
        {
            Name = "Alice",
            Email = "alice@example.test",
            Phone = "alice@example.test",
            ClearedCents = 4000,
        };
        db.Profiles.Add(profile);
        await db.SaveChangesAsync();

        var svc = new CashoutService(db, OpenPayouts());
        var rejected = await svc.RequestPayIdCashout(profile.Id, 2000, "email", "Bob <bob@example.com>", "Alice");
        Assert.False(rejected.Success);
        Assert.Equal(4000, (await db.Profiles.AsNoTracking().SingleAsync(p => p.Id == profile.Id)).ClearedCents);

        var accepted = await svc.RequestPayIdCashout(profile.Id, 2000, "email", " Alice@Example.COM ", "Alice");
        Assert.True(accepted.Success, accepted.Error);
        var row = await db.Set<CashoutRequest>().SingleAsync(c => c.UserId == profile.Id);
        Assert.Equal("alice@example.com", row.PayIdValue);
        Assert.Equal(2000, (await db.Profiles.AsNoTracking().SingleAsync(p => p.Id == profile.Id)).ClearedCents);
    }

    [Fact]
    public async Task GrowthEventsEndpoint_ScrubsEmailsAddressesGuidsBarcodesAndCrlf()
    {
        using var client = _host.CreateClient();

        var r1 = await client.PostAsJsonAsync("/api/growth/events", new
        {
            name = "invite_landed",
            suburb = "10 Mayfield Rd Moorooka 4105",
            path = "/brisbane/moorooka#r=4ebefa46-94c4-4df8-aa45-a6dcbde28bbb",
        });
        Assert.Equal(HttpStatusCode.Accepted, r1.StatusCode);

        var r2 = await client.PostAsJsonAsync("/api/growth/events", new
        {
            name = "otp_sent",
            suburb = "alice@example.com",
            path = "/api/profiles/4ebefa46-94c4-4df8-aa45-a6dcbde28bbb",
        });
        Assert.Equal(HttpStatusCode.Accepted, r2.StatusCode);

        var r3 = await client.PostAsJsonAsync("/api/growth/events", new
        {
            name = "scan_credited",
            suburb = "Moorooka\r\nFAKE_LOG=1",
            path = "/api/barcode/9300675024457",
        });
        Assert.Equal(HttpStatusCode.Accepted, r3.StatusCode);

        var r4 = await client.PostAsJsonAsync("/api/growth/events", new
        {
            name = "suburb_picked",
            suburb = "Mount Coot-tha",
            path = "/brisbane/mount-coot-tha",
        });
        Assert.Equal(HttpStatusCode.Accepted, r4.StatusCode);

        using var scope = _host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
        var events = await db.GrowthEvents
            .OrderByDescending(e => e.Id)
            .Take(4)
            .OrderBy(e => e.Id)
            .ToListAsync();

        Assert.Equal(4, events.Count);
        Assert.Null(events[0].Suburb);
        Assert.Null(events[0].Path);
        Assert.Null(events[1].Suburb);
        Assert.Null(events[1].Path);
        Assert.Null(events[2].Suburb);
        Assert.Null(events[2].Path);
        Assert.Equal("MOUNT COOT-THA", events[3].Suburb);
        Assert.Equal("/brisbane/mount-coot-tha", events[3].Path);
    }
}
