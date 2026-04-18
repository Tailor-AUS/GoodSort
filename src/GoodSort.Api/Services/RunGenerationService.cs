using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Services;

/// <summary>
/// Background service that runs every 5 minutes to:
/// 1. Cluster "ready" bins into new Runs
/// 2. Re-price unclaimed runs every 30 minutes
/// 3. Expire old unclaimed runs
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

                // 1. Expire old runs
                await ExpireOldRuns(db);

                // 2. Generate new runs from ready bins
                await GenerateRuns(db, pricing);

                // 3. Re-price unclaimed runs every 30min
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

            await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken);
        }
    }

    private async Task ExpireOldRuns(GoodSortDbContext db)
    {
        var expired = await db.Runs
            .Where(r => r.Status == "available" && r.ExpiresAt <= DateTime.UtcNow)
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
        // Find bins that are "ready" and NOT already in an active run.
        //
        // Yellow-bin model: a residential household's bin is ready when council
        // pickup is TOMORROW (local time). We run the night before and extract
        // CDS containers before the truck arrives. Non-residential / legacy bins
        // fall back to the old "50+ containers" threshold.
        var activeBinIds = await db.RunStops
            .Where(s => s.Run.Status == "available" || s.Run.Status == "claimed" || s.Run.Status == "in_progress" || s.Run.Status == "delivering")
            .Select(s => s.BinId)
            .Distinct()
            .ToListAsync();

        // Day-of-week that we should be collecting for (the council truck comes tomorrow)
        var tomorrowDow = (int)DateTime.UtcNow.AddDays(1).DayOfWeek; // 0=Sun..6=Sat

        var allCandidates = await db.Bins
            .Where(b => b.Status == "active" && !activeBinIds.Contains(b.Id))
            .ToListAsync();

        // Fetch household data for residential bins
        var householdIds = allCandidates.Where(b => b.HouseholdId.HasValue).Select(b => b.HouseholdId!.Value).Distinct().ToList();
        var households = await db.Households.Where(h => householdIds.Contains(h.Id)).ToDictionaryAsync(h => h.Id);

        var readyBins = allCandidates.Where(b =>
        {
            if (b.HouseholdId.HasValue && households.TryGetValue(b.HouseholdId.Value, out var h))
            {
                // Residential: ready when the council comes tomorrow (and household has at least 1 pending container)
                return h.Type == "residential"
                    && h.CouncilCollectionDay == tomorrowDow
                    && b.PendingContainers >= 1;
            }
            // Non-household bins: old threshold-based model
            return b.PendingContainers >= 50;
        })
        .OrderByDescending(b => b.PendingContainers)
        .ToList();

        if (readyBins.Count == 0) return;

        // Get default drop point (first depot — YOUR premises)
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

                var distance = Haversine(bin.Lat, bin.Lng, other.Lat, other.Lng);
                if (distance <= 3.0)
                {
                    cluster.Add(other);
                    used.Add(other.Id);
                }
            }

            clusters.Add(cluster);
        }

        // Create Runs for each cluster — split by material when volume warrants it
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

            // Determine material focus: if one stream is >60% of total, make it
            // a material-specific run. Otherwise "mixed".
            var materialFocus = "mixed";
            var total = materials.Aluminium + materials.Pet + materials.Glass + materials.Other;
            if (total > 0)
            {
                if (materials.Aluminium > total * 0.6) materialFocus = "aluminium";
                else if (materials.Pet > total * 0.6) materialFocus = "pet";
                else if (materials.Glass > total * 0.6) materialFocus = "glass";
            }

            // Estimate weight (helps runners decide vehicle needs)
            var weightKg = materials.Aluminium * 0.015   // 15g per can
                         + materials.Pet * 0.025          // 25g per bottle
                         + materials.Glass * 0.300        // 300g per bottle
                         + materials.Other * 0.020;       // 20g avg

            // Time per stop: 1min for yellow bin extraction (faster than old 3min bag swap)
            var durationMin = (int)(cluster.Count * 1 + routeDistance * 2 + 25);

            var run = new Run
            {
                Status = "available",
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
                ExpiresAt = DateTime.UtcNow.AddHours(12), // 12hr window (evening before → morning)
            };

            // Add stops
            var sequence = 0;
            foreach (var bin in cluster)
            {
                run.Stops.Add(new RunStop
                {
                    BinId = bin.Id,
                    Lat = bin.Lat,
                    Lng = bin.Lng,
                    EstimatedContainers = bin.PendingContainers,
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

            // Price the run
            var result = await pricing.CalculateRate(run);
            run.PerContainerCents = result.PerContainerCents;
            run.EstimatedPayoutCents = result.EstimatedPayoutCents;
            run.PricingTier = result.PricingTier;
            run.LastPricedAt = DateTime.UtcNow;

            _logger.LogInformation(
                "Generated run {RunId}: {Stops} stops, {Containers} containers, {Rate}c/container in {Area}",
                run.Id, cluster.Count, totalContainers, result.PerContainerCents, areaName);
        }

        await db.SaveChangesAsync();
    }

    private static double EstimateRouteDistance(List<Bin> bins, Depot dropPoint)
    {
        if (bins.Count == 0) return 0;

        // Simple: sum distances between bins in order + to/from drop point
        var total = Haversine(dropPoint.Lat, dropPoint.Lng, bins[0].Lat, bins[0].Lng);
        for (var i = 0; i < bins.Count - 1; i++)
            total += Haversine(bins[i].Lat, bins[i].Lng, bins[i + 1].Lat, bins[i + 1].Lng);
        total += Haversine(bins[^1].Lat, bins[^1].Lng, dropPoint.Lat, dropPoint.Lng);

        return Math.Round(total * 1.4, 1); // ×1.4 road factor
    }

    private static string ExtractSuburb(string address)
    {
        // Try to get suburb from address like "42 Smith St, Moorooka QLD 4105"
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
