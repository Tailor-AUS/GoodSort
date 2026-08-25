using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

public class WaitlistJoinTests
{
    [Fact]
    public void Accepts_consented_residential_street()
        => Assert.Null(WaitlistJoin.RejectCreate(House("MOOROOKA", 5, consent: true)));

    [Fact]
    public void Rejects_city_wide_brisbane()
        => Assert.NotNull(WaitlistJoin.RejectCreate(House("BRISBANE", 5, consent: true)));

    [Fact]
    public void Rejects_missing_day()
        => Assert.NotNull(WaitlistJoin.RejectCreate(House("MOOROOKA", null, consent: true)));

    [Fact]
    public void Rejects_without_consent()
        => Assert.NotNull(WaitlistJoin.RejectCreate(House("MOOROOKA", 5, consent: false)));

    [Fact]
    public void Rejects_apartment_on_house_endpoint()
    {
        var h = House("WEST END", 1, consent: true);
        h.Type = "unit_complex";
        Assert.Contains("building", WaitlistJoin.RejectCreate(h), StringComparison.OrdinalIgnoreCase);
    }

    private static Household House(string? suburb, int? day, bool consent) => new()
    {
        Name = "Test",
        Address = "12 Beaudesert Road, Moorooka QLD 4105",
        Suburb = suburb,
        Type = "residential",
        CouncilCollectionDay = day,
        AccessConsent = consent,
        Lat = -27.527,
        Lng = 153.026,
    };
}
