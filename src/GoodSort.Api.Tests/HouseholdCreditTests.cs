using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

public class HouseholdCreditTests
{
    [Fact]
    public void Unscanned_pickup_credits_five_cents_each()
    {
        var owner = new Profile { Name = "Owner", PendingCents = 0, ClearedCents = 0 };
        var credit = HouseholdCredit.ApplyPickup([owner], [], 40);
        Assert.Equal(200, credit);
        Assert.Equal(200, owner.ClearedCents);
        Assert.Equal(0, owner.PendingCents);
    }

    [Fact]
    public void Scans_do_not_double_pay_on_top_of_runner_count()
    {
        var owner = new Profile { Name = "Owner", PendingCents = 50, ClearedCents = 0 };
        var tenScans = Enumerable.Range(0, 10)
            .Select(_ => new Scan { UserId = owner.Id, RefundCents = 5, Status = "pending" })
            .ToList();

        var credit = HouseholdCredit.ApplyPickup([owner], tenScans, 40);
        Assert.Equal(200, credit);
        Assert.Equal(200, owner.ClearedCents);
        Assert.Equal(0, owner.PendingCents);
        Assert.All(tenScans, s => Assert.Equal("settled", s.Status));
    }

    [Fact]
    public void Waitlisted_bins_never_generate_a_run()
    {
        Assert.False(HouseholdCredit.HouseholdBinIsRunnable(BinStatuses.Waitlisted, true, 40));
        Assert.False(HouseholdCredit.HouseholdBinIsRunnable(BinStatuses.Allocated, true, 40));
        Assert.True(HouseholdCredit.HouseholdBinIsRunnable(BinStatuses.Collecting, true, 0));
        Assert.True(HouseholdCredit.HouseholdBinIsRunnable(BinStatuses.Delivered, false, 8));
        Assert.False(HouseholdCredit.HouseholdBinIsRunnable(BinStatuses.Collecting, false, 0));
    }

    [Fact]
    public void Unscanned_kerb_bins_use_a_density_estimate()
    {
        Assert.Equal(20, HouseholdCredit.EstimatedContainers(0));
        Assert.Equal(37, HouseholdCredit.EstimatedContainers(37));
    }
}
