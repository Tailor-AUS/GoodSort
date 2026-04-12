using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Services;

public class PricingService
{
    private readonly GoodSortDbContext _db;

    public PricingService(GoodSortDbContext db)
    {
        _db = db;
    }

    /// <summary>
    /// Calculate dynamic per-container rate for a run based on 6 weighted factors.
    /// rate = clamp(base × weightedMultiplier, floor, ceiling) + levelBonus
    /// </summary>
    public async Task<PricingResult> CalculateRate(Run run, RunnerProfile? runner = null)
    {
        var config = await GetActiveConfig();

        // Factor 1: Distance efficiency — containers/km ratio
        var containersPerKm = run.EstimatedDistanceKm > 0
            ? run.EstimatedContainers / run.EstimatedDistanceKm
            : run.EstimatedContainers;
        // Normalize: 50 containers/km = 1.0 (ideal), scale linearly
        var distanceFactor = Math.Min(containersPerKm / 50.0, 2.0);

        // Factor 2: Bin density — avg km between stops
        var stopCount = run.Stops?.Count ?? 1;
        var avgKmBetween = stopCount > 1 ? run.EstimatedDistanceKm / stopCount : run.EstimatedDistanceKm;
        // Normalize: 0.5km apart = 1.5 (dense), 5km = 0.5 (spread)
        var densityFactor = Math.Max(0.3, Math.Min(2.0, 2.5 - (avgKmBetween / 2.5)));

        // Factor 3: Supply/demand — online runners / available runs
        var onlineRunners = await _db.RunnerProfiles.CountAsync(rp => rp.IsOnline);
        var availableRuns = await _db.Runs.CountAsync(r => r.Status == "available");
        var ratio = availableRuns > 0
            ? (double)onlineRunners / availableRuns
            : 2.0; // lots of runners, no runs = low price
        // ratio > 1 (more runners than runs) = lower price, < 1 = higher price
        var supplyDemandFactor = Math.Max(0.5, Math.Min(2.0, 2.0 - ratio));

        // Factor 4: Time of day
        var hour = DateTime.Now.Hour;
        var timeFactor = hour switch
        {
            >= 6 and < 10 => config.MorningSurge,
            >= 10 and < 16 => config.AfternoonNormal,
            >= 16 and < 19 => config.EveningSurge,
            _ => config.NightDiscount,
        };

        // Factor 5: Material mix — aluminium-heavy = lighter = cheaper to transport
        var totalMaterials = (run.Materials.Aluminium + run.Materials.Pet + run.Materials.Glass + run.Materials.Other);
        var aluminiumRatio = totalMaterials > 0 ? (double)run.Materials.Aluminium / totalMaterials : 0.25;
        // More aluminium = lighter load = discount (0.8), more glass = heavier = premium (1.3)
        var glassRatio = totalMaterials > 0 ? (double)run.Materials.Glass / totalMaterials : 0.25;
        var materialFactor = 1.0 - (aluminiumRatio * 0.2) + (glassRatio * 0.3);

        // Factor 6: Scrap spot price — higher scrap = more margin for us = can pay runner more
        var avgScrapValue = (config.AluminiumSpotCents * 0.5 + config.PetSpotCents * 0.3 + config.GlassSpotCents * 0.2) / 100.0;
        // Normalize around $0.60/kg baseline
        var scrapFactor = Math.Max(0.5, Math.Min(1.5, avgScrapValue / 0.60));

        // Weighted multiplier
        var weightedMultiplier =
            distanceFactor * config.DistanceEfficiencyWeight +
            densityFactor * config.BinDensityWeight +
            supplyDemandFactor * config.SupplyDemandWeight +
            timeFactor * config.TimeOfDayWeight +
            materialFactor * config.MaterialMixWeight +
            scrapFactor * config.ScrapPriceWeight;

        // Calculate rate and clamp
        var rawRate = config.BaseCents * weightedMultiplier;
        var clampedRate = Math.Max(config.FloorCents, Math.Min(config.CeilingCents, rawRate));

        // Level bonus
        var levelBonus = runner?.Level switch
        {
            "gold" => config.GoldBonus,
            "platinum" => config.PlatinumBonus,
            "silver" => config.SilverBonus,
            "bronze" => config.BronzeBonus,
            _ => 0,
        };

        var finalRate = (int)Math.Round(clampedRate) + levelBonus;
        var pricingTier = finalRate <= 3 ? 1 : finalRate <= 4 ? 2 : finalRate <= 5 ? 3 : finalRate <= 6 ? 4 : 5;

        return new PricingResult
        {
            PerContainerCents = finalRate,
            PricingTier = pricingTier,
            EstimatedPayoutCents = finalRate * run.EstimatedContainers,
            Factors = new PricingFactors
            {
                DistanceEfficiency = distanceFactor,
                BinDensity = densityFactor,
                SupplyDemand = supplyDemandFactor,
                TimeOfDay = timeFactor,
                MaterialMix = materialFactor,
                ScrapPrice = scrapFactor,
                WeightedMultiplier = weightedMultiplier,
                LevelBonus = levelBonus,
            }
        };
    }

    /// <summary>
    /// Re-price all unclaimed available runs (biased upward over time).
    /// Called every 30 minutes by RunGenerationService.
    /// </summary>
    public async Task RepriceAvailableRuns()
    {
        var availableRuns = await _db.Runs
            .Include(r => r.Stops)
            .Where(r => r.Status == "available" && r.ExpiresAt > DateTime.UtcNow)
            .ToListAsync();

        foreach (var run in availableRuns)
        {
            var result = await CalculateRate(run);

            // Bias upward: never decrease price on re-price (incentivize taking older runs)
            if (result.PerContainerCents >= run.PerContainerCents)
            {
                run.PerContainerCents = result.PerContainerCents;
                run.EstimatedPayoutCents = result.EstimatedPayoutCents;
                run.PricingTier = result.PricingTier;
                run.LastPricedAt = DateTime.UtcNow;
            }
        }

        await _db.SaveChangesAsync();
    }

    public async Task<PricingConfig> GetActiveConfig()
    {
        return await _db.PricingConfigs.FirstOrDefaultAsync(pc => pc.IsActive)
            ?? new PricingConfig();
    }
}

public class PricingResult
{
    public int PerContainerCents { get; set; }
    public int PricingTier { get; set; }
    public int EstimatedPayoutCents { get; set; }
    public PricingFactors Factors { get; set; } = new();
}

public class PricingFactors
{
    public double DistanceEfficiency { get; set; }
    public double BinDensity { get; set; }
    public double SupplyDemand { get; set; }
    public double TimeOfDay { get; set; }
    public double MaterialMix { get; set; }
    public double ScrapPrice { get; set; }
    public double WeightedMultiplier { get; set; }
    public int LevelBonus { get; set; }
}
