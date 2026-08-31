using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

/// <summary>
/// The migration that introduced Household.Type used defaultValue "", so every
/// household predating it carries an empty Type rather than "residential".
///
/// Matching on == "residential" therefore rejected those rows from BOTH
/// CountsTowardCluster and IsIncompleteResidential — counted nowhere, flagged
/// nowhere. That is how the single household in production stayed invisible
/// even after we shipped a count built specifically to surface it, which is
/// what checking the prediction against prod revealed.
///
/// The rule is now "a unit complex only if it says so", matching
/// residentialNeedsStreet in lib/brisbane.ts, which always worked that way.
/// </summary>
public class LegacyHouseholdTypeTests
{
    static HouseholdClusterRow Row(string? type, string? suburb) =>
        new(suburb, 5, type ?? "", 0, BinStatuses.Waitlisted);

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("residential")]
    [InlineData("RESIDENTIAL")]
    public void Anything_that_is_not_a_unit_complex_is_a_house(string? type)
    {
        Assert.True(WaitlistDensity.IsResidential(type));
    }

    [Theory]
    [InlineData("unit_complex")]
    [InlineData("UNIT_COMPLEX")]
    public void A_unit_complex_is_not(string type)
    {
        Assert.False(WaitlistDensity.IsResidential(type));
    }

    [Fact]
    public void A_legacy_row_with_empty_type_and_no_suburb_is_now_visible()
    {
        // The exact production row. Previously invisible in both directions.
        var board = WaitlistDensity.Aggregate([Row("", null)]);

        Assert.Equal(1, board.IncompleteHouseholds);
        Assert.Equal(0, board.TotalHouseholds);
    }

    [Fact]
    public void A_legacy_row_with_a_real_suburb_counts_toward_its_run()
    {
        // It is a real house on a real street; an empty Type column is an
        // artefact of a migration, not a statement about the dwelling.
        var board = WaitlistDensity.Aggregate([Row("", "Moorooka")]);

        Assert.Equal(1, board.TotalHouseholds);
        Assert.Equal(0, board.IncompleteHouseholds);
        Assert.Equal("MOOROOKA", Assert.Single(board.Suburbs).Suburb);
    }

    [Fact]
    public void A_unit_complex_is_still_neither_counted_nor_chased()
    {
        var board = WaitlistDensity.Aggregate([Row("unit_complex", null), Row("unit_complex", "Moorooka")]);

        Assert.Equal(0, board.TotalHouseholds);
        Assert.Equal(0, board.IncompleteHouseholds);
    }
}
