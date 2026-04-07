using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Data;

public class GoodSortDbContext(DbContextOptions<GoodSortDbContext> options) : DbContext(options)
{
    public DbSet<Profile> Profiles => Set<Profile>();
    public DbSet<Household> Households => Set<Household>();
    public DbSet<Scan> Scans => Set<Scan>();
    public DbSet<CollectionRoute> Routes => Set<CollectionRoute>();
    public DbSet<RouteStop> RouteStops => Set<RouteStop>();
    public DbSet<Depot> Depots => Set<Depot>();
    public DbSet<Bin> Bins => Set<Bin>();
    public DbSet<Collection> Collections => Set<Collection>();
    public DbSet<CashoutRequest> CashoutRequests => Set<CashoutRequest>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Household — owned JSON type for Materials
        modelBuilder.Entity<Household>(e =>
        {
            e.OwnsOne(h => h.Materials, b => b.ToJson());
            e.HasIndex(h => new { h.Lat, h.Lng });
        });

        // Profile
        modelBuilder.Entity<Profile>(e =>
        {
            e.HasOne(p => p.Household)
                .WithMany(h => h.Members)
                .HasForeignKey(p => p.HouseholdId)
                .OnDelete(DeleteBehavior.SetNull);

            e.Property(p => p.Badges)
                .HasConversion(
                    v => string.Join(',', v),
                    v => v.Split(',', StringSplitOptions.RemoveEmptyEntries).ToList()
                );

            e.HasIndex(p => p.Phone).IsUnique().HasFilter("[Phone] IS NOT NULL");
        });

        // Scan
        modelBuilder.Entity<Scan>(e =>
        {
            e.HasOne(s => s.User)
                .WithMany(p => p.Scans)
                .HasForeignKey(s => s.UserId);

            e.HasIndex(s => s.UserId);
            e.HasIndex(s => s.HouseholdId);
            e.HasIndex(s => s.Status);
        });

        // Route
        modelBuilder.Entity<CollectionRoute>(e =>
        {
            e.HasOne(r => r.Driver)
                .WithMany()
                .HasForeignKey(r => r.DriverId)
                .OnDelete(DeleteBehavior.SetNull);

            e.HasOne(r => r.Depot)
                .WithMany()
                .HasForeignKey(r => r.DepotId);

            e.HasIndex(r => r.Status);
            e.HasIndex(r => r.DriverId);
        });

        // RouteStop
        modelBuilder.Entity<RouteStop>(e =>
        {
            e.HasOne(s => s.Route)
                .WithMany(r => r.Stops)
                .HasForeignKey(s => s.RouteId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(s => s.Household)
                .WithMany()
                .HasForeignKey(s => s.HouseholdId)
                .OnDelete(DeleteBehavior.NoAction);

            e.OwnsOne(s => s.Materials, b => b.ToJson());
            e.HasIndex(s => s.RouteId);
        });

        // Collection
        modelBuilder.Entity<Collection>(e =>
        {
            e.HasOne(c => c.User)
                .WithMany(p => p.Collections)
                .HasForeignKey(c => c.UserId);

            e.HasOne(c => c.Route)
                .WithMany()
                .HasForeignKey(c => c.RouteId)
                .OnDelete(DeleteBehavior.NoAction);

            e.HasIndex(c => c.UserId);
        });

        // Bin
        modelBuilder.Entity<Bin>(e =>
        {
            e.OwnsOne(b => b.Materials, b => b.ToJson());
            e.HasIndex(b => b.Code).IsUnique();
            e.HasIndex(b => new { b.Lat, b.Lng });
            e.HasIndex(b => b.Status);
        });

        // Scan → Bin relationship
        modelBuilder.Entity<Scan>(e =>
        {
            e.HasOne(s => s.Bin)
                .WithMany()
                .HasForeignKey(s => s.BinId)
                .OnDelete(DeleteBehavior.SetNull);

            e.HasIndex(s => s.BinId);
            e.HasIndex(s => s.BinCode);
        });

        // Seed default depot (static CreatedAt to avoid PendingModelChangesWarning)
        modelBuilder.Entity<Depot>().HasData(new Depot
        {
            Id = Guid.Parse("00000000-0000-0000-0000-000000000001"),
            Name = "Tomra South Brisbane",
            Address = "201 Montague Rd, West End",
            Lat = -27.4790,
            Lng = 153.0080,
            CreatedAt = new DateTime(2026, 4, 1, 0, 0, 0, DateTimeKind.Utc),
        });
    }
}
