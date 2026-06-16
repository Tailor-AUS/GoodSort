using System.Text;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Services;

public class CashoutService
{
    private readonly GoodSortDbContext _db;
    private readonly IConfiguration _config;

    public CashoutService(GoodSortDbContext db, IConfiguration config)
    {
        _db = db;
        _config = config;
    }

    // Single-payout sanity ceiling ($5,000). A request above this is almost
    // certainly an error or fraud attempt; reject rather than auto-queue it into
    // a bank file. Override with CASHOUT_MAX_CENTS.
    private int MaxCashoutCents =>
        int.TryParse(_config["CASHOUT_MAX_CENTS"], out var v) ? v : 500_000;

    public async Task<(bool Success, string? Error)> RequestCashout(Guid userId, int amountCents, string bsb, string accountNumber, string accountName)
    {
        var profile = await _db.Profiles.FindAsync(userId);
        if (profile is null) return (false, "User not found");
        if (amountCents < 2000) return (false, "Minimum cash-out is $20"); // also rejects zero/negative
        if (amountCents > MaxCashoutCents) return (false, $"Amount exceeds the ${MaxCashoutCents / 100:N0} single cash-out limit. Contact support.");
        if (profile.ClearedCents < amountCents) return (false, "Insufficient balance");

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

        // Settlement (source-of-funds) details. These MUST be GoodSort's real
        // APCA user id + funding account or the bank rejects the file — so fail
        // loud (on null OR empty) rather than silently emit the old placeholder
        // 062-000 / 12345678. See infra/aba-settlement.md for how to set these.
        string Required(string key, string hint)
        {
            var v = _config[key];
            if (string.IsNullOrWhiteSpace(v))
                throw new InvalidOperationException(
                    $"{key} is not configured — refusing to generate a bank file the bank will reject. {hint} See infra/aba-settlement.md.");
            return v;
        }

        var bankCode = (_config["ABA_BANK_CODE"] ?? "WBC").ToUpperInvariant();
        var userName = _config["ABA_USER_NAME"] ?? "THE GOOD SORT PTY LTD";
        var remitter = _config["ABA_REMITTER"] ?? "THE GOOD SORT";
        var userId = Required("ABA_USER_ID", "Set GoodSort's real APCA user id.");
        var traceBsb = Required("ABA_TRACE_BSB", "Set the source-of-funds BSB (e.g. 032-000).");
        var traceAccount = Required("ABA_TRACE_ACCOUNT", "Set the source-of-funds account number.");

        var sb = new StringBuilder();
        var now = DateTime.UtcNow;

        // Record 0: Descriptive Record
        sb.AppendLine(
            "0" +                                           // Record Type
            new string(' ', 17) +                           // Blank (17)
            "01" +                                          // Reel Sequence
            AbaText(bankCode, 3) +                           // Bank (3)
            new string(' ', 7) +                            // Blank (7)
            AbaText(userName, 26) +                          // User Name (26)
            AbaText(userId, 6) +                             // User ID / APCA (6)
            "PAYMENTS  " +                                  // Description (12)
            now.ToString("ddMMyy") +                        // Date (6)
            new string(' ', 40)                             // Blank (40)
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
                AbaText(cashout.AccountNumber, 9) +         // Account Number (9)
                " " +                                       // Indicator
                "53" +                                      // Transaction Code (53 = Pay)
                amount.ToString().PadLeft(10, '0') +        // Amount in cents (10)
                AbaText(cashout.AccountName, 32) +          // Title (32) — sanitised (anti-injection)
                "GOODSORT PAYOUT   " +                      // Lodgement Ref (18)
                AbaText(traceBsb, 7) +                       // Trace BSB (7)
                AbaText(traceAccount, 9) +                   // Trace Account (9)
                AbaText(remitter, 16) +                      // Remitter (16)
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

    // ABA records are fixed-width ASCII. Strip anything non-printable — a newline
    // injected via a user-supplied account name would otherwise split the
    // line-delimited file and corrupt the batch — then pad/truncate to the exact
    // field width so a mis-sized config value can't shift every downstream column.
    private static string AbaText(string? s, int width)
    {
        var clean = new string((s ?? "").Where(c => c >= ' ' && c <= '~').ToArray());
        return clean.Length >= width ? clean[..width] : clean.PadRight(width);
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
