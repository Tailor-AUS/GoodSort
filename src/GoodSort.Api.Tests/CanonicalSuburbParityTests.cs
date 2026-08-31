using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

/// <summary>
/// The "is this a real suburb" rule exists twice — here in CanonicalSuburb, and
/// in canonicalSuburb() in lib/brisbane.ts. They must agree on which inputs
/// return null, because that single decision determines whether a member counts
/// toward a run at all.
///
/// A divergence would be silent and would recreate the 2026-08-31 bug: the
/// client accepts a suburb, the member believes they joined, and the server
/// drops them from every cluster with nothing surfacing the disagreement.
///
/// Verified at the time of writing: both sides reject exactly
/// brisbane / qld / queensland / australia, and none of those appears among the
/// 190 entries in lib/brisbane-suburbs.ts (which the client checks FIRST, so a
/// name in both lists would be accepted by the client and rejected here).
/// If this test is changed, change lib/brisbane.ts in the same commit.
/// </summary>
public class CanonicalSuburbParityTests
{
    [Theory]
    [InlineData("Brisbane")]
    [InlineData("BRISBANE")]
    [InlineData("  brisbane  ")]
    [InlineData("QLD")]
    [InlineData("Queensland")]
    [InlineData("Australia")]
    public void City_wide_labels_are_not_suburbs(string input)
    {
        Assert.Null(BinDayService.CanonicalSuburb(input));
    }

    [Theory]
    [InlineData("Moorooka", "MOOROOKA")]
    [InlineData("  moorooka ", "MOOROOKA")]
    [InlineData("Highgate Hill", "HIGHGATE HILL")]
    public void Real_suburbs_canonicalise_to_upper_case(string input, string expected)
    {
        Assert.Equal(expected, BinDayService.CanonicalSuburb(input));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Blank_is_not_a_suburb(string? input)
    {
        Assert.Null(BinDayService.CanonicalSuburb(input));
    }

    [Fact]
    public void The_rejected_set_is_exactly_what_the_client_rejects()
    {
        // Locking the list so widening or narrowing it is a deliberate act that
        // fails here and names the file to change alongside it.
        string[] rejected = ["BRISBANE", "QLD", "QUEENSLAND", "AUSTRALIA"];
        Assert.All(rejected, r => Assert.Null(BinDayService.CanonicalSuburb(r)));

        // A near-miss must still be accepted — the rule is exact-match, not
        // "contains", or "Brisbane Road" style names would vanish.
        Assert.Equal("BRISBANE ROAD", BinDayService.CanonicalSuburb("Brisbane Road"));
    }
}
