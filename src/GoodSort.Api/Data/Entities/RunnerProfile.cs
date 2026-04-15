namespace GoodSort.Api.Data.Entities;

public class RunnerProfile
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProfileId { get; set; }
    public Profile Profile { get; set; } = null!;

    // Vehicle & capacity
    public string VehicleType { get; set; } = "car"; // car, bike, walk
    public string VehicleMake { get; set; } = "";
    public string VehicleRego { get; set; } = "";
    public int CapacityBags { get; set; } = 10;
    public double ServiceRadiusKm { get; set; } = 10.0;

    // Live location (heartbeat)
    public bool IsOnline { get; set; }
    public double? LastLat { get; set; }
    public double? LastLng { get; set; }
    public DateTime? LastLocationAt { get; set; }

    // Rating & level
    public double Rating { get; set; } = 5.0; // Rolling average 1-5
    public int TotalRatings { get; set; }
    public string Level { get; set; } = "bronze"; // bronze, silver, gold, platinum

    // Stats
    public int TotalRuns { get; set; }
    public int TotalContainersCollected { get; set; }
    public int CurrentStreakDays { get; set; }
    public int LongestStreakDays { get; set; }
    public DateTime? LastRunCompletedAt { get; set; }
    public double EfficiencyScore { get; set; } // containers/hour EMA
    public List<string> Badges { get; set; } = [];
    public int LifetimeEarningsCents { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Run> Runs { get; set; } = [];
}
