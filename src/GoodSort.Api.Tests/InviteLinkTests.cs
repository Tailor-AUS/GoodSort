using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

public class InviteLinkTests
{
    [Fact]
    public void Missing_suburb_never_falls_back_to_moorooka()
    {
        var url = InviteLink.StreetUrl(null, 5, Guid.Parse("11111111-1111-1111-1111-111111111111"));
        Assert.Equal("https://thegoodsort.org/?day=friday&r=11111111-1111-1111-1111-111111111111", url);
        Assert.DoesNotContain("moorooka", url);
    }

    [Fact]
    public void City_wide_brisbane_is_not_a_street()
    {
        var url = InviteLink.StreetUrl("BRISBANE", 5);
        Assert.Equal("https://thegoodsort.org/?day=friday", url);
    }

    [Fact]
    public void Same_day_invite_keeps_suburb_and_friday()
    {
        var id = Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
        var url = InviteLink.StreetUrl("MOOROOKA", 5, id);
        Assert.Equal("https://thegoodsort.org/brisbane/moorooka?day=friday&r=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", url);
    }

    [Theory]
    [InlineData("friday", 5)]
    [InlineData("Fri", 5)]
    [InlineData("5", 5)]
    [InlineData("monday", 1)]
    [InlineData("nope", null)]
    public void ParseDay_reads_slug_short_or_number(string raw, int? expected)
        => Assert.Equal(expected, InviteLink.ParseDay(raw));

    [Fact]
    public void Waitlisted_street_can_be_finished_collecting_cannot()
    {
        Assert.True(InviteLink.CanEditCluster(BinStatuses.Waitlisted));
        Assert.False(InviteLink.CanEditCluster(BinStatuses.Allocated));
        Assert.False(InviteLink.CanEditCluster(BinStatuses.Collecting));
    }
}
