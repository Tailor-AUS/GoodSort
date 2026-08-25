using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

public class UnitWaitlistTests
{
    [Fact]
    public void Client_suburb_beats_parsed_city() =>
        Assert.Equal("WEST END", UnitWaitlist.ResolveSuburb("West End", "Brisbane"));

    [Fact]
    public void Parsed_suburb_used_when_client_blank() =>
        Assert.Equal("MOOROOKA", UnitWaitlist.ResolveSuburb(null, "Moorooka"));

    [Fact]
    public void City_wide_label_never_stored() =>
        Assert.Null(UnitWaitlist.ResolveSuburb("Brisbane", "QLD"));
}
