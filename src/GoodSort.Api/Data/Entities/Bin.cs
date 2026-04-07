namespace GoodSort.Api.Data.Entities;

public class Bin
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Code { get; set; } = ""; // Short code for QR (e.g. "GS-0042")
    public string Name { get; set; } = "";
    public string Address { get; set; } = "";
    public double Lat { get; set; }
    public double Lng { get; set; }
    public string? HostedBy { get; set; } // "The Burrow Cafe" or null for public
    public int PendingContainers { get; set; }
    public int PendingValueCents { get; set; }
    public MaterialBreakdown Materials { get; set; } = new();
    public double EstimatedWeightKg { get; set; }
    public string Status { get; set; } = "active"; // active, full, collected, disabled
    public DateTime? LastScanAt { get; set; }
    public DateTime? LastCollectedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
