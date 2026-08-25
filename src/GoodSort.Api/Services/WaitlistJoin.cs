using GoodSort.Api.Data.Entities;

namespace GoodSort.Api.Services;

/// <summary>
/// Fail-closed residential waitlist create. A house without suburb + day
/// cannot sit on the board, and apartments cannot sneak onto the 12.
/// </summary>
public static class WaitlistJoin
{
    public static string? RejectCreate(Household h)
    {
        if (string.Equals(h.Type, "unit_complex", StringComparison.OrdinalIgnoreCase))
            return "Use the building waitlist for apartments.";
        if (BinDayService.CanonicalSuburb(h.Suburb) is null)
            return "Pick your suburb and recycling day so we can put you on a street waitlist.";
        if (h.CouncilCollectionDay is null or < 0 or > 6)
            return "Pick your suburb and recycling day so we can put you on a street waitlist.";
        if (!h.AccessConsent)
            return "Tick the box so we can contact you when we launch your street.";
        return null;
    }
}
