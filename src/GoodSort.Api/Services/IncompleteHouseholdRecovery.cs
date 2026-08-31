using GoodSort.Api.Data.Entities;

namespace GoodSort.Api.Services;

/// <summary>
/// Who to reach out to when a member has joined but the server cannot count
/// them, and what may be said to them.
///
/// A residential household with no canonical suburb is invisible: it counts
/// toward no cluster, appears in no suburb on the public board, and — the part
/// that matters here — matches no recipient query. SendWaitlistProgress selects
/// members whose household suburb equals the suburb that moved, so a member
/// with a null or city-wide suburb is in nobody's list. They sign up, they
/// scan, their credit is real and safe, and then nothing ever reaches them
/// again unless they happen to return to the site by themselves.
///
/// Production has one of these right now. Recovering a member who already
/// signed up is the cheapest growth there is, and it is a fix for something we
/// broke rather than a marketing email.
///
/// Selection is deliberately narrow. This is not a re-engagement campaign: the
/// only people it may reach are those whose accounts are stuck because of a
/// gap in our own address handling, and only when they can actually act on it.
/// </summary>
public static class IncompleteHouseholdRecovery
{
    /// <summary>
    /// Far longer than the 24-hour progress-nudge cooldown. One reminder that a
    /// suburb is missing is help; a stream of them is nagging someone about a
    /// problem we caused.
    /// </summary>
    public static readonly TimeSpan Cooldown = TimeSpan.FromDays(7);

    /// <summary>
    /// Whether this member is stuck in a way this email can actually resolve.
    ///
    /// Deliberately excludes unit complexes: a building is not missing a
    /// street, it is on a different track entirely, and telling a resident to
    /// "add your suburb" would send them somewhere that refuses their address.
    /// </summary>
    public static bool NeedsRecovery(Profile member)
    {
        if (string.IsNullOrWhiteSpace(member.Email)) return false;

        var household = member.Household;
        if (household is null) return false;
        if (string.Equals(household.Type, "unit_complex", StringComparison.OrdinalIgnoreCase)) return false;

        // Exactly the server's own counting rule. A household holding the
        // literal string "BRISBANE" is non-empty yet canonicalises to null, so
        // a looser "is it blank" check would leave that member unreachable —
        // which is the whole failure being fixed.
        return BinDayService.CanonicalSuburb(household.Suburb) is null;
    }

    /// <summary>
    /// LastNudgedAt is shared with the progress nudge, which is safe precisely
    /// because these two audiences cannot overlap: the progress nudge selects
    /// on a matching suburb, and everyone here has no usable suburb at all.
    /// </summary>
    public static bool MayContact(Profile member, DateTime utcNow) =>
        member.LastNudgedAt is not DateTime last || utcNow - last >= Cooldown;

    public static IReadOnlyList<Profile> Recipients(IEnumerable<Profile> members, DateTime utcNow) =>
        members.Where(NeedsRecovery).Where(m => MayContact(m, utcNow)).ToList();

    /// <summary>
    /// Off unless ops turns it on. The code being ready is not the same as
    /// deciding to email real members, and that decision is a person's.
    /// </summary>
    public static bool Enabled(string? setting) =>
        string.Equals(setting?.Trim(), "true", StringComparison.OrdinalIgnoreCase);
}
