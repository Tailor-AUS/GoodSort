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

        var profile = await _db.Profiles.FindAsync(userId);
        if (profile is null) return (false, "User not found");
        if (profile.ClearedCents < amountCents) return (false, "Insufficient balance");
        profile.ClearedCents -= amountCents;

        var request = new CashoutRequest
        {
            UserId = userId,
            AmountCents = amountCents,
            Bsb = bsb,
            AccountNumber = accountNumber,
            AccountName = accountName,
            Status = "pending",
        };
        _db.Set<CashoutRequest>().Add(request);
        await _db.SaveChangesAsync();
        return (true, null);
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

    // Generate ABA (Australian Banking Association) file for batch bank transfers
    public async Task<string> GenerateAbaFile()
    {
        if (!PayoutsOpen()) return "";

        var pending = await _db.Set<CashoutRequest>()
            .Where(c => c.Status == "pending")
            .Include(c => c.User)
            .ToListAsync();

        if (pending.Count == 0) return "";

        var sb = new StringBuilder();
        var now = DateTime.Now;

        // Record 0: Descriptive Record
        sb.AppendLine(
            "0" +                                           // Record Type
            "                 " +                           // Blank (17)
            "01" +                                          // Reel Sequence
            "WBC" +                                         // Bank (Westpac example)
            "       " +                                     // Blank (7)
            Pad26(_config["ABA_USER_NAME"] ?? "TAILOR INTELLIGENCE") + // User Name (26)
            (_config["ABA_USER_ID"] ?? "").Trim().PadRight(6).Substring(0, 6) + // User ID (6)
            "PAYMENTS  " +                                  // Description (12)
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
            "      " +                                      // Blank (6)
            recordCount.ToString().PadLeft(6, '0') +        // Record Count (6)
            "                                        "      // Blank (40)
        );

        // Mark as processing
        foreach (var cashout in pending)
            cashout.Status = "processing";
        await _db.SaveChangesAsync();

        return sb.ToString();
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
    public DateTime? ProcessedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
