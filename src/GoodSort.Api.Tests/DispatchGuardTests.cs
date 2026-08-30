using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

/// <summary>
/// Volume alone must not dispatch a driver. Runners are paid strictly per
/// container with no per-trip base, so a run against one address that reports
/// the whole threshold pays the runner almost nothing for the trip.
/// </summary>
public class DispatchGuardTests
{
    [Fact]
    public void One_household_reporting_the_whole_threshold_cannot_dispatch()
    {
        Assert.True(WaitlistDensity.CanPurchase(5000));
        Assert.False(WaitlistDensity.CanDispatch(5000, householdsInSuburb: 1));
    }

    [Fact]
    public void Two_households_are_still_not_a_run()
    {
        Assert.False(WaitlistDensity.CanDispatch(1200, householdsInSuburb: 2));
    }

    [Fact]
    public void Threshold_volume_across_enough_doors_dispatches()
    {
        Assert.True(WaitlistDensity.CanDispatch(1000, householdsInSuburb: WaitlistDensity.MinHouseholdsForRun));
    }

    [Fact]
    public void Enough_doors_without_the_volume_does_not_dispatch()
    {
        Assert.False(WaitlistDensity.CanDispatch(999, householdsInSuburb: 40));
    }
}
