namespace GoodSort.Api.Services;

/// <summary>
/// One definition of which run statuses still hold a bin.
///
/// This existed twice, spelled out inline, and the two copies had drifted.
/// GenerateRuns listed available, below_threshold, claimed, in_progress and
/// delivering; AbsorbFullBinHouseholds listed the same set minus delivering,
/// under a comment saying "whose bin is NOT already in an active run".
///
/// A run goes to "delivering" when the driver has the containers in the
/// vehicle and is on the way to the depot. Treating that bin as free meant a
/// household could be absorbed into a second run while its containers were
/// already collected — a driver sent to a kerb the first driver had emptied.
/// The bin is at its emptiest precisely when the second run is created.
///
/// Adding a status and forgetting one of these lists is a silent bug in one
/// direction or the other: leave it out and bins get claimed twice, put a
/// terminal status in and bins are stranded, so a household's containers are
/// never collected and their credit never clears. Hence one array, used by
/// both.
/// </summary>
public static class RunLifecycle
{
    /// <summary>
    /// A run in any of these still owns its bins. Everything else — completed,
    /// settled, expired, cancelled — is terminal and releases them.
    ///
    /// An array rather than a method so EF can translate it to SQL IN.
    /// </summary>
    public static readonly string[] HoldsBin =
    [
        "available",
        "below_threshold",
        "claimed",
        "in_progress",
        "delivering",
    ];

    /// <summary>
    /// Runs no driver has committed to yet.
    ///
    /// Both things done to an uncommitted run need this set, and they are the
    /// same idea: a full-bin household may be absorbed into one (adding a stop
    /// to a claimed run would change the job the driver accepted), and one may
    /// be expired out from under nobody (expiring a claimed run would cancel
    /// work already underway).
    /// </summary>
    public static readonly string[] Unclaimed =
    [
        "available",
        "below_threshold",
    ];
}
