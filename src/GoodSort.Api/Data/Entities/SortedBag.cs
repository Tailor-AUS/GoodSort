namespace GoodSort.Api.Data.Entities;

/// <summary>
/// A physical pre-sorted household bag tagged with a QR code for one of the four
/// COEX Secondary-Sorted CRP streams: aluminium, pet_clear, pet_coloured, glass.
/// Links household Scan rows to kerbside Runner verification and CRP audits.
/// </summary>
public class SortedBag
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>
    /// Non-enumerable cryptographic bag code, e.g. "GSB-ALU-7K9M2X4P".
    /// </summary>
    public string Code { get; set; } = "";

    public Guid HouseholdId { get; set; }
    public Household Household { get; set; } = null!;

    public Guid CreatorProfileId { get; set; }

    /// <summary>
    /// Stream key: "aluminium", "pet_clear", "pet_coloured", or "glass".
    /// </summary>
    public string Stream { get; set; } = "aluminium";

    public int DeclaredContainers { get; set; }
    public int LinkedScanCount { get; set; }
    public int? VerifiedContainers { get; set; }

    public bool ContaminationFlag { get; set; }
    public string? DiscrepancyCode { get; set; }
    public string? DiscrepancyNote { get; set; }

    /// <summary>
    /// Lifecycle: "sealed" → "on_kerb" → "picked_up" → "verified" (or "cancelled").
    /// </summary>
    public string Status { get; set; } = "sealed";

    public Guid? RunId { get; set; }
    public Guid? RunStopId { get; set; }
    public Guid? PickedUpByRunnerId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? KerbAt { get; set; }
    public DateTime? PickedUpAt { get; set; }
    public DateTime? VerifiedAt { get; set; }
}
