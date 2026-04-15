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
    public DbSet<OtpCode> OtpCodes => Set<OtpCode>();
    public DbSet<Collection> Collections => Set<Collection>();
    public DbSet<CashoutRequest> CashoutRequests => Set<CashoutRequest>();
    public DbSet<RunnerProfile> RunnerProfiles => Set<RunnerProfile>();
    public DbSet<Run> Runs => Set<Run>();
    public DbSet<RunStop> RunStops => Set<RunStop>();
    public DbSet<RunnerRating> RunnerRatings => Set<RunnerRating>();
    public DbSet<PricingConfig> PricingConfigs => Set<PricingConfig>();
    public DbSet<VisionCall> VisionCalls => Set<VisionCall>();

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

            e.HasIndex(p => p.Email).IsUnique().HasFilter("[Email] IS NOT NULL");
            e.HasIndex(p => p.Phone).HasFilter("[Phone] IS NOT NULL");
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

        // OTP codes
        modelBuilder.Entity<OtpCode>(e =>
        {
            e.HasIndex(o => o.Email);
            e.HasIndex(o => o.ExpiresAt);
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

        // RunnerProfile
        modelBuilder.Entity<RunnerProfile>(e =>
        {
            e.HasOne(rp => rp.Profile)
                .WithOne()
                .HasForeignKey<RunnerProfile>(rp => rp.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);

            e.Property(rp => rp.Badges)
                .HasConversion(
                    v => string.Join(',', v),
                    v => v.Split(',', StringSplitOptions.RemoveEmptyEntries).ToList()
                );

            e.HasIndex(rp => rp.ProfileId).IsUnique();
            e.HasIndex(rp => rp.IsOnline);
            e.HasIndex(rp => rp.Level);
        });

        // Run
        modelBuilder.Entity<Run>(e =>
        {
            e.HasOne(r => r.Runner)
                .WithMany(rp => rp.Runs)
                .HasForeignKey(r => r.RunnerId)
                .OnDelete(DeleteBehavior.SetNull);

            e.HasOne(r => r.DropPoint)
                .WithMany()
                .HasForeignKey(r => r.DropPointId)
                .OnDelete(DeleteBehavior.NoAction);

            e.HasOne(r => r.Rating)
                .WithOne(rr => rr.Run)
                .HasForeignKey<RunnerRating>(rr => rr.RunId)
                .OnDelete(DeleteBehavior.Cascade);

            e.OwnsOne(r => r.Materials, b => b.ToJson());

            e.HasIndex(r => r.Status);
            e.HasIndex(r => r.RunnerId);
            e.HasIndex(r => new { r.CentroidLat, r.CentroidLng });
            e.HasIndex(r => r.ExpiresAt);
        });

        // RunStop
        modelBuilder.Entity<RunStop>(e =>
        {
            e.HasOne(s => s.Run)
                .WithMany(r => r.Stops)
                .HasForeignKey(s => s.RunId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(s => s.Bin)
                .WithMany()
                .HasForeignKey(s => s.BinId)
                .OnDelete(DeleteBehavior.NoAction);

            e.OwnsOne(s => s.Materials, b => b.ToJson());

            e.HasIndex(s => s.RunId);
            e.HasIndex(s => s.Status);
        });

        // RunnerRating
        modelBuilder.Entity<RunnerRating>(e =>
        {
            e.HasOne(rr => rr.Runner)
                .WithMany()
                .HasForeignKey(rr => rr.RunnerId)
                .OnDelete(DeleteBehavior.NoAction);

            e.HasIndex(rr => rr.RunnerId);
        });

        // PricingConfig
        modelBuilder.Entity<PricingConfig>(e =>
        {
            e.HasIndex(pc => pc.IsActive);
        });

        // VisionCall — one row per Tailor Vision / Azure OpenAI call for cost tracking
        modelBuilder.Entity<VisionCall>(e =>
        {
            e.HasIndex(v => v.CreatedAt);
            e.HasIndex(v => v.Provider);
        });

        // Seed default pricing config (static CreatedAt)
        modelBuilder.Entity<PricingConfig>().HasData(new PricingConfig
        {
            Id = Guid.Parse("00000000-0000-0000-0000-000000000010"),
            CreatedAt = new DateTime(2026, 4, 1, 0, 0, 0, DateTimeKind.Utc),
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
