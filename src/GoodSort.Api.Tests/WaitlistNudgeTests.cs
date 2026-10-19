using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

public class WaitlistNudgeTests
{
    private static readonly CollectionReadinessConfig Configured1000 =
        new(Configured: true, AluminiumThreshold: 1000, Source: "operator_config", FixtureLabel: null);

    [Fact]
    public void Unconfigured_threshold_never_nudges_towards_trip() =>
        Assert.False(WaitlistNudge.ShouldNudgeOthers(50, live: false));

    [Fact]
    public void First_container_does_not_nudge() =>
        Assert.False(WaitlistNudge.ShouldNudgeOthers(1, live: false, Configured1000));

    [Fact]
    public void Second_container_nudges_the_street() =>
        Assert.True(WaitlistNudge.ShouldNudgeOthers(2, live: false, Configured1000));

    [Fact]
    public void Below_threshold_still_nudges() =>
        Assert.True(WaitlistNudge.ShouldNudgeOthers(999, live: false, Configured1000));

    [Fact]
    public void At_threshold_is_unlock_email_not_nudge()
    {
        Assert.False(WaitlistNudge.ShouldNudgeOthers(1000, live: true, Configured1000));
        Assert.False(WaitlistNudge.ShouldNudgeOthers(1000, live: false, Configured1000));
        Assert.False(WaitlistNudge.ShouldNudgeOthers(1001, live: true, Configured1000));
    }

    [Fact]
    public void Recipients_skip_joiner_and_blank_email()
    {
        var joiner = new Profile { Id = Guid.NewGuid(), Email = "new@tgs.test", Name = "New" };
        var neighbour = new Profile { Id = Guid.NewGuid(), Email = "old@tgs.test", Name = "Old" };
        var noMail = new Profile { Id = Guid.NewGuid(), Email = "  ", Name = "Quiet" };

        var got = WaitlistNudge.Recipients([joiner, neighbour, noMail], joiner.Id);

        Assert.Equal(neighbour.Id, Assert.Single(got).Id);
    }
}
