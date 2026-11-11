using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

/// <summary>
/// The launch bonus is bounded marketing spend, not a rate change. The trip
/// economics still rest on the standard credit The Good Sort retains, so the
/// per-suburb run threshold must be unaffected by it.
/// </summary>
public class LaunchBonusTests
{
    const int Cap = 20;

    [Fact]
    public void Bonus_is_double_the_standard_rate()
    {
        Assert.Equal(10, HouseholdCredit.CentsPerContainer);
        Assert.Equal(HouseholdCredit.CentsPerContainer * 2, LaunchBonus.CentsPerContainer);
    }

    [Fact]
    public void First_containers_earn_the_bonus()
    {
        Assert.Equal(LaunchBonus.CentsPerContainer, LaunchBonus.CentsForContainerAt(0, Cap));
        Assert.Equal(LaunchBonus.CentsPerContainer, LaunchBonus.CentsForContainerAt(Cap - 1, Cap));
    }

    [Fact]
    public void Containers_past_the_cap_earn_the_standard_rate()
    {
        Assert.Equal(HouseholdCredit.CentsPerContainer, LaunchBonus.CentsForContainerAt(Cap, Cap));
        Assert.Equal(HouseholdCredit.CentsPerContainer, LaunchBonus.CentsForContainerAt(5000, Cap));
    }

    [Fact]
    public void Total_spend_per_member_is_capped()
    {
        // Even scanning a thousand containers, the grant never exceeds the cap.
        var cents = LaunchBonus.TotalCents(alreadyScanned: 0, newContainers: 1000, Cap);
        var standard = 1000 * HouseholdCredit.CentsPerContainer;
        Assert.Equal(standard + Cap * LaunchBonus.ExtraCentsPerContainer, cents);
    }

    [Fact]
    public void A_batch_straddling_the_cap_splits_correctly()
    {
        // 18 already scanned, 5 more: 2 at bonus, 3 at standard.
        Assert.Equal(2, LaunchBonus.QualifyingContainers(18, 5, Cap));
        Assert.Equal(2 * LaunchBonus.CentsPerContainer + 3 * HouseholdCredit.CentsPerContainer, LaunchBonus.TotalCents(18, 5, Cap));
    }

    [Fact]
    public void A_returning_member_past_the_cap_gets_no_bonus()
    {
        Assert.Equal(0, LaunchBonus.QualifyingContainers(Cap, 10, Cap));
        Assert.Equal(10 * HouseholdCredit.CentsPerContainer, LaunchBonus.TotalCents(Cap, 10, Cap));
    }

    [Fact]
    public void Cap_of_zero_disables_the_promotion_entirely()
    {
        Assert.Equal(0, LaunchBonus.QualifyingContainers(0, 50, cap: 0));
        Assert.Equal(50 * HouseholdCredit.CentsPerContainer, LaunchBonus.TotalCents(0, 50, cap: 0));
        Assert.Equal(HouseholdCredit.CentsPerContainer, LaunchBonus.CentsForContainerAt(0, cap: 0));
    }

    [Fact]
    public void Negative_and_zero_batches_are_safe()
    {
        Assert.Equal(0, LaunchBonus.TotalCents(0, 0, Cap));
        Assert.Equal(0, LaunchBonus.TotalCents(0, -5, Cap));
        Assert.Equal(0, LaunchBonus.QualifyingContainers(-3, -1, Cap));
    }

    [Fact]
    public void Bonus_portion_is_recoverable_from_a_written_scan()
    {
        Assert.Equal(LaunchBonus.ExtraCentsPerContainer, LaunchBonus.BonusPortionOf(LaunchBonus.CentsPerContainer));
        Assert.Equal(0, LaunchBonus.BonusPortionOf(HouseholdCredit.CentsPerContainer));
        Assert.Equal(0, LaunchBonus.BonusPortionOf(0));
    }

    [Fact]
    public void Settle_clears_the_bonus_but_still_drops_the_estimate()
    {
        var initialPending = 2 * LaunchBonus.CentsPerContainer + 2 * HouseholdCredit.CentsPerContainer;
        var member = new Profile { Id = Guid.NewGuid(), PendingCents = initialPending };
        var scans = new List<Scan>
        {
            new() { UserId = member.Id, RefundCents = LaunchBonus.CentsPerContainer, Status = "pending" },
            new() { UserId = member.Id, RefundCents = LaunchBonus.CentsPerContainer, Status = "pending" },
            new() { UserId = member.Id, RefundCents = HouseholdCredit.CentsPerContainer, Status = "pending" },
        };

        var runnerCredit = HouseholdCredit.ApplyPickup([member], scans, pickupCount: 3);

        Assert.All(scans, s => Assert.Equal("settled", s.Status));
        Assert.Equal(HouseholdCredit.CentsPerContainer, member.PendingCents);
        // Runner count is the truth for the containers, plus the two bonus grants.
        Assert.Equal(runnerCredit + 2 * LaunchBonus.ExtraCentsPerContainer, member.ClearedCents);
    }

    [Fact]
    public void Settle_without_any_bonus_is_unchanged()
    {
        var member = new Profile { Id = Guid.NewGuid(), PendingCents = 2 * HouseholdCredit.CentsPerContainer };
        var scans = new List<Scan>
        {
            new() { UserId = member.Id, RefundCents = HouseholdCredit.CentsPerContainer, Status = "pending" },
            new() { UserId = member.Id, RefundCents = HouseholdCredit.CentsPerContainer, Status = "pending" },
        };

        var runnerCredit = HouseholdCredit.ApplyPickup([member], scans, pickupCount: 2);

        Assert.Equal(0, member.PendingCents);
        Assert.Equal(runnerCredit, member.ClearedCents);
    }
}
