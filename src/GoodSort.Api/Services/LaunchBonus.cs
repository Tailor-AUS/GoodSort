namespace GoodSort.Api.Services;

/// <summary>
/// Launch bonus: a member's first N eligible containers credit double the
/// standard sorting credit. This is marketing spend with a hard per-member
/// ceiling, NOT a change to the sorting-credit rate — the trip economics still
/// rest on the standard rate that The Good Sort retains, so the per-suburb run
/// threshold is unaffected.
///
/// It is deliberately NOT the 10c scheme refund. The bonus happens to be twice
/// 5c; it must never be described to a member as the Containers for Change
/// refund, and The Good Sort must not imply it passes that refund through.
///
/// Set LAUNCH_BONUS_CONTAINERS=0 to switch the promotion off without a deploy.
/// </summary>
public static class LaunchBonus
{
    /// <summary>Containers per member that earn the bonus. 0 disables.</summary>
    public const int DefaultCapContainers = 20;

    /// <summary>Credit per bonus container — double the standard rate.</summary>
    public const int CentsPerContainer = HouseholdCredit.CentsPerContainer * 2;

    /// <summary>Extra cents a bonus container earns over the standard rate.</summary>
    public const int ExtraCentsPerContainer = CentsPerContainer - HouseholdCredit.CentsPerContainer;

    public static int CapFrom(IConfiguration cfg) =>
        int.TryParse(cfg["LAUNCH_BONUS_CONTAINERS"], out var n) && n >= 0 ? n : DefaultCapContainers;

    /// <summary>
    /// How many of <paramref name="newContainers"/> still fall inside the cap,
    /// given how many this member has already scanned in their lifetime.
    /// </summary>
    public static int QualifyingContainers(int alreadyScanned, int newContainers, int cap)
    {
        if (cap <= 0 || newContainers <= 0) return 0;
        var remaining = cap - Math.Max(0, alreadyScanned);
        return Math.Clamp(remaining, 0, newContainers);
    }

    /// <summary>Total credit for a batch, mixing bonus and standard containers.</summary>
    public static int TotalCents(int alreadyScanned, int newContainers, int cap)
    {
        if (newContainers <= 0) return 0;
        var bonus = QualifyingContainers(alreadyScanned, newContainers, cap);
        var standard = newContainers - bonus;
        return bonus * CentsPerContainer + standard * HouseholdCredit.CentsPerContainer;
    }

    /// <summary>Per-container credit for the container at a given lifetime index.</summary>
    public static int CentsForContainerAt(int lifetimeIndex, int cap) =>
        cap > 0 && lifetimeIndex < cap ? CentsPerContainer : HouseholdCredit.CentsPerContainer;

    /// <summary>
    /// Bonus portion of an already-written scan, derived from the row itself so
    /// no extra column is needed. Lets settle clear the grant while still
    /// dropping the scan estimate in favour of the runner's physical count.
    /// </summary>
    public static int BonusPortionOf(int refundCents) =>
        Math.Max(0, refundCents - HouseholdCredit.CentsPerContainer);
}
