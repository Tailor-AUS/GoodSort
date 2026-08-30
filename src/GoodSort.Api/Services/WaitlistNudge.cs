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

    public static IReadOnlyList<Profile> Recipients(IEnumerable<Profile> members, Guid? excludeProfileId)
    {
        return members
            .Where(m => !string.IsNullOrWhiteSpace(m.Email))
            .Where(m => excludeProfileId is not Guid id || m.Id != id)
            .ToList();
    }
}
