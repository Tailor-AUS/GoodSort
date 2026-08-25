using GoodSort.Api.Data.Entities;

namespace GoodSort.Api.Services;

/// <summary>
/// Neighbour-join emails. The waitlist compounds when existing members hear
/// density moved and WhatsApp the street again. City-wide totals never
/// trigger a nudge. Unlock at 12 is a different email.
/// </summary>
public static class WaitlistNudge
{
    public static bool ShouldNudgeOthers(int householdsOnDay, bool live) =>
        householdsOnDay >= 2 && !live && householdsOnDay < WaitlistDensity.LiveThreshold;

    public static IReadOnlyList<Profile> Recipients(IEnumerable<Profile> members, Guid? excludeProfileId)
    {
        return members
            .Where(m => !string.IsNullOrWhiteSpace(m.Email))
            .Where(m => excludeProfileId is not Guid id || m.Id != id)
            .ToList();
    }
}
