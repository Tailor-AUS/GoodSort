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
    public async Task Concurrent_ABA_exports_never_emit_the_same_payment_twice()
    {
        Skip.IfNot(_sql.Available, SqlServerFixture.SkipReason);

        // Two staff hitting Export at once used to produce two valid files
        // containing the same payments. If both reached the bank, everyone in
        // them was paid twice.
        var amounts = new[] { 2100, 2200, 2300, 2400, 2500 };
        foreach (var amount in amounts)
        {
            var userId = await _sql.SeedProfile(clearedCents: 0);
            await using var seed = _sql.NewContext();
            seed.Set<CashoutRequest>().Add(new CashoutRequest
            {
                UserId = userId, AmountCents = amount, Bsb = "084234",
                AccountNumber = "123456789", AccountName = "MEMBER NAME", Status = "pending",
            });
            await seed.SaveChangesAsync();
        }

        var files = await Concurrently(Concurrency, db =>
            new CashoutService(db, OpenPayouts()).GenerateAbaFile());

        var produced = files.Where(f => !string.IsNullOrEmpty(f)).ToList();

        // Every payment must appear in exactly one file, across all of them.
        var paymentLines = produced
            .SelectMany(f => f.Split('\n').Select(l => l.TrimEnd('\r')))
            .Where(l => l.StartsWith('1'))
            .ToList();

        Assert.Equal(amounts.Length, paymentLines.Count);
        Assert.Equal(amounts.Length, paymentLines.Distinct().Count());

        await using var check = _sql.NewContext();
        var rows = await check.Set<CashoutRequest>().AsNoTracking().ToListAsync();
        Assert.All(rows, r => Assert.Equal("processing", r.Status));

        // Whichever export won, all five rows belong to one batch — nothing
        // was split across two files.
        Assert.Single(rows.Select(r => r.BatchId).Distinct());
    }

    [SkippableFact]
    public async Task Only_one_replica_wins_the_background_pass()
    {
        Skip.IfNot(_sql.Available, SqlServerFixture.SkipReason);

        // The exclusion the whole lease exists for. Hosted services run inside
        // every container instance and this app scales to ten, so without it
        // ten replicas generate runs over the same bins at once — several
        // drivers paid to collect the same containers.
        //
        // Each simulated replica gets its own holder id, or the already-ours
        // branch would match for all of them and every one would "win".
        var name = $"race-{Guid.NewGuid():N}";

        var results = await Concurrently(Concurrency, db =>
            SingletonLease.TryAcquire(db, name, TimeSpan.FromMinutes(60), holder: Guid.NewGuid()));

        Assert.Equal(1, results.Count(won => won));

        await using var check = _sql.NewContext();
        Assert.Equal(1, await check.SingletonLeases.AsNoTracking().CountAsync(l => l.Name == name));
    }

    [SkippableFact]
    public async Task After_the_lease_expires_exactly_one_replica_takes_it_again()
    {
        Skip.IfNot(_sql.Available, SqlServerFixture.SkipReason);

        // The recovery path under contention: when a holder dies, the next pass
        // must be picked up by one replica, not by all of them at once.
        var name = $"expiry-{Guid.NewGuid():N}";

        await using (var seed = _sql.NewContext())
        {
            // Already expired.
            Assert.True(await SingletonLease.TryAcquire(
                seed, name, TimeSpan.FromMinutes(-1), DateTime.UtcNow, Guid.NewGuid()));
        }

        var results = await Concurrently(Concurrency, db =>
            SingletonLease.TryAcquire(db, name, TimeSpan.FromMinutes(60), holder: Guid.NewGuid()));

        Assert.Equal(1, results.Count(won => won));
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
