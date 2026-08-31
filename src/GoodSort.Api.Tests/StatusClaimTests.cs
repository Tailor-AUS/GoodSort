using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Tests;

/// <summary>
/// Settlement must happen once.
///
/// Both settle endpoints used to read a status, compare it, then write the new
/// status and hand out money. Everything after that comparison credits: the
/// runner's ClearedCents, and every picked-up stop moving its household's
/// pending credit to cleared. Running it twice does not merely over-pay an
/// existing balance — it mints cash-out-eligible money that was never scanned.
/// A double-tap on a Settle button is enough to send two requests.
///
/// The same limitation applies as in CashoutBalanceTests: these prove the
/// transition RULE, and would still pass against a read-compare-write
/// implementation, because the InMemory provider cannot run two contexts
/// concurrently and cannot translate ExecuteUpdate either. The atomicity is a
/// property of the single UPDATE that SQL Server runs. What these do catch is
/// the status condition being dropped or the transition being made repeatable,
/// which is confirmed by mutation: removing the status condition fails four of
/// these, and neutering the guard fails five.
///
/// Sharper still, and worth knowing before trusting this file: the
/// ExecuteUpdate branch is never executed here at all. InMemory throws on it,
/// so every test takes the fallback. Replacing `return rows > 0` with
/// `return true` in the production branch leaves all six green. Coverage of
/// that branch is zero, and only a SQL-backed test could change that.
/// </summary>
public class StatusClaimTests
{
    private static GoodSortDbContext NewDb() =>
        new(new DbContextOptionsBuilder<GoodSortDbContext>()
            .UseInMemoryDatabase($"claim-{Guid.NewGuid():N}").Options);

    private static async Task<(GoodSortDbContext Db, Guid Id)> RouteAt(string status)
    {
        var db = NewDb();
        var route = new CollectionRoute { Status = status, DepotId = Guid.NewGuid() };
        db.Routes.Add(route);
        await db.SaveChangesAsync();
        return (db, route.Id);
    }

    private static async Task<(GoodSortDbContext Db, Guid Id)> RunAt(string status)
    {
        var db = NewDb();
        var run = new Run { Status = status };
        db.Runs.Add(run);
        await db.SaveChangesAsync();
        return (db, run.Id);
    }

    [Fact]
    public async Task A_route_settles_once_and_only_once()
    {
        var (db, id) = await RouteAt("at_depot");

        Assert.True(await StatusClaim.TryClaimRoute(db, id, "at_depot", "settled"),
            "The first settle must win the transition.");
        Assert.False(await StatusClaim.TryClaimRoute(db, id, "at_depot", "settled"),
            "A second settle must be refused — everything after it credits money.");

        var stored = await db.Routes.AsNoTracking().FirstAsync(r => r.Id == id);
        Assert.Equal("settled", stored.Status);
        Assert.NotNull(stored.SettledAt);
    }

    [Fact]
    public async Task A_run_settles_once_and_only_once()
    {
        var (db, id) = await RunAt("completed");

        Assert.True(await StatusClaim.TryClaimRun(db, id, "completed", "settled"));
        Assert.False(await StatusClaim.TryClaimRun(db, id, "completed", "settled"));

        var stored = await db.Runs.AsNoTracking().FirstAsync(r => r.Id == id);
        Assert.Equal("settled", stored.Status);
    }

    [Fact]
    public async Task A_route_in_the_wrong_state_is_not_claimed()
    {
        // A route still being driven must not settle. The claim is the only
        // thing standing between "in progress" and a driver payout.
        var (db, id) = await RouteAt("in_progress");

        Assert.False(await StatusClaim.TryClaimRoute(db, id, "at_depot", "settled"));

        var stored = await db.Routes.AsNoTracking().FirstAsync(r => r.Id == id);
        Assert.Equal("in_progress", stored.Status);
        Assert.Null(stored.SettledAt);
    }

    [Fact]
    public async Task A_missing_route_is_not_claimed()
    {
        var db = NewDb();
        Assert.False(await StatusClaim.TryClaimRoute(db, Guid.NewGuid(), "at_depot", "settled"));
    }

    [Fact]
    public async Task Claiming_ten_times_succeeds_exactly_once()
    {
        // The shape of the double-tap, exaggerated. One winner, nine refusals.
        var (db, id) = await RouteAt("at_depot");

        var wins = 0;
        for (var i = 0; i < 10; i++)
            if (await StatusClaim.TryClaimRoute(db, id, "at_depot", "settled")) wins++;

        Assert.Equal(1, wins);
    }

    [Fact]
    public async Task Two_different_routes_both_settle()
    {
        // The claim must reject repeats, not settlement itself.
        var (db, first) = await RouteAt("at_depot");
        var second = new CollectionRoute { Status = "at_depot", DepotId = Guid.NewGuid() };
        db.Routes.Add(second);
        await db.SaveChangesAsync();

        Assert.True(await StatusClaim.TryClaimRoute(db, first, "at_depot", "settled"));
        Assert.True(await StatusClaim.TryClaimRoute(db, second.Id, "at_depot", "settled"));
    }
}
