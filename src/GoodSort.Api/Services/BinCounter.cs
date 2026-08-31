using GoodSort.Api.Data.Entities;

namespace GoodSort.Api.Services;

/// <summary>
/// Keeps a household's bin counter in step with the household's own.
///
/// The two are meant to mirror each other, and settle decrements both — the
/// route path decrements the household, the marketplace path decrements the
/// bin. But nothing ever incremented the bin. Every scan added to
/// Household.PendingContainers and left Bin.PendingContainers at zero, so it
/// was a counter that could only go down, and never had anywhere to go down
/// from.
///
/// It matters because the bin's counter is what dispatch reads.
/// RunGenerationService selects candidates on b.PendingContainers, orders them
/// by HouseholdCredit.EstimatedContainers(b.PendingContainers), and prices the
/// run from the total. With the bin permanently at zero that helper returns
/// DefaultUnscannedEstimate — a flat 20 — for every household bin.
///
/// So a member who scanned five hundred containers looked exactly like one who
/// scanned none: same priority in the queue, same estimated volume, same
/// payout quoted to the driver. In a product whose whole premise is that
/// scanning is what earns a collection, the number that decides collections
/// ignored the scanning.
///
/// One place to do it, so the increment cannot drift from the decrement the
/// way the two halves already had.
/// </summary>
public static class BinCounter
{
    /// <summary>
    /// Mirrors a scan onto the household's bin. Safe to call with a null bin —
    /// a member can scan before a bin exists, and the household counter is
    /// still the record of what they are owed.
    /// </summary>
    public static void AddScan(Bin? bin, int containers, int valueCents, string? material)
    {
        if (bin is null || containers <= 0) return;

        bin.PendingContainers += containers;
        bin.PendingValueCents += valueCents;

        bin.Materials ??= new MaterialBreakdown();
        AddMaterial(bin.Materials, material, containers);
    }

    /// <summary>Matches the household's own mapping, so the two stay comparable.</summary>
    private static void AddMaterial(MaterialBreakdown materials, string? material, int count)
    {
        switch (material)
        {
            case "aluminium": materials.Aluminium += count; break;
            case "pet": materials.Pet += count; break;
            case "glass": materials.Glass += count; break;
            default: materials.Other += count; break;
        }
    }
}
