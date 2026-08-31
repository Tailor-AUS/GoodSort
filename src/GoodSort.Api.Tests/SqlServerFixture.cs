using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Tests;

/// <summary>
/// A real SQL Server database for the concurrency tests, created once and
/// dropped afterwards.
///
/// Connection string comes from GOODSORT_TEST_SQL. When it is absent the
/// fixture reports Available = false and every test that needs it skips, so a
/// developer with no database still gets a green run. CI supplies it from a
/// service container, which is where these are not optional.
///
/// Schema is created with the real migrations rather than EnsureCreated, so
/// what the tests run against is what production runs against — including the
/// UsedScanTokens primary key that makes token redemption single-use.
/// </summary>
public class SqlServerFixture : IAsyncLifetime
{
    public const string SkipReason =
        "GOODSORT_TEST_SQL is not set, so there is no SQL Server to test concurrency against. " +
        "CI sets it from a service container. Locally: docker run -e ACCEPT_EULA=Y " +
        "-e MSSQL_SA_PASSWORD=<pw> -p 1433:1433 mcr.microsoft.com/mssql/server:2022-latest";

    private string? _connectionString;
    private string? _database;

    public bool Available => _connectionString is not null;

    public GoodSortDbContext NewContext() =>
        new(new DbContextOptionsBuilder<GoodSortDbContext>()
            .UseSqlServer(_connectionString
                ?? throw new InvalidOperationException("No SQL Server configured; the test should have skipped."))
            .Options);

    public async Task InitializeAsync()
    {
        var baseCs = Environment.GetEnvironmentVariable("GOODSORT_TEST_SQL");
        if (string.IsNullOrWhiteSpace(baseCs)) return;

        // Own database per run so a rerun cannot inherit rows from the last one.
        _database = $"goodsort_test_{Guid.NewGuid():N}";

        var builder = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(baseCs)
        {
            InitialCatalog = "master",
            TrustServerCertificate = true,
        };

        await using (var master = new Microsoft.Data.SqlClient.SqlConnection(builder.ConnectionString))
        {
            await master.OpenAsync();
            await using var create = master.CreateCommand();
            create.CommandText = $"CREATE DATABASE [{_database}]";
            await create.ExecuteNonQueryAsync();
        }

        builder.InitialCatalog = _database;
        _connectionString = builder.ConnectionString;

        await using var db = NewContext();
        await db.Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        if (_connectionString is null || _database is null) return;

        var builder = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(_connectionString)
        {
            InitialCatalog = "master",
        };
        await using var master = new Microsoft.Data.SqlClient.SqlConnection(builder.ConnectionString);
        await master.OpenAsync();
        await using var drop = master.CreateCommand();
        // Kick any lingering sessions, or the DROP blocks.
        drop.CommandText = $"ALTER DATABASE [{_database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{_database}];";
        await drop.ExecuteNonQueryAsync();
    }

    public async Task<Guid> SeedProfile(int clearedCents)
    {
        await using var db = NewContext();
        var profile = new Profile
        {
            Name = "Concurrency Test",
            Email = $"sql-{Guid.NewGuid():N}@example.test",
            Phone = $"sql-{Guid.NewGuid():N}@example.test",
            ClearedCents = clearedCents,
        };
        db.Profiles.Add(profile);
        await db.SaveChangesAsync();
        return profile.Id;
    }

    public async Task<Guid> SeedRoute(string status)
    {
        await using var db = NewContext();
        var depot = new Depot { Name = "Test Depot", Address = "1 Test St", Lat = -27.5, Lng = 153.0 };
        db.Depots.Add(depot);
        var route = new CollectionRoute { Status = status, DepotId = depot.Id };
        db.Routes.Add(route);
        await db.SaveChangesAsync();
        return route.Id;
    }

    public async Task<Guid> SeedRun(string status)
    {
        await using var db = NewContext();
        // Run.DropPointId is a real foreign key. InMemory ignores that and let
        // an unset Guid through; SQL Server rejects it with
        // FK_Runs_Depots_DropPointId, which is the sort of thing testing
        // against the actual database is for.
        var dropPoint = new Depot { Name = "Test Drop Point", Address = "2 Test St", Lat = -27.5, Lng = 153.0 };
        db.Depots.Add(dropPoint);
        var run = new Run { Status = status, DropPointId = dropPoint.Id };
        db.Runs.Add(run);
        await db.SaveChangesAsync();
        return run.Id;
    }
}

/// <summary>Keeps the SQL tests off each other's toes.</summary>
[CollectionDefinition("sql")]
public class SqlCollection : ICollectionFixture<SqlServerFixture>;
