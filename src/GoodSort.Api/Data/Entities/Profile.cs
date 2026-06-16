namespace GoodSort.Api.Data.Entities;

public class Profile
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "New User";
    public string? Email { get; set; } // Primary identity — email address
    public string? Phone { get; set; } // Legacy — was used for email before rename
    public Guid? HouseholdId { get; set; }
    public Household? Household { get; set; }
    public string Role { get; set; } = "sorter"; // sorter, driver, both
    public bool IsAdmin { get; set; } = false; // gated separately — admin endpoints check this, NOT Role

    // Revocation handle. Issued JWTs carry this as the "ss" claim; the auth layer
    // rejects a token whose "ss" no longer matches. Rotating it (sign-out-everywhere)
    // force-logs-out all of a profile's existing tokens. Tokens minted before this
    // column existed carry no "ss" claim and are grandfathered until they expire.
    public string SecurityStamp { get; set; } = Guid.NewGuid().ToString("N");
    public int PendingCents { get; set; }
    public int ClearedCents { get; set; }
    public int TotalContainers { get; set; }
    public double TotalCo2SavedKg { get; set; }
    public List<string> Badges { get; set; } = [];
    public Guid? ReferrerId { get; set; } // ID of the user who invited this one
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Scan> Scans { get; set; } = [];
    public ICollection<Collection> Collections { get; set; } = [];
}
