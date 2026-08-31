using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace GoodSort.Api.Data;

/// <summary>
/// Used only by `dotnet ef migrations add`. Without it, EF builds the real host
/// to find the context, and Program.cs picks the in-memory provider whenever
/// there is no connection string — so scaffolding fails with "Unable to resolve
/// service for type IMigrator". Feeding it a connection string instead makes
/// startup try to reach that database and retry for half a minute first.
///
/// This connection string is never opened. Generating a migration needs the
/// provider's SQL dialect, not a server.
/// </summary>
public class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<GoodSortDbContext>
{
    public GoodSortDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<GoodSortDbContext>()
            .UseSqlServer("Server=design-time-only;Database=GoodSort;Trusted_Connection=True;")
            .Options);
}
