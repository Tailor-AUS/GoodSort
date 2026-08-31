using GoodSort.Api.Data;
using GoodSort.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Tests;

/// <summary>
/// Lease semantics: expiry, re-entrancy and release.
///
/// The exclusion itself — several replicas racing and exactly one winning —
/// cannot be shown here, for the reason recorded across the other suites: the
/// InMemory provider cannot translate ExecuteUpdate and cannot run two contexts
/// at once. SqlConcurrencyTests does that against a real database.
///
/// What these pin is the behaviour that decides whether the lease is usable at
/// all. A lease that never expires stops the pass forever the first time a
/// replica dies holding it, and that failure is silent — runs simply stop being
/// generated.
/// </summary>
public class SingletonLeaseTests
{
    private static GoodSortDbContext NewDb() =>
        new(new DbContextOptionsBuilder<GoodSortDbContext>()
            .UseInMemoryDatabase($"lease-{Guid.NewGuid():N}").Options);

    private static readonly Guid ReplicaA = Guid.NewGuid();
    private static readonly Guid ReplicaB = Guid.NewGuid();
    private static readonly DateTime T0 = new(2026, 8, 31, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task An_unheld_lease_is_taken()
    {
        using var db = NewDb();
        Assert.True(await SingletonLease.TryAcquire(db, "pass", TimeSpan.FromMinutes(60), T0, ReplicaA));
    }

    [Fact]
    public async Task A_second_replica_is_refused_while_the_lease_is_held()
    {
        using var db = NewDb();
        Assert.True(await SingletonLease.TryAcquire(db, "pass", TimeSpan.FromMinutes(60), T0, ReplicaA));
        Assert.False(await SingletonLease.TryAcquire(db, "pass", TimeSpan.FromMinutes(60), T0.AddMinutes(5), ReplicaB));
    }

    [Fact]
    public async Task The_holder_may_take_its_own_lease_again()
    {
        // A replica that keeps running must not lock itself out on the next pass.
        using var db = NewDb();
        Assert.True(await SingletonLease.TryAcquire(db, "pass", TimeSpan.FromMinutes(60), T0, ReplicaA));
        Assert.True(await SingletonLease.TryAcquire(db, "pass", TimeSpan.FromMinutes(60), T0.AddMinutes(5), ReplicaA));
    }

    [Fact]
    public async Task An_expired_lease_is_taken_by_whoever_asks_next()
    {
        // The recovery path. A replica that dies holding the lease must not stop
        // the pass forever — runs would simply cease being generated, quietly.
        using var db = NewDb();
        Assert.True(await SingletonLease.TryAcquire(db, "pass", TimeSpan.FromMinutes(60), T0, ReplicaA));
        Assert.False(await SingletonLease.TryAcquire(db, "pass", TimeSpan.FromMinutes(60), T0.AddMinutes(59), ReplicaB));
        Assert.True(await SingletonLease.TryAcquire(db, "pass", TimeSpan.FromMinutes(60), T0.AddMinutes(61), ReplicaB));
    }

    [Fact]
    public async Task Releasing_hands_the_lease_straight_to_the_next_replica()
    {
        using var db = NewDb();
        Assert.True(await SingletonLease.TryAcquire(db, "pass", TimeSpan.FromMinutes(60), T0, ReplicaA));

        await SingletonLease.Release(db, "pass", ReplicaA);

        Assert.True(await SingletonLease.TryAcquire(db, "pass", TimeSpan.FromMinutes(60), DateTime.UtcNow, ReplicaB));
    }

    [Fact]
    public async Task A_replica_cannot_release_a_lease_it_does_not_hold()
    {
        using var db = NewDb();
        Assert.True(await SingletonLease.TryAcquire(db, "pass", TimeSpan.FromMinutes(60), T0, ReplicaA));

        await SingletonLease.Release(db, "pass", ReplicaB);

        Assert.False(await SingletonLease.TryAcquire(db, "pass", TimeSpan.FromMinutes(60), T0.AddMinutes(5), ReplicaB));
    }

    [Fact]
    public async Task Different_passes_do_not_block_each_other()
    {
        // run-generation and pickup-reminders are separate names, so one replica
        // holding one must never stall the other.
        using var db = NewDb();
        Assert.True(await SingletonLease.TryAcquire(db, "run-generation", TimeSpan.FromMinutes(60), T0, ReplicaA));
        Assert.True(await SingletonLease.TryAcquire(db, "pickup-reminders", TimeSpan.FromMinutes(60), T0, ReplicaB));
    }
}
