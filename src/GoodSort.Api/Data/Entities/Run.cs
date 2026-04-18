namespace GoodSort.Api.Data.Entities;

public class Run
{
    public Guid Id { get; set; } = Guid.NewGuid();

    // Status lifecycle: available → claimed → in_progress → delivering → completed → settled
    public string Status { get; set; } = "available";

    // Runner (null when available)
    public Guid? RunnerId { get; set; }
    public RunnerProfile? Runner { get; set; }

    // Drop point — legacy depot or a specific recycler endpoint
    public Guid DropPointId { get; set; }
    public Depot DropPoint { get; set; } = null!;

    // Recycler destination — the specific recycler this run delivers to
    // (null for legacy/mixed runs that go to a generic depot)
    public Guid? RecyclerId { get; set; }
    public Recycler? Recycler { get; set; }

    // Privacy — centroid only, no addresses in listing
    public double CentroidLat { get; set; }
    public double CentroidLng { get; set; }
    public string AreaName { get; set; } = ""; // e.g. "Moorooka" — shown to browsing runners

    // Material focus: "mixed" (all streams), or a specific stream when
    // a suburb has enough of one material to justify a dedicated run.
    // Values: "mixed", "aluminium", "pet", "glass", "steel", "hdpe_lpb"
    public string MaterialFocus { get; set; } = "mixed";

    // Container estimates
    public int EstimatedContainers { get; set; }
    public int ActualContainers { get; set; }

    // Estimated weight helps runners decide (glass = heavy = need a car)
    public double EstimatedWeightKg { get; set; }

    // Dynamic pricing
    public int PerContainerCents { get; set; } = 5; // 3-8c dynamic
    public int EstimatedPayoutCents { get; set; }
    public int ActualPayoutCents { get; set; }
    public int PricingTier { get; set; } = 1; // 1-5 surge level
    public DateTime? LastPricedAt { get; set; }

    // Route estimates
    public double EstimatedDistanceKm { get; set; }
    public int EstimatedDurationMin { get; set; }
    public double ActualDistanceKm { get; set; }

    // Material breakdown
    public MaterialBreakdown Materials { get; set; } = new();

    // Expiry — unclaimed runs expire after 4hrs (re-generated)
    public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddHours(4);

    // Lifecycle timestamps
    public DateTime? ClaimedAt { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public DateTime? DeliveredAt { get; set; }
    public DateTime? SettledAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<RunStop> Stops { get; set; } = [];
    public RunnerRating? Rating { get; set; }
}
