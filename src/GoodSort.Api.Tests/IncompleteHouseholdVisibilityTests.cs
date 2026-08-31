using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

/// <summary>
/// Aggregate used to drop uncountable households silently, so the board could
/// not distinguish "nobody has joined" from "people joined and we cannot see
/// them". On 2026-08-31 production was in exactly the second state: one
/// household existed and zero were counted.
/// </summary>
public class IncompleteHouseholdVisibilityTests
{
    static HouseholdClusterRow Row(string? suburb, string type = "residential") =>
        new(suburb, 5, type, 0, BinStatuses.Waitlisted);

    [Fact]
    public void A_household_with_no_suburb_is_reported_rather_than_vanishing()
    {
        var board = WaitlistDensity.Aggregate([Row(null)]);

        Assert.Equal(1, board.IncompleteHouseholds);
        Assert.Equal(0, board.TotalHouseholds);   // still must not inflate demand
        Assert.Empty(board.Suburbs);
    }

    [Fact]
    public void A_city_wide_suburb_counts_as_incomplete_not_as_a_suburb()
    {
        // "BRISBANE" is non-empty but canonicalises to null — the variant that
        // produced no redirect and no prompt at all on the client.
        var board = WaitlistDensity.Aggregate([Row("BRISBANE"), Row("Queensland")]);

        Assert.Equal(2, board.IncompleteHouseholds);
        Assert.Empty(board.Suburbs);
    }

    [Fact]
    public void A_unit_complex_is_not_incomplete_it_is_a_different_category()
    {
        // Units deliberately never unlock a street. Counting them as unfinished
        // would send ops chasing members who have nothing to fix.
        var board = WaitlistDensity.Aggregate([Row("MOOROOKA", "unit_complex")]);

        Assert.Equal(0, board.IncompleteHouseholds);
        Assert.Equal(0, board.TotalHouseholds);
    }

    [Fact]
    public void Completing_a_household_moves_it_from_incomplete_to_counted()
    {
        var before = WaitlistDensity.Aggregate([Row(null)]);
        var after = WaitlistDensity.Aggregate([Row("Moorooka")]);

        Assert.Equal(1, before.IncompleteHouseholds);
        Assert.Equal(0, before.TotalHouseholds);

        Assert.Equal(0, after.IncompleteHouseholds);
        Assert.Equal(1, after.TotalHouseholds);
        Assert.Equal("MOOROOKA", Assert.Single(after.Suburbs).Suburb);
    }

    [Fact]
    public void Real_demand_and_latent_demand_are_reported_side_by_side()
    {
        var board = WaitlistDensity.Aggregate([
            Row("Moorooka"), Row("Moorooka"), Row(null), Row("BRISBANE"),
        ]);

        Assert.Equal(2, board.TotalHouseholds);
        Assert.Equal(2, board.IncompleteHouseholds);
    }
}
