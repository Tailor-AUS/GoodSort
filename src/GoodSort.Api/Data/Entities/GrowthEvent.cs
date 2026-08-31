namespace GoodSort.Api.Data.Entities;

/// <summary>
/// One first-party funnel event. Durable because the previous implementation
/// was an in-process dictionary: every deploy rolls the container image, so
/// counts reset on each push to main, and with more than one replica each held
/// its own partial view.
///
/// Deliberately carries NO user identifier. The funnel answers "how many people
/// reached this step", never "who". Email, profile id, household id, address,
/// lat/lng and barcodes must never appear here — all of them sit one
/// localStorage read away at the call sites, so keeping them out is an active
/// choice, not an accident. See GrowthEventPiiTests.
/// </summary>
public class GrowthEvent
{
    public long Id { get; set; }

    /// <summary>Event name, validated against the server allowlist before write.</summary>
    public string Name { get; set; } = "";

    /// <summary>Canonical suburb, or null for city-wide/unknown. Coarse by design.</summary>
    public string? Suburb { get; set; }

    /// <summary>Page path only — never the query string, which carries ?r={profileId}.</summary>
    public string? Path { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
