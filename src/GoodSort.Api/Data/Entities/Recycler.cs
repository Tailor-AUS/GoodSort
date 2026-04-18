namespace GoodSort.Api.Data.Entities;

/// <summary>
/// A recycler endpoint — where pre-sorted material gets delivered.
/// Each recycler accepts specific material streams. The run optimizer
/// builds routes FROM houses TO the recycler, not generic suburb loops.
/// </summary>
public class Recycler
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string Address { get; set; } = "";
    public double Lat { get; set; }
    public double Lng { get; set; }

    // What material streams this recycler accepts
    public string AcceptedStreams { get; set; } = ""; // comma-separated: "aluminium,steel" or "glass_clear,glass_brown,glass_green" or "pet_clear,pet_coloured"

    // Commercial terms
    public int PricePerKgCents { get; set; }   // what they pay us per kg (commodity value)
    public int MinDeliveryKg { get; set; }       // minimum weight per delivery
    public int MaxDeliveryKg { get; set; }       // max they'll accept in one drop
    public string PaymentTerms { get; set; } = ""; // "cash on delivery", "net 14", etc.

    // Agreement status
    public string Status { get; set; } = "prospect"; // prospect, contacted, negotiating, agreed, active
    public string? ContactName { get; set; }
    public string? ContactEmail { get; set; }
    public string? ContactPhone { get; set; }
    public string? Notes { get; set; }

    // Operating hours (when runners can deliver)
    public string? OperatingHours { get; set; } // e.g. "Mon-Fri 7am-4pm, Sat 7am-12pm"

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
