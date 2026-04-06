namespace GoodSort.Api.Data.Entities;

public class Profile
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "New User";
    public string? Phone { get; set; }
    public Guid? HouseholdId { get; set; }
    public Household? Household { get; set; }
    public string Role { get; set; } = "sorter"; // sorter, driver, both
    public int PendingCents { get; set; }
    public int ClearedCents { get; set; }
    public int TotalContainers { get; set; }
    public double TotalCo2SavedKg { get; set; }
    public List<string> Badges { get; set; } = [];
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Scan> Scans { get; set; } = [];
    public ICollection<Collection> Collections { get; set; } = [];
}
