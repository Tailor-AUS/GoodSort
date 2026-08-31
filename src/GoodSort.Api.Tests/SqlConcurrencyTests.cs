using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace GoodSort.Api.Tests;

/// <summary>
/// The concurrency tests that actually mean something.
///
/// Every other test in this project runs on the InMemory provider, and for the
/// money paths that makes them weaker than they look. InMemory cannot translate
/// ExecuteUpdate, so each of those calls falls back to a non-atomic path and it
/// is the fallback the tests exercise — the production branch has no coverage
/// at all. InMemory also cannot run two contexts committing at once, so a
/// read-compare-write implementation passes exactly the same assertions as the
/// atomic one. I confirmed both by mutation: replacing `return rows > 0` with
/// `return true` in StatusClaim left its whole suite green, and restoring the
/// original read-compare-write in CashoutService left all seven of its tests
/// green.
///
/// These run against a real SQL Server and fire genuinely concurrent requests,
/// each with its own DbContext, the way two HTTP requests would. That is the
/// only way to demonstrate that the fixes in #34, #36 and #37 hold.
///
/// They are skipped unless GOODSORT_TEST_SQL is set, so a developer without a
/// database still gets a green local run. CI sets it from a SQL Server service
/// container, so they are not optional there.
/// </summary>
[Collection("sql")]
public class SqlConcurrencyTests : IClassFixture<SqlServerFixture>
{
    private readonly SqlServerFixture _sql;
    public SqlConcurrencyTests(SqlServerFixture sql) => _sql = sql;

    private const int Concurrency = 8;

    private static IConfiguration OpenPayouts() =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ABA_PAYOUTS_ENABLED"] = "true",
            ["ABA_TRACE_BSB"] = "084234",
            ["ABA_TRACE_ACCOUNT"] = "556677889",
            ["ABA_USER_ID"] = "TAILOR01",
            ["JWT_SECRET"] = "test-only-signing-key-not-a-real-secret-0123456789",
        }).Build();

    /// <summary>Fires <paramref name="count"/> operations at once, each on its own context.</summary>
    private async Task<T[]> Concurrently<T>(int count, Func<GoodSortDbContext, Task<T>> work)
    {
        // A barrier makes the requests genuinely overlap. Without it they tend
        // to serialise and the test proves nothing.
        using var gate = new SemaphoreSlim(0, count);
        var tasks = Enumerable.Range(0, count).Select(async _ =>
        {
            await using var db = _sql.NewContext();
            await gate.WaitAsync();
            return await work(db);
        }).ToArray();

        await Task.Delay(150);
        gate.Release(count);
        return await Task.WhenAll(tasks);
    }

    [SkippableFact]
    public async Task Concurrent_cash_outs_cannot_spend_the_same_balance_twice()
    {
        Skip.IfNot(_sql.Available, SqlServerFixture.SkipReason);

        var userId = await _sql.SeedProfile(clearedCents: 2000);

        var results = await Concurrently(Concurrency, async db =>
        {
            var svc = new CashoutService(db, OpenPayouts());
            var (ok, _) = await svc.RequestCashout(userId, 2000, "084234", "123456789", "Test Member");
            return ok;
        });

        await using var check = _sql.NewContext();
        var cleared = (await check.Profiles.AsNoTracking().FirstAsync(p => p.Id == userId)).ClearedCents;
        var payouts = await check.Set<CashoutRequest>().AsNoTracking().CountAsync(c => c.UserId == userId);

        Assert.Equal(1, results.Count(ok => ok));
        Assert.Equal(1, payouts);   // GenerateAbaFile pays every pending row
        Assert.Equal(0, cleared);
    }

    [SkippableFact]
    public async Task Concurrent_settles_claim_a_route_exactly_once()
    {
        Skip.IfNot(_sql.Available, SqlServerFixture.SkipReason);

        var routeId = await _sql.SeedRoute("at_depot");

        var results = await Concurrently(Concurrency, db =>
            StatusClaim.TryClaimRoute(db, routeId, "at_depot", "settled"));

        Assert.Equal(1, results.Count(won => won));

        await using var check = _sql.NewContext();
        var route = await check.Routes.AsNoTracking().FirstAsync(r => r.Id == routeId);
        Assert.Equal("settled", route.Status);
    }

    [SkippableFact]
    public async Task Concurrent_settles_claim_a_run_exactly_once()
    {
        Skip.IfNot(_sql.Available, SqlServerFixture.SkipReason);

        var runId = await _sql.SeedRun("completed");

        var results = await Concurrently(Concurrency, db =>
            StatusClaim.TryClaimRun(db, runId, "completed", "settled"));

        Assert.Equal(1, results.Count(won => won));
    }

    [SkippableFact]
    public async Task Concurrent_confirms_of_one_scan_token_are_spent_once()
    {
        Skip.IfNot(_sql.Available, SqlServerFixture.SkipReason);

        // The UsedScanToken primary key is what makes this safe. Insert-then-
        // catch: several inserts race, exactly one commits.
        var jti = Guid.NewGuid();
        var userId = await _sql.SeedProfile(clearedCents: 0);

        var results = await Concurrently(Concurrency, async db =>
        {
            db.UsedScanTokens.Add(new UsedScanToken { Jti = jti, UserId = userId });
            try
            {
                await db.SaveChangesAsync();
                return true;
            }
            catch (Exception ex) when (ex is DbUpdateException or InvalidOperationException or ArgumentException)
            {
                return false;
            }
        });

        Assert.Equal(1, results.Count(ok => ok));

        await using var check = _sql.NewContext();
        Assert.Equal(1, await check.UsedScanTokens.AsNoTracking().CountAsync(t => t.Jti == jti));
    }

    [SkippableFact]
    public async Task Concurrent_cash_outs_below_the_balance_all_settle_correctly()
    {
        Skip.IfNot(_sql.Available, SqlServerFixture.SkipReason);

        // The guard must not simply refuse everything under load. With enough
        // balance for three, exactly three succeed and the arithmetic holds.
        var userId = await _sql.SeedProfile(clearedCents: 6000);

        var results = await Concurrently(Concurrency, async db =>
        {
            var svc = new CashoutService(db, OpenPayouts());
            var (ok, _) = await svc.RequestCashout(userId, 2000, "084234", "123456789", "Test Member");
            return ok;
        });

        await using var check = _sql.NewContext();
        var cleared = (await check.Profiles.AsNoTracking().FirstAsync(p => p.Id == userId)).ClearedCents;
        var payouts = await check.Set<CashoutRequest>().AsNoTracking().CountAsync(c => c.UserId == userId);

        Assert.Equal(3, results.Count(ok => ok));
        Assert.Equal(3, payouts);
        Assert.Equal(0, cleared);
    }
}
