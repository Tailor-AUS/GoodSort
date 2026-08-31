using GoodSort.Api.Data.Entities;

namespace GoodSort.Api.Tests;

/// <summary>
/// One definition of "this household gets collected from".
///
/// BinStatuses.IsServiceable already existed and five in-memory callers used
/// it. EF cannot translate a method call into SQL, so every database query
/// needing the same rule spelled out "Delivered || Collecting" by hand —
/// three copies of a rule that already had a name, in RunGenerationService,
/// PickupReminderService and the admin pickup list.
///
/// That is how the run-status drift happened one PR earlier: a rule with two
/// spellings, one of which quietly fell behind. Nothing had drifted here yet.
/// The array exists so it cannot.
///
/// Getting it wrong is silent either way. Drop a serviceable status and those
/// households stop being collected from and stop getting pickup reminders, with
/// no error anywhere; add a non-serviceable one and drivers are sent to
/// households that have no bin yet.
/// </summary>
public class BinStatusConsistencyTests
{
    private static readonly string[] AllStatuses =
    [
        BinStatuses.Waitlisted,
        BinStatuses.Allocated,
        BinStatuses.Delivered,
        BinStatuses.Collecting,
    ];

    [Fact]
    public void The_array_and_the_predicate_cannot_disagree()
    {
        // The whole point of defining one in terms of the other. If these ever
        // diverge, an EF query and the in-memory code answer differently about
        // the same household.
        foreach (var status in AllStatuses)
            Assert.Equal(BinStatuses.Serviceable.Contains(status), BinStatuses.IsServiceable(status));
    }

    [Fact]
    public void A_household_with_a_bin_is_serviceable()
    {
        Assert.True(BinStatuses.IsServiceable(BinStatuses.Delivered));
        Assert.True(BinStatuses.IsServiceable(BinStatuses.Collecting));
    }

    [Fact]
    public void A_household_still_waiting_for_a_bin_is_not()
    {
        // Sending a driver to a waitlisted household means a stop with nothing
        // to collect, and telling an allocated one to bag out is a promise we
        // cannot keep yet.
        Assert.False(BinStatuses.IsServiceable(BinStatuses.Waitlisted));
        Assert.False(BinStatuses.IsServiceable(BinStatuses.Allocated));
    }

    [Fact]
    public void Nothing_unknown_is_serviceable()
    {
        Assert.False(BinStatuses.IsServiceable(null));
        Assert.False(BinStatuses.IsServiceable(""));
        Assert.False(BinStatuses.IsServiceable("paused"));
        Assert.False(BinStatuses.IsServiceable("DELIVERED"));   // comparison is exact
    }

    [Fact]
    public void Every_status_is_deliberately_on_one_side_or_the_other()
    {
        // Forces a new status to be placed rather than defaulting to
        // not-serviceable, which is the direction that silently stops
        // collecting from a household.
        var unplaced = AllStatuses
            .Where(s => !BinStatuses.Serviceable.Contains(s))
            .Where(s => s is not (BinStatuses.Waitlisted or BinStatuses.Allocated))
            .ToList();

        Assert.True(unplaced.Count == 0,
            "These bin statuses are neither serviceable nor pre-delivery: " + string.Join(", ", unplaced));
    }

    [Fact]
    public void No_query_spells_the_rule_out_by_hand()
    {
        // The drift guard itself. An EF query cannot call IsServiceable, so the
        // temptation is to write "Delivered || Collecting" inline again — which
        // is exactly how the run-status sets fell out of step.
        var sourceRoot = FindApiSource();
        var offenders = Directory
            .EnumerateFiles(sourceRoot, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains(Path.Combine("Migrations", "")) && !f.EndsWith("Household.cs"))
            .Where(f => File.ReadAllText(f).Contains("BinStatuses.Delivered ||"))
            .Select(Path.GetFileName)
            .ToList();

        Assert.True(offenders.Count == 0,
            "These spell the serviceable rule out by hand instead of using " +
            "BinStatuses.Serviceable (for queries) or IsServiceable (in memory): " +
            string.Join(", ", offenders));
    }

    private static string FindApiSource()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "GoodSort.Api")))
            dir = dir.Parent;
        Assert.NotNull(dir);
        return Path.Combine(dir!.FullName, "GoodSort.Api");
    }
}
