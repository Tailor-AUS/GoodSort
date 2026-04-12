namespace GoodSort.Api.Data.Entities;

public class PricingConfig
{
    public Guid Id { get; set; } = Guid.NewGuid();

    // Per-container rate bounds (cents)
    public int FloorCents { get; set; } = 3;
    public int CeilingCents { get; set; } = 8;
    public int BaseCents { get; set; } = 5;

    // Factor weights (must sum to ~1.0)
    public double DistanceEfficiencyWeight { get; set; } = 0.20;  // containers/km
    public double BinDensityWeight { get; set; } = 0.20;          // avg km between stops
    public double SupplyDemandWeight { get; set; } = 0.25;        // online runners / available runs
    public double TimeOfDayWeight { get; set; } = 0.10;           // morning surge / night discount
    public double MaterialMixWeight { get; set; } = 0.10;         // aluminium-heavy = lighter = cheaper
    public double ScrapPriceWeight { get; set; } = 0.15;          // higher scrap = more margin

    // Surge multipliers
    public double MorningSurge { get; set; } = 1.3;   // 6am-10am
    public double AfternoonNormal { get; set; } = 1.0; // 10am-4pm
    public double EveningSurge { get; set; } = 1.1;    // 4pm-7pm
    public double NightDiscount { get; set; } = 0.7;   // 7pm-6am

    // Level bonuses (cents added on top)
    public int BronzeBonus { get; set; }
    public int SilverBonus { get; set; }
    public int GoldBonus { get; set; } = 1;
    public int PlatinumBonus { get; set; } = 2;

    // Scrap reference prices (cents/kg)
    public int AluminiumSpotCents { get; set; } = 120; // ~$1.20/kg
    public int PetSpotCents { get; set; } = 30;
    public int GlassSpotCents { get; set; } = 5;

    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}
