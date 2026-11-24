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
        @"^\s*(?:(?:unit|apt|apartment|flat|lot|shop|villa|townhouse|level|lvl|suite|u)\s*(?<unit>[a-z0-9]+)\s*[\/,\s-]+\s*)?(?<num>\d+[a-z]?(?:\s*[\/-]\s*\d+[a-z]?)?)\s+(?<rest>[a-z][a-z0-9\s'.-]{1,})",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex LeadingStreetAddressRegex();

    public static bool HasStreetNumber(string? address) =>
        !string.IsNullOrWhiteSpace(address) && LeadingStreetAddressRegex().IsMatch(address);

    /// <summary>
    /// Canonical physical house key (SUBURB|NUMBER|STREET) so multiple accounts at the
    /// same street number cannot spoof MinHouseholdsForRun = 3 or self-farm Container Mafia.
    /// Preserves unit/suite/level numbers as UNIT/NUMBER so distinct units in the same
    /// apartment block or commercial tower can each sign up while still deduplicating
    /// identical units (e.g. "Unit 12, 45 Ekibin Rd" == "12/45 Ekibin Rd").
    /// </summary>
    public static string? PhysicalHouseKey(string? suburb, string? address, string? explicitStreet = null)
    {
        var canonSuburb = BinDayService.CanonicalSuburb(suburb);
        if (canonSuburb is null || string.IsNullOrWhiteSpace(address)) return null;
        var m = LeadingStreetAddressRegex().Match(address);
        if (!m.Success) return null;

        var baseNum = Regex.Replace(m.Groups["num"].Value, @"\s+", "").ToUpperInvariant();
        var unitVal = m.Groups["unit"].Success ? m.Groups["unit"].Value.Trim().ToUpperInvariant() : "";
        var rawNum = !string.IsNullOrEmpty(unitVal) && !baseNum.Contains('/')
            ? $"{unitVal}/{baseNum}"
            : baseNum;
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
