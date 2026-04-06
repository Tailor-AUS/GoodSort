namespace GoodSort.Api.Data.Entities;

public class CollectionRoute
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Status { get; set; } = "pending"; // pending, claimed, in_progress, at_depot, settled, cancelled
    public Guid? DriverId { get; set; }
    public Profile? Driver { get; set; }
    public int TotalContainers { get; set; }
    public double TotalWeightKg { get; set; }
    public int TotalValueCents { get; set; }
    public int DriverPayoutCents { get; set; }
    public int EstimatedDurationMin { get; set; }
    public double EstimatedDistanceKm { get; set; }
    public Guid DepotId { get; set; }
    public Depot Depot { get; set; } = null!;
    public DateTime? ClaimedAt { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public DateTime? SettledAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<RouteStop> Stops { get; set; } = [];
}

public class RouteStop
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RouteId { get; set; }
    public CollectionRoute Route { get; set; } = null!;
    public Guid HouseholdId { get; set; }
    public Household Household { get; set; } = null!;
    public string HouseholdName { get; set; } = "";
    public string Address { get; set; } = "";
    public double Lat { get; set; }
    public double Lng { get; set; }
    public int ContainerCount { get; set; }
    public int EstimatedBags { get; set; }
    public MaterialBreakdown? Materials { get; set; }
    public string Status { get; set; } = "pending"; // pending, picked_up, skipped
    public int? ActualContainerCount { get; set; }
    public DateTime? PickedUpAt { get; set; }
    public int Sequence { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
