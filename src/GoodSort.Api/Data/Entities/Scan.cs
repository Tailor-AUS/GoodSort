namespace GoodSort.Api.Data.Entities;

public class Scan
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Profile User { get; set; } = null!;
    public Guid HouseholdId { get; set; }
    public Household Household { get; set; } = null!;
    public string Barcode { get; set; } = "";
    public string ContainerName { get; set; } = "";
    public string Material { get; set; } = "aluminium";
    public int RefundCents { get; set; } = 10;
    public string Status { get; set; } = "pending"; // pending, in_route, settled
    public Guid? RouteId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
