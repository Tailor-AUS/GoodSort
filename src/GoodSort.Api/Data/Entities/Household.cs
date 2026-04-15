namespace GoodSort.Api.Data.Entities;

public class Household
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string Address { get; set; } = "";
    public double Lat { get; set; }
    public double Lng { get; set; }

    // Customer segmentation
    public string Type { get; set; } = "residential"; // "residential" | "unit_complex"

    // For residential households with their own yellow kerbside bin
    public int? CouncilCollectionDay { get; set; } // 0=Sun .. 6=Sat; null until user sets
    public string? CouncilArea { get; set; }        // "BCC", "Logan", "Redlands", "Moreton Bay", "Gold Coast"
    public bool UsesDivider { get; set; } = true;   // cardboard divider in the yellow bin
    public bool AccessConsent { get; set; } = false; // explicit consent to access the yellow bin on collection day
    public DateTime? AccessConsentAt { get; set; }
    public bool BinIsOut { get; set; } = false;      // user has confirmed they've put the yellow bin on the kerb
    public DateTime? BinIsOutAt { get; set; }
    public DateTime? LastPickupAt { get; set; }

    // For unit complex (phase 2) — deferred, users waitlist for now
    public string? BuildingName { get; set; }
    public int? BinCapacityLitres { get; set; }
    public int PendingContainers { get; set; }
    public int PendingValueCents { get; set; }
    public MaterialBreakdown Materials { get; set; } = new();
    public double EstimatedWeightKg { get; set; }
    public int EstimatedBags { get; set; }
    public DateTime? LastScanAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Profile> Members { get; set; } = [];
}

public class MaterialBreakdown
{
    public int Aluminium { get; set; }
    public int Pet { get; set; }
    public int Glass { get; set; }
    public int Other { get; set; }
}
