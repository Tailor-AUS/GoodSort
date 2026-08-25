using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

public class AddressParseTests
{
    [Fact]
    public void Photon_district_format_clusters_moorooka_not_brisbane()
    {
        var parsed = BinDayService.ParseAddress("12 Beaudesert Road, Moorooka QLD 4105");
        Assert.NotNull(parsed);
        Assert.Equal("12", parsed!.HouseNumber);
        Assert.Equal("BEAUDESERT RD", parsed.Street);
        Assert.Equal("MOOROOKA", BinDayService.CanonicalSuburb(parsed.Suburb));
    }

    [Fact]
    public void City_wide_brisbane_never_clusters()
    {
        var parsed = BinDayService.ParseAddress("12 Beaudesert Road, Brisbane QLD 4105");
        Assert.NotNull(parsed);
        Assert.Null(BinDayService.CanonicalSuburb(parsed!.Suburb));
        Assert.Null(BinDayService.CanonicalSuburb("Brisbane"));
        Assert.Null(BinDayService.CanonicalSuburb("QUEENSLAND"));

        var photonOld = BinDayService.ParseAddress("12 Beaudesert Road, Brisbane Queensland 4105");
        Assert.NotNull(photonOld);
        Assert.Null(BinDayService.CanonicalSuburb(photonOld!.Suburb));
    }

    [Fact]
    public void Brisbane_city_locality_is_kept()
    {
        Assert.Equal("BRISBANE CITY", BinDayService.CanonicalSuburb("Brisbane City"));
    }

    [Fact]
    public void Client_suburb_beats_bad_address_city()
    {
        var parsed = BinDayService.ParseAddress("12 Beaudesert Road, Brisbane Queensland 4105");
        var suburb = BinDayService.CanonicalSuburb("Moorooka")
            ?? (parsed is not null ? BinDayService.CanonicalSuburb(parsed.Suburb) : null);
        Assert.Equal("MOOROOKA", suburb);
    }
}
