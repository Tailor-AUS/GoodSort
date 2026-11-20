using System.Text.RegularExpressions;
using GoodSort.Api.Data.Entities;

namespace GoodSort.Api.Services;

/// <summary>
/// Fail-closed residential waitlist create. A house without a street number,
/// suburb + day cannot sit on the board, and apartments cannot sneak onto the pool.
/// </summary>
public static partial class WaitlistJoin
{
    [GeneratedRegex(
        @"^\s*(?:(?:unit|apt|apartment|flat|lot|shop|villa|townhouse|level|lvl|suite|u)\s*[a-z0-9]+\s*[\/,\s-]+\s*)?(?<num>\d+[a-z]?(?:\s*[\/-]\s*\d+[a-z]?)?)\s+(?<rest>[a-z][a-z0-9\s'.-]{1,})",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex LeadingStreetAddressRegex();

    public static bool HasStreetNumber(string? address) =>
        !string.IsNullOrWhiteSpace(address) && LeadingStreetAddressRegex().IsMatch(address);

    /// <summary>
    /// Canonical physical house key (SUBURB|NUMBER|STREET) so multiple accounts at the
    /// same street number cannot spoof MinHouseholdsForRun = 3 or self-farm Container Mafia.
    /// </summary>
    public static string? PhysicalHouseKey(string? suburb, string? address, string? explicitStreet = null)
    {
        var canonSuburb = BinDayService.CanonicalSuburb(suburb);
        if (canonSuburb is null || string.IsNullOrWhiteSpace(address)) return null;
        var m = LeadingStreetAddressRegex().Match(address);
        if (!m.Success) return null;

        var rawNum = Regex.Replace(m.Groups["num"].Value, @"\s+", "").ToUpperInvariant();
        // If unit/lot slash format like "2/14", keep "2/14" distinct for duplexes, or normalize whitespace
        var parsed = BinDayService.ParseAddress(address);
        var streetPart = !string.IsNullOrWhiteSpace(parsed?.Street)
            ? parsed!.Street
            : !string.IsNullOrWhiteSpace(explicitStreet)
                ? explicitStreet.Trim().ToUpperInvariant()
                : m.Groups["rest"].Value.Split(',')[0].Trim().ToUpperInvariant();
        streetPart = Regex.Replace(streetPart, @"\s+", " ").Trim();
        return string.IsNullOrEmpty(streetPart) ? null : $"{canonSuburb}|{rawNum}|{streetPart}";
    }

    public static string? RejectCreate(Household h)
    {
        if (string.Equals(h.Type, "unit_complex", StringComparison.OrdinalIgnoreCase))
            return "Use the building waitlist for apartments.";
        if (!HasStreetNumber(h.Address))
            return "Include your street number (for example, 12 Beaudesert Rd) so a Runner can find your kerb.";
        if (BinDayService.CanonicalSuburb(h.Suburb) is null)
            return "Pick your suburb and recycling day so we can put you on a street waitlist.";
        if (h.CouncilCollectionDay is null or < 0 or > 6)
            return "Pick your suburb and recycling day so we can put you on a street waitlist.";
        if (!h.AccessConsent)
            return "Tick the box so we can contact you when we launch your street.";
        return null;
    }
}
