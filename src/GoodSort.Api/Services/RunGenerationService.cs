using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Services;

/// <summary>
/// Background service that runs every 30 minutes to:
/// 1. Cluster households with pending containers into potential Runs
/// 2. Post runs to marketplace when payout ≥ $20 threshold
/// 3. Add "bin full" flagged households to nearby profitable runs
/// 4. Re-price unclaimed runs every 30 minutes
/// 5. Expire old unclaimed runs after 24hrs
///
/// DECOUPLED from council schedule — runs are demand-driven, not
/// calendar-driven. Containers accumulate in the GoodSort bin until
/// there's enough volume for a profitable run.
/// </summary>
public class RunGenerationService : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<RunGenerationService> _logger;
    private DateTime _lastRepriceAt = DateTime.MinValue;

    public RunGenerationService(IServiceProvider services, ILogger<RunGenerationService> logger)
    {
        _services = services;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
                var pricing = scope.ServiceProvider.GetRequiredService<PricingService>();

                await ExpireOldRuns(db);
                await GenerateRuns(db, pricing);
                await AbsorbFullBinHouseholds(db);

                if ((DateTime.UtcNow - _lastRepriceAt).TotalMinutes >= 30)
                {
                    await pricing.RepriceAvailableRuns();
                    _lastRepriceAt = DateTime.UtcNow;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "RunGenerationService error");
            }

            await Task.Delay(TimeSpan.FromMinutes(30), stoppingToken);
        }
    }

    private async Task ExpireOldRuns(GoodSortDbContext db)
    {
        var expired = await db.Runs
            .Where(r => (r.Status == "available" || r.Status == "below_threshold")
                     && r.ExpiresAt <= DateTime.UtcNow)
            .ToListAsync();

        foreach (var run in expired)
        {
            run.Status = "expired";
            _logger.LogInformation("Expired run {RunId}", run.Id);
        }

        if (expired.Count > 0)
            await db.SaveChangesAsync();
    }

    private async Task GenerateRuns(GoodSortDbContext db, PricingService pricing)
    {
        var minPayoutCents = int.TryParse(
            Environment.GetEnvironmentVariable("MINIMUM_RUN_PAYOUT_CENTS"), out var mp) ? mp : 2000;

        // Find all bins with pending containers NOT already in an active run
        var activeBinIds = await db.RunStops
            .Where(s => s.Run.Status == "available" || s.Run.Status == "below_threshold"
                     || s.Run.Status == "claimed" || s.Run.Status == "in_progress"
                     || s.Run.Status == "delivering")
            .Select(s => s.BinId)
            .Distinct()
            .ToListAsync();

        var readyBins = await db.Bins
            .Where(b => b.Status == "active"
                     && b.PendingContainers >= 1
                     && !activeBinIds.Contains(b.Id))
            .OrderByDescending(b => b.PendingContainers)
            .ToListAsync();

        if (readyBins.Count == 0) return;

        var dropPoint = await db.Depots.FirstOrDefaultAsync();
        if (dropPoint == null) return;

        // Greedy clustering: group bins within 3km of each other
        var used = new HashSet<Guid>();
        var clusters = new List<List<Bin>>();

        foreach (var bin in readyBins)
        {
            if (used.Contains(bin.Id)) continue;

            var cluster = new List<Bin> { bin };
            used.Add(bin.Id);

            foreach (var other in readyBins)
            {
                if (used.Contains(other.Id)) continue;
                if (Haversine(bin.Lat, bin.Lng, other.Lat, other.Lng) <= 3.0)
                {
                    cluster.Add(other);
                    used.Add(other.Id);
                }
            }

            clusters.Add(cluster);
        }

        foreach (var cluster in clusters)
        {
            var totalContainers = cluster.Sum(b => b.PendingContainers);
            var centroidLat = cluster.Average(b => b.Lat);
            var centroidLng = cluster.Average(b => b.Lng);
            var routeDistance = EstimateRouteDistance(cluster, dropPoint);

            var materials = new MaterialBreakdown
            {
                Aluminium = cluster.Sum(b => b.Materials.Aluminium),
                Pet = cluster.Sum(b => b.Materials.Pet),
                Glass = cluster.Sum(b => b.Materials.Glass),
                Other = cluster.Sum(b => b.Materials.Other),
            };

            var areaName = ExtractSuburb(cluster.First().Address);

            // Material focus
            var total = materials.Aluminium + materials.Pet + materials.Glass + materials.Other;
            var materialFocus = "mixed";
            if (total > 0)
            {
                if (materials.Aluminium > total * 0.6) materialFocus = "aluminium";
                else if (materials.Pet > total * 0.6) materialFocus = "pet";
                else if (materials.Glass > total * 0.6) materialFocus = "glass";
            }

            var weightKg = materials.Aluminium * 0.015
                         + materials.Pet * 0.025
                         + materials.Glass * 0.300
                         + materials.Other * 0.020;

            var durationMin = (int)(cluster.Count * 1 + routeDistance * 2 + 25);

            var run = new Run
            {
                DropPointId = dropPoint.Id,
                CentroidLat = centroidLat,
                CentroidLng = centroidLng,
                AreaName = areaName,
                MaterialFocus = materialFocus,
                EstimatedContainers = totalContainers,
                EstimatedWeightKg = weightKg,
                EstimatedDistanceKm = routeDistance,
                EstimatedDurationMin = durationMin,
                Materials = materials,
                ExpiresAt = DateTime.UtcNow.AddHours(24), // 24hr window — no council dependency
            };

            var sequence = 0;
            foreach (var bin in cluster)
            {
                run.Stops.Add(new RunStop
                {
                    BinId = bin.Id,
                    Lat = bin.Lat,
                    Lng = bin.Lng,
                    EstimatedContainers = bin.PendingContainers,
                    PickupInstruction = $"Collect from {bin.Name}",
                    Materials = new MaterialBreakdown
                    {
                        Aluminium = bin.Materials.Aluminium,
                        Pet = bin.Materials.Pet,
                        Glass = bin.Materials.Glass,
                        Other = bin.Materials.Other,
                    },
                    Sequence = sequence++,
                });
            }

            db.Runs.Add(run);

            var result = await pricing.CalculateRate(run);
            run.PerContainerCents = result.PerContainerCents;
            run.EstimatedPayoutCents = result.EstimatedPayoutCents;
            run.PricingTier = result.PricingTier;
            run.LastPricedAt = DateTime.UtcNow;

            // Only post to marketplace if payout meets minimum
            run.Status = run.EstimatedPayoutCents >= minPayoutCents
                ? "available"
                : "below_threshold";

            _logger.LogInformation(
                "Run {RunId}: {Status} {Focus} — {Stops} stops, {Containers} containers, ${Payout} payout, {Weight:F1}kg in {Area}",
                run.Id, run.Status, materialFocus, cluster.Count, totalContainers,
                run.EstimatedPayoutCents / 100.0, weightKg, areaName);
        }

        await db.SaveChangesAsync();
    }

    /// <summary>
    /// Households that flagged "my bin is full" get absorbed into the nearest
    /// existing profitable run, even if it slightly dilutes the run's $/hr.
    /// This ensures full-bin households don't wait indefinitely.
    /// </summary>
    private async Task AbsorbFullBinHouseholds(GoodSortDbContext db)
    {
        // Find households with BinIsOut=true (user flagged "bin is full")
        // whose bin is NOT already in an active run
        var activeBinIds = await db.RunStops
            .Where(s => s.Run.Status == "available" || s.Run.Status == "below_threshold"
                     || s.Run.Status == "claimed" || s.Run.Status == "in_progress")
            .Select(s => s.BinId)
            .Distinct()
            .ToListAsync();

        var fullBins = await db.Bins
            .Where(b => b.Status == "active"
                     && b.HouseholdId.HasValue
                     && b.PendingContainers >= 1
                     && !activeBinIds.Contains(b.Id))
            .ToListAsync();

        var fullHouseholdIds = fullBins.Select(b => b.HouseholdId!.Value).ToList();
        var flaggedHouseholds = await db.Households
            .Where(h => fullHouseholdIds.Contains(h.Id) && h.BinIsOut)
            .ToListAsync();

        if (flaggedHouseholds.Count == 0) return;

        // Find nearby available/below_threshold runs to absorb them into
        var openRuns = await db.Runs
            .Include(r => r.Stops)
            .Where(r => r.Status == "available" || r.Status == "below_threshold")
            .ToListAsync();

        var absorbed = 0;
        foreach (var hh in flaggedHouseholds)
        {
            var bin = fullBins.FirstOrDefault(b => b.HouseholdId == hh.Id);
            if (bin is null) continue;

            // Find the nearest open run within 5km
            var nearestRun = openRuns
                .Select(r => new { Run = r, Dist = Haversine(hh.Lat, hh.Lng, r.CentroidLat, r.CentroidLng) })
                .Where(x => x.Dist <= 5.0)
                .OrderBy(x => x.Dist)
                .FirstOrDefault();

            if (nearestRun is null) continue;

            // Add this bin as a new stop on the run
            nearestRun.Run.Stops.Add(new RunStop
            {
                BinId = bin.Id,
                Lat = bin.Lat,
                Lng = bin.Lng,
                EstimatedContainers = bin.PendingContainers,
                PickupInstruction = $"Added: {hh.Name} (bin full)",
                Materials = new MaterialBreakdown
                {
                    Aluminium = bin.Materials.Aluminium,
                    Pet = bin.Materials.Pet,
                    Glass = bin.Materials.Glass,
                    Other = bin.Materials.Other,
                },
                Sequence = nearestRun.Run.Stops.Count,
            });

            nearestRun.Run.EstimatedContainers += bin.PendingContainers;
            nearestRun.Run.EstimatedDurationMin += 1; // +1 min for the extra stop

            // Reset the flag
            hh.BinIsOut = false;
            hh.BinIsOutAt = null;
            absorbed++;

            _logger.LogInformation(
                "Absorbed full-bin household {HouseholdId} into run {RunId} ({Area})",
                hh.Id, nearestRun.Run.Id, nearestRun.Run.AreaName);
        }

        if (absorbed > 0)
            await db.SaveChangesAsync();
    }

    private static double EstimateRouteDistance(List<Bin> bins, Depot dropPoint)
    {
        if (bins.Count == 0) return 0;
        var total = Haversine(dropPoint.Lat, dropPoint.Lng, bins[0].Lat, bins[0].Lng);
        for (var i = 0; i < bins.Count - 1; i++)
            total += Haversine(bins[i].Lat, bins[i].Lng, bins[i + 1].Lat, bins[i + 1].Lng);
        total += Haversine(bins[^1].Lat, bins[^1].Lng, dropPoint.Lat, dropPoint.Lng);
        return Math.Round(total * 1.4, 1);
    }

    private static string ExtractSuburb(string address)
    {
        var parts = address.Split(',');
        if (parts.Length >= 2)
        {
            var suburb = parts[^1].Trim().Split(' ').FirstOrDefault();
            if (!string.IsNullOrEmpty(suburb)) return suburb;
        }
        return "Nearby";
    }

    private static double Haversine(double lat1, double lng1, double lat2, double lng2)
    {
        const double R = 6371.0;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLng = (lng2 - lng1) * Math.PI / 180;
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
                Math.Cos(lat1 * Math.PI / 180) * Math.Cos(lat2 * Math.PI / 180) *
                Math.Sin(dLng / 2) * Math.Sin(dLng / 2);
        return R * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }
}
