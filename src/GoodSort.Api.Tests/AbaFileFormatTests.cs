using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace GoodSort.Api.Tests;

/// <summary>
/// The bank file itself.
///
/// GenerateAbaFile had no test of any kind, and it is the last thing that
/// happens before money moves: its output is uploaded to a bank, which reads it
/// by fixed character offset rather than by any delimiter. A field that is too
/// short does not truncate a value — it slides every field after it to the
/// left, so the bank reads the wrong bytes as the amount, the account, or the
/// record count.
///
/// Two records were the wrong length when these tests were written. The
/// descriptive record was 118 (its description field was 10 characters against
/// a specified 12) and the file-total record was 102 (its filler was 6 against
/// a specified 24, putting the record count at position 51 where the bank looks
/// at 75). The code carried correct width comments beside literals that did not
/// match them, which is exactly why counting by eye is not enough.
///
/// Positions below are 1-based as the ABA (Cemtex) specification states them,
/// so a reader can check them against it directly.
/// </summary>
public class AbaFileFormatTests
{
    private const int RecordLength = 120;

    private static IConfiguration OpenPayouts() =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ABA_PAYOUTS_ENABLED"] = "true",
            ["ABA_TRACE_BSB"] = "084234",
            ["ABA_TRACE_ACCOUNT"] = "556677889",
            ["ABA_USER_ID"] = "TAILOR01",
            ["ABA_USER_NAME"] = "TAILOR INTELLIGENCE",
            ["ABA_REMITTER"] = "THE GOOD SORT",
        }).Build();

    private static GoodSortDbContext NewDb() =>
        new(new DbContextOptionsBuilder<GoodSortDbContext>()
            .UseInMemoryDatabase($"aba-{Guid.NewGuid():N}").Options);

    /// <summary>Seeds N pending payouts and returns the file's records.</summary>
    private static async Task<(List<string> Lines, GoodSortDbContext Db)> Generate(params int[] amountsCents)
    {
        var db = NewDb();
        foreach (var (amount, i) in amountsCents.Select((a, i) => (a, i)))
        {
            var profile = new Profile
            {
                Name = $"Member {i}",
                Email = $"aba-{i}-{Guid.NewGuid():N}@example.test",
                Phone = $"aba-{i}-{Guid.NewGuid():N}@example.test",
            };
            db.Profiles.Add(profile);
            db.Set<CashoutRequest>().Add(new CashoutRequest
            {
                UserId = profile.Id,
                AmountCents = amount,
                Bsb = "084234",
                AccountNumber = "123456789",
                AccountName = $"MEMBER {i} NAME",
                Status = "pending",
            });
        }
        await db.SaveChangesAsync();

        var aba = await new CashoutService(db, OpenPayouts()).GenerateAbaFile();
        var lines = aba.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Length > 0).ToList();
        return (lines, db);
    }

    /// <summary>1-based field extraction, matching how the specification is written.</summary>
    private static string Field(string record, int startPosition, int length) =>
        record.Substring(startPosition - 1, length);

    [Fact]
    public async Task Every_record_is_exactly_120_characters()
    {
        // The assertion the whole format rests on. A short record does not
        // truncate — it shifts everything after it into the wrong columns.
        var (lines, _) = await Generate(2500, 5000, 12345);

        Assert.NotEmpty(lines);
        foreach (var line in lines)
            Assert.True(line.Length == RecordLength,
                $"Record type {line[0]} is {line.Length} characters; ABA requires exactly {RecordLength}. " +
                $"Every field after the short one is read from the wrong offset.");
    }

    [Fact]
    public async Task The_file_is_one_header_then_the_payments_then_one_trailer()
    {
        var (lines, _) = await Generate(2500, 5000, 12345);

        Assert.Equal(5, lines.Count);
        Assert.Equal('0', lines[0][0]);
        Assert.All(lines.Skip(1).Take(3), l => Assert.Equal('1', l[0]));
        Assert.Equal('7', lines[^1][0]);
    }

    [Fact]
    public async Task The_trailer_totals_and_count_sit_where_the_bank_reads_them()
    {
        var (lines, _) = await Generate(2500, 5000, 12345);
        var trailer = lines[^1];

        Assert.Equal("999-999", Field(trailer, 2, 7));

        // Net (21-30), credit (31-40), debit (41-50), count (75-80).
        var expectedTotal = (2500 + 5000 + 12345).ToString().PadLeft(10, '0');
        Assert.Equal(expectedTotal, Field(trailer, 21, 10));
        Assert.Equal(expectedTotal, Field(trailer, 31, 10));
        Assert.Equal("0000000000", Field(trailer, 41, 10));
        Assert.Equal("000003", Field(trailer, 75, 6));
    }

    [Fact]
    public async Task A_payment_record_puts_the_amount_and_account_where_the_bank_reads_them()
    {
        var (lines, _) = await Generate(2500);
        var payment = lines[1];

        Assert.Equal("084-234", Field(payment, 2, 7));      // BSB, hyphenated
        Assert.Equal("123456789", Field(payment, 9, 9));    // account number
        Assert.Equal("53", Field(payment, 19, 2));          // transaction code: credit
        Assert.Equal("0000002500", Field(payment, 21, 10)); // amount in cents, zero filled
        Assert.StartsWith("MEMBER 0 NAME", Field(payment, 31, 32));
        Assert.Equal("084-234", Field(payment, 81, 7));     // trace BSB
        Assert.Equal("556677889", Field(payment, 88, 9));   // trace account
        Assert.Equal("00000000", Field(payment, 113, 8));   // withholding tax
    }

    [Fact]
    public async Task The_header_carries_the_user_id_and_a_date_where_the_bank_reads_them()
    {
        var (lines, _) = await Generate(2500);
        var header = lines[0];

        Assert.Equal("01", Field(header, 19, 2));                       // reel sequence
        Assert.Equal("TAILOR INTELLIGENCE".PadRight(26), Field(header, 31, 26));
        Assert.Equal("TAILOR", Field(header, 57, 6));                   // user id, 6 chars
        Assert.Equal("PAYMENTS".PadRight(12), Field(header, 63, 12));   // description
        Assert.Matches(@"^\d{6}$", Field(header, 75, 6));               // DDMMYY
    }

    [Fact]
    public async Task A_generated_payment_is_marked_processing_so_it_is_not_paid_twice()
    {
        var (_, db) = await Generate(2500, 5000);

        var stillPending = await db.Set<CashoutRequest>().AsNoTracking().CountAsync(c => c.Status == "pending");
        var processing = await db.Set<CashoutRequest>().AsNoTracking().CountAsync(c => c.Status == "processing");

        Assert.Equal(0, stillPending);
        Assert.Equal(2, processing);
    }

    [Fact]
    public async Task A_second_export_finds_nothing_left_to_claim()
    {
        // Every payment belongs to exactly one export. The first claims the
        // pending rows into its batch; the second has nothing to take and must
        // return an empty file rather than the same payments again.
        var (first, db) = await Generate(2500, 5000);
        Assert.NotEmpty(first);

        var second = await new CashoutService(db, OpenPayouts()).GenerateAbaFile();
        Assert.Equal("", second);
    }

    [Fact]
    public async Task Every_exported_payment_carries_the_batch_that_claimed_it()
    {
        // The batch id is what lets an export read back exactly its own rows,
        // and what an admin uses to recover a file that was generated but never
        // sent — the rows are marked processing either way.
        var (_, db) = await Generate(2500, 5000, 12345);

        var rows = await db.Set<CashoutRequest>().AsNoTracking().ToListAsync();
        Assert.All(rows, r => Assert.NotNull(r.BatchId));
        Assert.Single(rows.Select(r => r.BatchId).Distinct());
        Assert.All(rows, r => Assert.NotNull(r.ProcessedAt));
    }

    [Fact]
    public async Task No_pending_payouts_produces_no_file()
    {
        var db = NewDb();
        var aba = await new CashoutService(db, OpenPayouts()).GenerateAbaFile();
        Assert.Equal("", aba);
    }

    [Fact]
    public async Task A_closed_payout_switch_produces_no_file_even_with_payouts_waiting()
    {
        // The placeholder remitter must never produce a payable file. Belt and
        // braces with CashoutPayoutsTests, from the other side: that one checks
        // the predicate, this one checks nothing comes out.
        var db = NewDb();
        var profile = new Profile { Name = "M", Email = "closed-aba@example.test", Phone = "closed-aba@example.test" };
        db.Profiles.Add(profile);
        db.Set<CashoutRequest>().Add(new CashoutRequest
        {
            UserId = profile.Id, AmountCents = 2500, Bsb = "084234",
            AccountNumber = "123456789", AccountName = "MEMBER NAME", Status = "pending",
        });
        await db.SaveChangesAsync();

        var closed = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ABA_PAYOUTS_ENABLED"] = "true",
            ["ABA_TRACE_BSB"] = CashoutService.PlaceholderTraceBsb,   // the placeholder
            ["ABA_TRACE_ACCOUNT"] = "556677889",
            ["ABA_USER_ID"] = "TAILOR01",
        }).Build();

        Assert.Equal("", await new CashoutService(db, closed).GenerateAbaFile());
        Assert.Equal(1, await db.Set<CashoutRequest>().AsNoTracking().CountAsync(c => c.Status == "pending"));
    }
}
