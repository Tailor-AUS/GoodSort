using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Services;

/// <summary>
/// Background service that runs every 30 minutes to:
/// 1. Cluster collecting households (bags on kerb or scanned volume) into runs
/// 2. Post runs to marketplace when payout ≥ $20 threshold
/// 3. Add "bin on the kerb" households to nearby runs
/// 4. Re-price unclaimed runs every 30 minutes
/// 5. Expire old unclaimed runs after 24hrs
///
/// Waitlisted / allocated streets never generate a run. Scan volume is
/// optional — a collecting household that bags out on the kerb is enough.
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

    private const string LeaseName = "run-generation";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
                var pricing = scope.ServiceProvider.GetRequiredService<PricingService>();

                // One replica only. This service runs inside every container
                // instance and the app scales to ten, so without the lease ten
                // copies generate runs over the same bins at once — several
                // drivers paid to collect the same containers, and vans sent to
                // kerbs another driver already emptied.
                //
                // TTL is twice the interval so a pass is never interrupted
                // mid-flight, and a crashed holder blocks the next pass by at
                // most an hour rather than forever.
                if (!await SingletonLease.TryAcquire(db, LeaseName, TimeSpan.FromMinutes(60), ct: stoppingToken))
                {
                    _logger.LogDebug("Another replica holds {Lease}; skipping this pass", LeaseName);
                }
                else
                {
                    try
                    {
                        await ExpireOldRuns(db);
                        await GenerateRuns(db, pricing);
                        await AbsorbFullBinHouseholds(db);

                        if ((DateTime.UtcNow - _lastRepriceAt).TotalMinutes >= 30)
                        {
                            await pricing.RepriceAvailableRuns();
                            _lastRepriceAt = DateTime.UtcNow;
                        }
                    }
                    finally
                    {
                        // Hand it back rather than making the next pass wait out
                        // the whole TTL. Expiry remains the real safety net.
                        await SingletonLease.Release(db, LeaseName, ct: stoppingToken);
                    }
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
            .Where(r => RunLifecycle.Unclaimed.Contains(r.Status)
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
            .Where(s => RunLifecycle.HoldsBin.Contains(s.Run.Status))
            .Select(s => s.BinId)
            .Distinct()
            .ToListAsync();

        var notServiceable = await db.Households
            .Where(h => h.BinStatus == BinStatuses.Waitlisted || h.BinStatus == BinStatuses.Allocated)
            .Select(h => h.Id)
            .ToListAsync();

        var candidates = await db.Bins
            .Where(b => b.Status == "active"
                     && !activeBinIds.Contains(b.Id)
                     && (b.HouseholdId == null || !notServiceable.Contains(b.HouseholdId.Value)))
            .ToListAsync();
        var householdIds = candidates.Where(b => b.HouseholdId.HasValue).Select(b => b.HouseholdId!.Value).Distinct().ToList();
        var households = await db.Households
            .Where(h => householdIds.Contains(h.Id))
            .ToDictionaryAsync(h => h.Id);
        var utc = DateTime.UtcNow;
        var readyBins = candidates
            .Where(b =>
            {
                if (b.HouseholdId is null) return b.PendingContainers >= 1;
                if (!households.TryGetValue(b.HouseholdId.Value, out var hh)) return false;
                return KerbsideNight.HouseholdBinIsReady(hh.BinStatus, hh.BinIsOut, b.PendingContainers);
            })
            .OrderByDescending(b => HouseholdCredit.EstimatedContainers(b.PendingContainers))
            .ToList();

        if (readyBins.Count == 0) return;

        var dropPoint = await db.Depots.FirstOrDefaultAsync();
        if (dropPoint == null) return;

        var clusters = new List<(List<Bin> Bins, string Area)>();
        foreach (var group in RunCluster.GroupByStreet(
            readyBins.Where(b => b.HouseholdId.HasValue),
            b => households[b.HouseholdId!.Value].Suburb,
            b => households[b.HouseholdId!.Value].CouncilCollectionDay))
        {
            var hh = households[group[0].HouseholdId!.Value];
            clusters.Add((group.ToList(), RunCluster.AreaName(hh.Suburb, hh.CouncilCollectionDay)));
        }

        var publicBins = readyBins.Where(b => b.HouseholdId is null).ToList();
        var used = new HashSet<Guid>();
        foreach (var bin in publicBins)
        {
            if (used.Contains(bin.Id)) continue;
            var cluster = new List<Bin> { bin };
            used.Add(bin.Id);
            foreach (var other in publicBins)
            {
                if (used.Contains(other.Id)) continue;
                if (Haversine(bin.Lat, bin.Lng, other.Lat, other.Lng) <= 3.0)
                {
                    cluster.Add(other);
                    used.Add(other.Id);
                }
            }
            clusters.Add((cluster, ExtractSuburb(cluster[0].Address)));
        }

        foreach (var (cluster, areaName) in clusters)
        {
            var totalContainers = cluster.Sum(b => HouseholdCredit.EstimatedContainers(b.PendingContainers));
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
                ExpiresAt = DateTime.UtcNow.AddHours(18),
            };

            var sequence = 0;
            foreach (var bin in cluster)
            {
                run.Stops.Add(new RunStop
                {
                    BinId = bin.Id,
                    Lat = bin.Lat,
                    Lng = bin.Lng,
                    EstimatedContainers = HouseholdCredit.EstimatedContainers(bin.PendingContainers),
                    PickupInstruction = HouseholdCredit.PickupInstruction(bin.Name),
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
        // Was missing "delivering", so a bin whose containers were already in a
        // driver's vehicle counted as free and could be absorbed into a second
        // run — sending another driver to an emptied kerb.
        var activeBinIds = await db.RunStops
            .Where(s => RunLifecycle.HoldsBin.Contains(s.Run.Status))
            .Select(s => s.BinId)
            .Distinct()
            .ToListAsync();

        var fullBins = await db.Bins
            .Where(b => b.Status == "active"
                     && b.HouseholdId.HasValue
                     && !activeBinIds.Contains(b.Id))
            .ToListAsync();

        var fullHouseholdIds = fullBins.Select(b => b.HouseholdId!.Value).ToList();
        var flaggedHouseholds = await db.Households
            .Where(h => fullHouseholdIds.Contains(h.Id) && h.BinIsOut
                     && BinStatuses.Serviceable.Contains(h.BinStatus))
            .ToListAsync();

        if (flaggedHouseholds.Count == 0) return;

        // Find nearby available/below_threshold runs to absorb them into
        var openRuns = await db.Runs
            .Include(r => r.Stops)
            .Where(r => RunLifecycle.Unclaimed.Contains(r.Status))
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
                EstimatedContainers = HouseholdCredit.EstimatedContainers(bin.PendingContainers),
                PickupInstruction = HouseholdCredit.PickupInstruction(hh.Name),
                Materials = new MaterialBreakdown
                {
                    Aluminium = bin.Materials.Aluminium,
                    Pet = bin.Materials.Pet,
                    Glass = bin.Materials.Glass,
                    Other = bin.Materials.Other,
                },
                Sequence = nearestRun.Run.Stops.Count,
            });

            nearestRun.Run.EstimatedContainers += HouseholdCredit.EstimatedContainers(bin.PendingContainers);
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
