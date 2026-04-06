namespace GoodSort.Api.Data.Entities;

public class Household
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string Address { get; set; } = "";
    public double Lat { get; set; }
    public double Lng { get; set; }
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
