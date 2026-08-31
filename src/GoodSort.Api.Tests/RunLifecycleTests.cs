using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

/// <summary>
/// Which run statuses hold a bin, and which mean nobody has committed yet.
///
/// This was written inline in two places and the copies had drifted.
/// GenerateRuns treated a "delivering" run as holding its bin;
/// AbsorbFullBinHouseholds did not, under a comment saying "whose bin is NOT
/// already in an active run". A run goes to "delivering" when the driver has
/// the containers in the vehicle and is on the way to the depot, so that gap
/// let a household be absorbed into a second run while its containers were
/// already collected — another driver sent to a kerb the first had emptied,
/// and the bin is at its emptiest exactly then.
///
/// The failure is silent in both directions. Miss a live status and bins get
/// claimed twice; include a terminal one and bins are stranded, so a
/// household's containers are never collected and their credit never clears.
/// These tests state the sets as facts so a new status has to be placed
/// deliberately.
/// </summary>
public class RunLifecycleTests
{
    /// <summary>Every status a run can be in, so the two sets can be checked against the whole.</summary>
    private static readonly string[] AllStatuses =
    [
        "available", "below_threshold", "claimed", "in_progress",
        "delivering", "completed", "settled", "expired", "cancelled",
    ];

    [Fact]
    public void A_run_being_delivered_still_holds_its_bin()
    {
        // The drift that was there. The driver has the containers; the kerb is
        // empty. Nothing else may be sent to it.
        Assert.Contains("delivering", RunLifecycle.HoldsBin);
    }

    [Fact]
    public void Every_stage_a_driver_is_mid_job_holds_its_bin()
    {
        foreach (var live in new[] { "available", "below_threshold", "claimed", "in_progress", "delivering" })
            Assert.Contains(live, RunLifecycle.HoldsBin);
    }

    [Fact]
    public void A_finished_run_releases_its_bin()
    {
        // The other direction: a terminal status listed here strands the bin,
        // and the household's containers are never collected again.
        foreach (var terminal in new[] { "completed", "settled", "expired", "cancelled" })
            Assert.DoesNotContain(terminal, RunLifecycle.HoldsBin);
    }

    [Fact]
    public void Every_status_is_either_holding_or_terminal()
    {
        // Forces a new status to be placed deliberately rather than defaulting
        // to "not holding", which is the direction that double-claims bins.
        var unaccounted = AllStatuses
            .Where(s => !RunLifecycle.HoldsBin.Contains(s))
            .Where(s => s is not ("completed" or "settled" or "expired" or "cancelled"))
            .ToList();

        Assert.True(unaccounted.Count == 0,
            "These run statuses are neither holding a bin nor terminal: " + string.Join(", ", unaccounted));
    }

    [Fact]
    public void Unclaimed_means_no_driver_has_committed()
    {
        Assert.Equal(new[] { "available", "below_threshold" }, RunLifecycle.Unclaimed);
    }

    [Fact]
    public void A_claimed_run_is_never_treated_as_unclaimed()
    {
        // Both uses of this set would do harm otherwise: absorbing a stop into
        // a claimed run changes the job the driver accepted, and expiring one
        // cancels work already underway.
        foreach (var taken in new[] { "claimed", "in_progress", "delivering" })
            Assert.DoesNotContain(taken, RunLifecycle.Unclaimed);
    }

    [Fact]
    public void Anything_unclaimed_still_holds_its_bin()
    {
        // Unclaimed is a subset of HoldsBin. A run nobody has taken still owns
        // its bins, or the same bins would be clustered into a second run.
        Assert.All(RunLifecycle.Unclaimed, s => Assert.Contains(s, RunLifecycle.HoldsBin));
    }
}
