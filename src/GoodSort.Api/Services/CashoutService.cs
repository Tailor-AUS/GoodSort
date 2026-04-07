using System.Text;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Services;

public class CashoutService
{
    private readonly GoodSortDbContext _db;

    public CashoutService(GoodSortDbContext db) => _db = db;

    public async Task<(bool Success, string? Error)> RequestCashout(Guid userId, int amountCents, string bsb, string accountNumber, string accountName)
    {
        var profile = await _db.Profiles.FindAsync(userId);
        if (profile is null) return (false, "User not found");
        if (profile.ClearedCents < amountCents) return (false, "Insufficient balance");
        if (amountCents < 2000) return (false, "Minimum cash-out is $20");

        // Validate BSB (6 digits) and account number (5-9 digits)
        if (bsb.Length != 6 || !bsb.All(char.IsDigit)) return (false, "Invalid BSB");
        if (accountNumber.Length < 5 || accountNumber.Length > 9 || !accountNumber.All(char.IsDigit))
            return (false, "Invalid account number");

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

    // Generate ABA (Australian Banking Association) file for batch bank transfers
    public async Task<string> GenerateAbaFile()
    {
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
            "THE GOOD SORT PTY LTD     " +                  // User Name (26)
            "301500" +                                      // User ID (6)
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
                "062-000" +                                 // Trace BSB (7)
                "12345678 " +                               // Trace Account (9)
                "THE GOOD SORT     " +                      // Remitter (16)
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
