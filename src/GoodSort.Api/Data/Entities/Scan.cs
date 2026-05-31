namespace GoodSort.Api.Data.Entities;

public class Scan
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Profile User { get; set; } = null!;
    public Guid? HouseholdId { get; set; } // Legacy — nullable
    public Guid? BinId { get; set; } // New — links scan to physical bin
    public Bin? Bin { get; set; }
    public string? BinCode { get; set; } // Denormalized for display
    public string Barcode { get; set; } = "";
    public string ContainerName { get; set; } = "";
    public string Material { get; set; } = "aluminium";
    public int RefundCents { get; set; } = 5; // Sorting credit, not CDS refund
    public string Status { get; set; } = "pending"; // pending, in_route, settled
    public Guid? RouteId { get; set; }

    // ── Unattended-deposit verification context (anti-fraud) ──
    // Where the deposit was physically made, captured at /confirm. Lets us prove
    // the member was at the bin (geofence) rather than farming credit remotely,
    // and gives reconciliation a location trail. Null for the household/runner
    // photo-scan path that isn't a bin deposit.
    public double? DepositLat { get; set; }
    public double? DepositLng { get; set; }
    public double? DepositDistanceM { get; set; } // metres from the bin at confirm time
    public bool GeofenceVerified { get; set; }     // deposit was within the bin geofence
    // Perceptual (dHash) fingerprint of the deposit photo, as 16-char hex. Used
    // to reject replayed/duplicate photos: a confirm whose hash is within a small
    // Hamming distance of a recent accepted deposit (same bin or same user) is
    // refused. Null for the household/runner scan path.
    public string? PhotoHash { get; set; }
    // Future-proofing for serialised 2D codes (DDRS). When AU containers carry a
    // per-unit code, this holds it — the gold-standard single-use proof. Until
    // then it stays null and we rely on the event-verification layers.
    public string? SerialId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
