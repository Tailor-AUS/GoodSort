using System.Text;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Services;

public class CashoutService
{
    public const string PlaceholderTraceBsb = "062000";

    private readonly GoodSortDbContext _db;
    private readonly IConfiguration _config;

    public CashoutService(GoodSortDbContext db, IConfiguration config)
    {
        _db = db;
        _config = config;
    }

    public bool PayoutsOpen() => PayoutsAreOpen(
        _config["ABA_PAYOUTS_ENABLED"],
        _config["ABA_TRACE_BSB"],
        _config["ABA_TRACE_ACCOUNT"],
        _config["ABA_USER_ID"]);

    /// <summary>
    /// Bank files stay closed until Knox sets a real ABA remitter.
    /// The old 062-000 / 12345678 placeholders must never pay anyone.
    /// </summary>
    public static bool PayoutsAreOpen(string? enabled, string? traceBsb, string? traceAccount, string? userId)
    {
        if (!string.Equals(enabled, "true", StringComparison.OrdinalIgnoreCase)) return false;
        var bsb = Digits(traceBsb);
        var account = Digits(traceAccount);
        var user = (userId ?? "").Trim();
        if (bsb.Length != 6 || bsb == PlaceholderTraceBsb) return false;
        if (account.Length < 5 || account.Length > 9 || account == "12345678") return false;
        if (user.Length < 4) return false;
        return true;
    }

    public async Task<(bool Success, string? Error)> RequestCashout(Guid userId, int amountCents, string bsb, string accountNumber, string accountName)
    {
        if (!PayoutsOpen()) return (false, "Payouts are not open yet. Credits stay on your account until bank transfers are live.");
        if (amountCents < 2000) return (false, "Minimum cash-out is $20");

        // Validate BSB (6 digits) and account number (5-9 digits)
        if (bsb.Length != 6 || !bsb.All(char.IsDigit)) return (false, "Invalid BSB");
        if (accountNumber.Length < 5 || accountNumber.Length > 9 || !accountNumber.All(char.IsDigit))
            return (false, "Invalid account number");

        var exists = await _db.Profiles.AsNoTracking().AnyAsync(p => p.Id == userId);
        if (!exists) return (false, "User not found");

        // Deduct before writing the payout row, and deduct conditionally.
        //
        // This used to read ClearedCents, compare it, and write the difference
        // back. Two concurrent requests both read the same balance, both pass
        // the comparison, and both write balance-minus-amount — so the member
        // ends up with two pending CashoutRequest rows and a single deduction.
        // GenerateAbaFile pays every pending row, so that is a real bank
        // transfer of money the member did not have. There is no concurrency
        // token on Profile to catch it.
        //
        // Ordering is deliberate. If the payout row failed to write after a
        // successful deduction the member would be short, which is wrong but
        // recoverable; the reverse would pay out money that was never debited.
        // Deduction and payout row together, or neither. The deduction commits
        // on its own statement, so without this a failure in between debits a
        // member and writes no payout — they are simply short, with nothing to
        // show for it.
        return await Atomic.RunAsync(_db, async () =>
        {
            if (!await TryDeductCleared(userId, amountCents))
                return (false, (string?)"Insufficient balance");

            _db.Set<CashoutRequest>().Add(new CashoutRequest
            {
                UserId = userId,
                AmountCents = amountCents,
                Bsb = bsb,
                AccountNumber = accountNumber,
                AccountName = accountName,
                Status = "pending",
            });
            await _db.SaveChangesAsync();
            return (true, (string?)null);
        });
    }

    /// <summary>
    /// Subtracts the amount only if the balance still covers it, in one
    /// statement. The WHERE clause and the subtraction are evaluated together
    /// by the database, so a second concurrent attempt sees the reduced balance
    /// and affects no rows.
    /// </summary>
    private async Task<bool> TryDeductCleared(Guid userId, int amountCents)
    {
        try
        {
            var rows = await _db.Profiles
                .Where(p => p.Id == userId && p.ClearedCents >= amountCents)
                .ExecuteUpdateAsync(setters =>
                    setters.SetProperty(p => p.ClearedCents, p => p.ClearedCents - amountCents));
            return rows > 0;
        }
        catch (InvalidOperationException)
        {
            // The InMemory provider used by tests and local dev cannot
            // translate ExecuteUpdate. This fallback keeps the balance rule
            // correct but NOT atomic — the atomicity guarantee comes from the
            // single UPDATE above, which is what production runs.
            var profile = await _db.Profiles.FindAsync(userId);
            if (profile is null || profile.ClearedCents < amountCents) return false;
            profile.ClearedCents -= amountCents;
            await _db.SaveChangesAsync();
            return true;
        }
    }

    /// <summary>
    /// Builds the ABA (Cemtex) batch file the bank acts on.
    ///
    /// Every record must be exactly 120 characters. Banks read the fields by
    /// fixed offset, not by delimiter, so a field that is short does not
    /// truncate a value — it slides everything after it to the left. Two were
    /// short here: the descriptive record's description field was 10 instead of
    /// 12, making that record 118, and the file-total record's filler was 6
    /// instead of 24, making it 102 and putting the record count at position 51
    /// where the bank looks at 75.
    ///
    /// AbaFileFormatTests asserts the lengths and the offsets, because this is
    /// not the sort of thing that is obvious by reading: the code carries
    /// correct-looking width comments beside literals that do not match them.
    /// </summary>
    // Generate ABA (Australian Banking Association) file for batch bank transfers
    public async Task<string> GenerateAbaFile()
    {
        if (!PayoutsOpen()) return "";

        // Claim first, then read back what we claimed.
        //
        // This used to select the pending rows, build the file, and mark them
        // processing at the end. Two exports running together both selected the
        // same rows and both emitted them, so two valid files existed for one
        // set of payments — and if both reached the bank, everyone in them was
        // paid twice.
        //
        // Claiming stamps a batch id in the same statement that moves the row
        // out of "pending", so a second export finds nothing left to claim and
        // returns an empty file rather than a duplicate one.
        //
        // Claiming before building means a failure between the two leaves
        // payments marked processing with no file. That direction is deliberate:
        // nobody is paid, which an admin can recover from via the batch id,
        // whereas the other direction pays twice and cannot be undone.
        // Claim and build together. The claim commits on its own statement, so
        // without a transaction a failure while building the file — a malformed
        // account name, a formatting slip — leaves those payments marked
        // processing with no file. They are then invisible to the next export,
        // which only looks at "pending", so nobody is paid until someone
        // intervenes by hand.
        //
        // I called this direction "safe" in #42 on the grounds that nobody is
        // overpaid. Nobody being paid at all is not safe, it is just quiet.
        // Rolling back returns them to pending and the next export takes them.
        return await Atomic.RunAsync(_db, async () =>
        {
        var batchId = Guid.NewGuid();
        var claimed = await ClaimPendingInto(batchId);
        if (claimed == 0) return "";

        var pending = await _db.Set<CashoutRequest>()
            .Where(c => c.BatchId == batchId)
            .Include(c => c.User)
            .ToListAsync();

        if (pending.Count == 0) return "";

        var sb = new StringBuilder();
        // The Brisbane business date, not UTC's. The container has no timezone,
        // so DateTime.Now was DateTime.UtcNow — and for the first ten hours of
        // every local day that stamps a bank file with yesterday's date. A
        // payment date in the past is the kind of thing a bank rejects the file
        // over, and the file is generated by hand rarely enough that nobody
        // would connect the two.
        var now = BrisbaneTime.Now;

        // Record 0: Descriptive Record
        sb.AppendLine(
            "0" +                                           // Record Type
            "                 " +                           // Blank (17)
            "01" +                                          // Reel Sequence
            "WBC" +                                         // Bank (Westpac example)
            "       " +                                     // Blank (7)
            Pad26(_config["ABA_USER_NAME"] ?? "TAILOR INTELLIGENCE") + // User Name (26)
            (_config["ABA_USER_ID"] ?? "").Trim().PadRight(6).Substring(0, 6) + // User ID (6)
            "PAYMENTS".PadRight(12) +                       // Description (12)
            now.ToString("ddMMyy") +                        // Date
            "                                        "      // Blank (40)
        );

        var totalAmount = 0;
        var recordCount = 0;

        // Record 1: Detail Records
        foreach (var cashout in pending)
        {
            var amount = cashout.AmountCents;
            totalAmount += amount;
            recordCount++;

            sb.AppendLine(
                "1" +                                       // Record Type
                cashout.Bsb!.Insert(3, "-") +               // BSB (7 with hyphen)
                cashout.AccountNumber!.PadRight(9) +        // Account Number (9)
                " " +                                       // Indicator
                "53" +                                      // Transaction Code (53 = Pay)
                (amount).ToString().PadLeft(10, '0') +      // Amount in cents (10)
                cashout.AccountName!.PadRight(32).Substring(0, 32) + // Title (32)
                "GOODSORT PAYOUT   " +                      // Lodgement Ref (18)
                FormatBsb(Digits(_config["ABA_TRACE_BSB"])) + // Trace BSB (7)
                Digits(_config["ABA_TRACE_ACCOUNT"]).PadRight(9).Substring(0, 9) + // Trace Account (9)
                Pad16(_config["ABA_REMITTER"] ?? "THE GOOD SORT") + // Remitter (16)
                "00000000"                                  // Withholding Tax (8)
            );
        }

        // Record 7: File Total Record
        sb.AppendLine(
            "7" +                                           // Record Type
            "999-999" +                                     // BSB
            "            " +                                // Blank (12)
            totalAmount.ToString().PadLeft(10, '0') +       // File Total (10)
            totalAmount.ToString().PadLeft(10, '0') +       // File Credit Total (10)
            "0000000000" +                                  // File Debit Total (10)
            new string(' ', 24) +                           // Blank (24) — positions 51-74
            recordCount.ToString().PadLeft(6, '0') +        // Record Count (6) — positions 75-80
            "                                        "      // Blank (40)
        );

        // Status and BatchId were written by the claim above; only the
        // timestamp is left, and it is set on the rows this export owns.
        var processedAt = DateTime.UtcNow;
        foreach (var cashout in pending)
            cashout.ProcessedAt = processedAt;
        await _db.SaveChangesAsync();

        return sb.ToString();
        });
    }

    /// <summary>
    /// Moves every pending payout into one batch in a single statement, so two
    /// exports cannot both take the same rows. Returns how many were claimed.
    /// </summary>
    private async Task<int> ClaimPendingInto(Guid batchId)
    {
        try
        {
            return await _db.Set<CashoutRequest>()
                .Where(c => c.Status == "pending")
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(c => c.Status, "processing")
                    .SetProperty(c => c.BatchId, batchId));
        }
        catch (InvalidOperationException)
        {
            // InMemory (tests, local dev) cannot translate ExecuteUpdate. Keeps
            // the batching correct but NOT atomic; the atomicity comes from the
            // single UPDATE above, which is what production runs.
            // SqlConcurrencyTests covers the real behaviour.
            var rows = await _db.Set<CashoutRequest>().Where(c => c.Status == "pending").ToListAsync();
            foreach (var row in rows)
            {
                row.Status = "processing";
                row.BatchId = batchId;
            }
            if (rows.Count > 0) await _db.SaveChangesAsync();
            return rows.Count;
        }
    }

    private static string Digits(string? raw) =>
        new string((raw ?? "").Where(char.IsDigit).ToArray());

    private static string FormatBsb(string digits6) =>
        digits6.Length == 6 ? digits6.Insert(3, "-") : "000-000";

    private static string Pad26(string name) =>
        name.Trim().ToUpperInvariant().PadRight(26).Substring(0, 26);

    private static string Pad16(string name) =>
        name.Trim().ToUpperInvariant().PadRight(16).Substring(0, 16);
}

public class CashoutRequest
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Profile User { get; set; } = null!;
    public int AmountCents { get; set; }
    public string? Bsb { get; set; }
    public string? AccountNumber { get; set; }
    public string? AccountName { get; set; }
    public string Status { get; set; } = "pending";

    /// <summary>
    /// Which export claimed this payment. Set by GenerateAbaFile as part of the
    /// same statement that moves the row out of "pending", so an export can
    /// select back exactly the rows it claimed and never a row another export
    /// took. Also makes a produced file reproducible: the batch is a stable
    /// handle if a file is lost between generating it and sending it.
    /// </summary>
    public Guid? BatchId { get; set; }

    public DateTime? ProcessedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
