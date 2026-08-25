using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

public class DensityEmailCopyTests
{
    [Fact]
    public void Progress_tells_neighbours_the_collection_night_not_bin_orders()
    {
        var subject = DensityEmailCopy.ProgressSubject("Moorooka", "Friday", 9);
        var line = DensityEmailCopy.ProgressLine(3, "Friday", "Moorooka", 9);
        Assert.Contains("collection night", subject);
        Assert.Contains("collection night", line);
        Assert.DoesNotContain("bin", subject, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("order", line, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("waitlist", line, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Unlock_keeps_sorting_in_bags_and_does_not_wait_for_bins()
    {
        var subject = DensityEmailCopy.UnlockSubject("Moorooka", "Friday");
        var line = DensityEmailCopy.UnlockLine("Moorooka", "Friday");
        Assert.Contains("collection night", subject);
        Assert.Contains("own bags", line);
        Assert.DoesNotContain("order", subject, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("on the way", line, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Join_errors_match_sort_today_consent()
    {
        Assert.Contains("when we collect", DensityEmailCopy.ConsentRequired);
        Assert.DoesNotContain("launch", DensityEmailCopy.ConsentRequired, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("collection night", DensityEmailCopy.StreetRequired);
    }

    [Fact]
    public void Building_invite_points_houses_at_a_collection_night()
    {
        var line = DensityEmailCopy.BuildingInviteLine("Moorooka");
        Assert.Contains("collection night", line);
        Assert.DoesNotContain("purple-bin run", line);
    }
}
