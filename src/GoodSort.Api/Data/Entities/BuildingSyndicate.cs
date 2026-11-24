namespace GoodSort.Api.Data.Entities;

public static class SyndicateStatuses
{
    public const string Detected = "detected";
    public const string Official = "official";
    public const string Paused = "paused";

    public static readonly string[] All = [Detected, Official, Paused];
}

public static class SyndicatePickupStatuses
{
    public const string None = "none";
    public const string Requested = "requested";
    public const string Scheduled = "scheduled";

    public static readonly string[] All = [None, Requested, Scheduled];
}

public static class SyndicateMemberStatuses
{
    public const string Pending = "pending";
    public const string Approved = "approved";
    public const string Rejected = "rejected";
}

public static class SyndicateRoles
{
    public const string Captain = "captain";
    public const string Member = "member";
}

public static class SyndicateDropSpots
{
    public const string BinRoom = "bin_room";
    public const string LoadingDock = "loading_dock";
    public const string Lobby = "lobby";
    public const string Kerbside = "kerbside";

    public static readonly string[] All = [BinRoom, LoadingDock, Lobby, Kerbside];

    public static string Label(string? code) => code switch
    {
        BinRoom => "Bin room",
        LoadingDock => "Loading dock",
        Lobby => "Lobby / mailroom",
        Kerbside => "Street kerb",
        _ => "Not set",
    };
}

public static class SyndicatePickupWindows
{
    public const string WeekdayAm = "weekday_am";
    public const string WeekdayPm = "weekday_pm";
    public const string SaturdayAm = "saturday_am";

    public static readonly string[] All = [WeekdayAm, WeekdayPm, SaturdayAm];

    public static string Label(string? code) => code switch
    {
        WeekdayAm => "Weekday morning",
        WeekdayPm => "Weekday afternoon",
        SaturdayAm => "Saturday morning",
        _ => "Flexible",
    };
}

public class BuildingSyndicate
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string BuildingKey { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Suburb { get; set; } = "";
    public string BuildingKind { get; set; } = "residential"; // "commercial" | "residential" | "mixed"
    public string Status { get; set; } = SyndicateStatuses.Detected; // "detected" | "official" | "paused"
    public string PickupStatus { get; set; } = SyndicatePickupStatuses.None; // "none" | "requested" | "scheduled"
    public string? DropSpot { get; set; }
    public string? PickupWindow { get; set; }
    public DateTime? PickupRequestedAt { get; set; }
    public string? PickupRequestedByHandle { get; set; }
    public DateTime? OfficialApprovedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<BuildingSyndicateMember> Members { get; set; } = [];
    public ICollection<BuildingSyndicateMessage> Messages { get; set; } = [];
}

public class BuildingSyndicateMember
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SyndicateId { get; set; }
    public BuildingSyndicate Syndicate { get; set; } = null!;
    public Guid ProfileId { get; set; }
    public Profile Profile { get; set; } = null!;
    public string AnonHandle { get; set; } = "Sorter #1";
    public string Role { get; set; } = SyndicateRoles.Member; // "captain" | "member"
    public string Status { get; set; } = SyndicateMemberStatuses.Pending; // "pending" | "approved" | "rejected"
    public bool ReadyToPool { get; set; } = false;
    public string? VotedDropSpot { get; set; }
    public string? VotedPickupWindow { get; set; }
    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ApprovedAt { get; set; }
}

public class BuildingSyndicateMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SyndicateId { get; set; }
    public BuildingSyndicate Syndicate { get; set; } = null!;
    public Guid? MemberId { get; set; }
    public string AnonHandle { get; set; } = "System";
    public string Kind { get; set; } = "chat"; // "chat" | "system"
    public string Body { get; set; } = "";
    public bool Flagged { get; set; } = false;
    public int FlagCount { get; set; } = 0;
    public bool Hidden { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
