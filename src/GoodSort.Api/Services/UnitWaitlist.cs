namespace GoodSort.Api.Services;

/// <summary>
/// Common-area / body-corporate waitlist. These households do not unlock a
/// street run. They still get a suburb so they can invite kerbside houses.
/// </summary>
public static class UnitWaitlist
{
    public static string? ResolveSuburb(string? clientSuburb, string? parsedSuburb) =>
        BinDayService.CanonicalSuburb(clientSuburb)
        ?? BinDayService.CanonicalSuburb(parsedSuburb);
}
