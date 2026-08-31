using GoodSort.Api.Data.Entities;

namespace GoodSort.Api.Services;

/// <summary>
/// Neighbour emails when suburb scan volume moves. City-wide totals never
/// trigger a nudge. Crossing LiveThreshold is a different email.
/// </summary>
public static class WaitlistNudge
{
    public static bool ShouldNudgeOthers(int containersInSuburb, bool live) =>
        containersInSuburb >= 2 && !live && containersInSuburb < WaitlistDensity.LiveThreshold;

    /// <summary>
    /// At most one neighbour nudge per member per day. The nudge fires on every
    /// qualifying join and targets every waitlisted member in the suburb, so
    /// the unthrottled volume is quadratic in suburb size — fifty members
    /// joining over a week is roughly 1,225 emails. Email is the only way into
    /// this product, so protecting the sending domain's reputation protects the
    /// front door.
    /// </summary>
    public static readonly TimeSpan NudgeCooldown = TimeSpan.FromHours(24);

    public static bool MayNudge(Profile member, DateTime utcNow) =>
        member.LastNudgedAt is not DateTime last || utcNow - last >= NudgeCooldown;

    /// <summary>
    /// Recipients for a one-off announcement such as a suburb unlocking. NOT
    /// cooldown-filtered: the unlock is rare and important, and dropping it for
    /// someone who happened to get a progress nudge that day would silently
    /// withhold the one email they actually care about.
    /// </summary>
    public static IReadOnlyList<Profile> Recipients(IEnumerable<Profile> members, Guid? excludeProfileId)
    {
        return members
            .Where(m => !string.IsNullOrWhiteSpace(m.Email))
            .Where(m => excludeProfileId is not Guid id || m.Id != id)
            .ToList();
    }

    /// <summary>Recipients for the repeating progress nudge — cooldown applies.</summary>
    public static IReadOnlyList<Profile> NudgeRecipients(
        IEnumerable<Profile> members, Guid? excludeProfileId, DateTime? utcNow = null)
    {
        var now = utcNow ?? DateTime.UtcNow;
        return Recipients(members, excludeProfileId).Where(m => MayNudge(m, now)).ToList();
    }
}
