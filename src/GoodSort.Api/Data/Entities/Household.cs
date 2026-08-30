namespace GoodSort.Api.Data.Entities;

public class Household
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string Address { get; set; } = "";
    public string? Suburb { get; set; }  // parsed from Address, e.g. MOOROOKA — used for street-sweep density
    public string? Street { get; set; }  // parsed street name, e.g. BEAUDESERT RD
    public double Lat { get; set; }
    public double Lng { get; set; }

    // Customer segmentation
    public string Type { get; set; } = "residential"; // "residential" | "unit_complex"

    // Council recycling day — used for optional clustering labels and pickup timing.
    // Collection is bagged containers from the kerb after suburb volume unlocks.
    public int? CouncilCollectionDay { get; set; } // 0=Sun .. 6=Sat; null until user sets
    public string? CouncilArea { get; set; }        // "BCC", "Logan", "Redlands", "Moreton Bay", "Gold Coast"
    public bool UsesDivider { get; set; } = true;   // optional divider for four-stream sorting at home
    public bool AccessConsent { get; set; } = false; // scan + kerbside collection consent
    public DateTime? AccessConsentAt { get; set; }
    public bool BinIsOut { get; set; } = false;      // sorted bags on kerb / ready for pickup
    public DateTime? BinIsOutAt { get; set; }
    public DateTime? LastPickupAt { get; set; }

    // Waitlist → purchase → delivery → collection. Density unlocks allocate; ops triggers purchase.
    public string BinStatus { get; set; } = BinStatuses.Waitlisted;
    public DateTime? WaitlistedAt { get; set; }

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

public static class BinStatuses
{
    public const string Waitlisted = "waitlisted";
    public const string Allocated = "allocated";
    public const string Delivered = "delivered";
    public const string Collecting = "collecting";

    public static bool IsServiceable(string? status) =>
        status == Delivered || status == Collecting;
}

public class MaterialBreakdown
{
    public int Aluminium { get; set; }
    public int Pet { get; set; }
    public int Glass { get; set; }
    public int Other { get; set; }
}
