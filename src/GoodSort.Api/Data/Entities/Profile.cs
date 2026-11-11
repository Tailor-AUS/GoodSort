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
    public int PendingCents { get; set; }
    public int ClearedCents { get; set; }
    public int TotalContainers { get; set; }
    public double TotalCo2SavedKg { get; set; }
    public List<string> Badges { get; set; } = [];
    public Guid? ReferrerId { get; set; } // ID of the user who invited this one
    /// <summary>
    /// When we last sent this member a neighbour-progress nudge. Used to
    /// throttle: the nudge fires on every qualifying join and mails every
    /// waitlisted member in the suburb, so without this the volume is quadratic
    /// in suburb size — 50 members joining over a week is ~1,225 emails. Email
    /// deliverability is the only door into this product, so burning the
    /// sending domain's reputation would close it, slowly and invisibly.
    /// </summary>
    public DateTime? LastNudgedAt { get; set; }

    // Saved payout destination (PayID or BSB + account) captured after scanning
    // or in account settings so cleared credits can be paid out cleanly.
    public string? PreferredPayoutMethod { get; set; } // "payid" | "aba"
    public string? PayIdType { get; set; } // "email" | "phone" | "abn"
    public string? PayIdValue { get; set; }
    public string? BankBsb { get; set; }
    public string? BankAccountNumber { get; set; }
    public string? BankAccountName { get; set; }
    public DateTime? PayoutUpdatedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Scan> Scans { get; set; } = [];
    public ICollection<Collection> Collections { get; set; } = [];
}
