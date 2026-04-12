namespace GoodSort.Api.Data.Entities;

public class RunStop
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid RunId { get; set; }
    public Run Run { get; set; } = null!;

    public Guid BinId { get; set; }
    public Bin Bin { get; set; } = null!;

    // Privacy — pickup instruction only, no names/addresses
    public string? PickupInstruction { get; set; } // "Collect from front porch"

    // Navigation — lat/lng only, address never in our UI
    public double Lat { get; set; }
    public double Lng { get; set; }

    // Container info
    public int EstimatedContainers { get; set; }
    public int? ActualContainers { get; set; }
    public MaterialBreakdown? Materials { get; set; }

    // Status: pending → arrived → picked_up → skipped → issue_reported
    public string Status { get; set; } = "pending";
    public DateTime? ArrivedAt { get; set; }
    public DateTime? PickedUpAt { get; set; }

    // Verification photo
    public string? PhotoUrl { get; set; }

    public int Sequence { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
