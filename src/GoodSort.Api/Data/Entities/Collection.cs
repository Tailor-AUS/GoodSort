namespace GoodSort.Api.Data.Entities;

public class Collection
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Profile User { get; set; } = null!;
    public Guid RouteId { get; set; }
    public CollectionRoute Route { get; set; } = null!;
    public int StopCount { get; set; }
    public int TotalContainers { get; set; }
    public int EarnedCents { get; set; }
    public string? DepotName { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
