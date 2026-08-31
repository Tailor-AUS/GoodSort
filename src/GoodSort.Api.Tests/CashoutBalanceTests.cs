using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace GoodSort.Api.Tests;

/// <summary>
/// The balance rules on the way out of the product.
///
/// CashoutPayoutsTests covers whether payouts are open at all. Nothing covered
/// RequestCashout itself — the method that decides how much of a member's money
/// leaves in an ABA file. Payouts are closed in production today, so none of
/// this is currently reachable; that is exactly why it is worth pinning before
/// Knox sets a real remitter and it becomes live.
///
/// What these DO cover, confirmed by mutation: removing the balance condition
/// from the conditional update fails three of them, validating the BSB after
/// the deduction fails one, and dropping the $20 minimum fails two.
///
/// What they do NOT cover: the concurrency race itself. Restoring the original
/// read-compare-write leaves all seven green, because a single DbContext tracks
/// one Profile instance and the second call sees the balance the first already
/// reduced. The race needs two contexts committing at once, and the InMemory
/// provider cannot express it — it also cannot translate ExecuteUpdate, so the
/// fallback these tests exercise is check-then-act as well. The atomicity
/// guarantee is a property of the single UPDATE statement SQL Server runs in
/// production. Nothing here demonstrates it, so do not read these as proof the
/// race is closed.
/// </summary>
public class CashoutBalanceTests
{
    /// <summary>Config that opens payouts — real-looking remitter, no placeholders.</summary>
    private static IConfiguration OpenPayouts() =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ABA_PAYOUTS_ENABLED"] = "true",
            ["ABA_TRACE_BSB"] = "084234",
            ["ABA_TRACE_ACCOUNT"] = "556677889",
            ["ABA_USER_ID"] = "TAILOR01",
        }).Build();

    private static GoodSortDbContext NewDb() =>
        new(new DbContextOptionsBuilder<GoodSortDbContext>()
            .UseInMemoryDatabase($"cashout-{Guid.NewGuid():N}").Options);

    private static async Task<(GoodSortDbContext Db, CashoutService Svc, Guid UserId)> WithBalance(int clearedCents)
    {
        var db = NewDb();
        var profile = new Profile { Name = "Test", Email = "cashout@example.test", Phone = "cashout@example.test", ClearedCents = clearedCents };
        db.Profiles.Add(profile);
        await db.SaveChangesAsync();
        return (db, new CashoutService(db, OpenPayouts()), profile.Id);
    }

    private static Task<(bool Success, string? Error)> Request(CashoutService svc, Guid userId, int cents) =>
        svc.RequestCashout(userId, cents, "084234", "123456789", "Test Member");

    private static async Task<int> Cleared(GoodSortDbContext db, Guid userId) =>
        (await db.Profiles.AsNoTracking().FirstAsync(p => p.Id == userId)).ClearedCents;

    private static Task<int> PendingRows(GoodSortDbContext db, Guid userId) =>
        db.Set<CashoutRequest>().AsNoTracking().CountAsync(c => c.UserId == userId && c.Status == "pending");

    [Fact]
    public async Task A_cashout_debits_exactly_what_it_pays()
    {
        var (db, svc, userId) = await WithBalance(5000);

        var (ok, error) = await Request(svc, userId, 2000);

        Assert.True(ok, error);
        Assert.Equal(3000, await Cleared(db, userId));
        Assert.Equal(1, await PendingRows(db, userId));
    }

    [Fact]
    public async Task The_balance_cannot_be_spent_twice()
    {
        // The double-spend in its plainest form. GenerateAbaFile pays every
        // pending row, so a second accepted request here is a second real bank
        // transfer against money that is already gone.
        var (db, svc, userId) = await WithBalance(2000);

        var first = await Request(svc, userId, 2000);
        var second = await Request(svc, userId, 2000);

        Assert.True(first.Success, first.Error);
        Assert.False(second.Success, "A second cash-out of an already-spent balance must be refused.");
        Assert.Equal(0, await Cleared(db, userId));
        Assert.Equal(1, await PendingRows(db, userId));
    }

    [Fact]
    public async Task A_balance_can_never_go_negative()
    {
        var (db, svc, userId) = await WithBalance(2500);

        // Enough to clear the $20 minimum, more than the member holds.
        var (ok, _) = await Request(svc, userId, 2400);
        Assert.True(ok);

        var (again, _) = await Request(svc, userId, 2000);
        Assert.False(again);

        var remaining = await Cleared(db, userId);
        Assert.Equal(100, remaining);
        Assert.True(remaining >= 0, "A cash-out must never overdraw a member.");
    }

    [Fact]
    public async Task Asking_for_more_than_the_balance_is_refused_and_changes_nothing()
    {
        var (db, svc, userId) = await WithBalance(2000);

        var (ok, error) = await Request(svc, userId, 5000);

        Assert.False(ok);
        Assert.Equal("Insufficient balance", error);
        Assert.Equal(2000, await Cleared(db, userId));
        Assert.Equal(0, await PendingRows(db, userId));
    }

    [Fact]
    public async Task A_rejected_request_never_debits()
    {
        // Validation must happen before the deduction. Taking the money and
        // then refusing on a malformed BSB would leave the member short with
        // nothing to show for it.
        var (db, svc, userId) = await WithBalance(5000);

        var badBsb = await svc.RequestCashout(userId, 2000, "12", "123456789", "Test Member");
        var badAccount = await svc.RequestCashout(userId, 2000, "084234", "1", "Test Member");
        var belowMinimum = await Request(svc, userId, 1999);

        Assert.False(badBsb.Success);
        Assert.False(badAccount.Success);
        Assert.False(belowMinimum.Success);

        Assert.Equal(5000, await Cleared(db, userId));
        Assert.Equal(0, await PendingRows(db, userId));
    }

    [Fact]
    public async Task A_negative_amount_cannot_be_used_to_mint_credit()
    {
        // Without the minimum check this would ADD to the balance: subtracting
        // a negative. The minimum happens to block it, so this test exists to
        // notice if that check is ever relaxed or reordered.
        var (db, svc, userId) = await WithBalance(5000);

        var (ok, _) = await Request(svc, userId, -10000);

        Assert.False(ok);
        Assert.Equal(5000, await Cleared(db, userId));
        Assert.Equal(0, await PendingRows(db, userId));
    }

    [Fact]
    public async Task Nothing_is_debited_while_payouts_are_closed()
    {
        var db = NewDb();
        var profile = new Profile { Name = "Test", Email = "closed@example.test", Phone = "closed@example.test", ClearedCents = 5000 };
        db.Profiles.Add(profile);
        await db.SaveChangesAsync();

        // Default config: no ABA settings at all, so payouts are shut.
        var svc = new CashoutService(db, new ConfigurationBuilder().Build());
        var (ok, _) = await Request(svc, profile.Id, 2000);

        Assert.False(ok);
        Assert.Equal(5000, await Cleared(db, profile.Id));
        Assert.Equal(0, await PendingRows(db, profile.Id));
    }
}
