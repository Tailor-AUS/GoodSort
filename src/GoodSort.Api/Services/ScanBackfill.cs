using GoodSort.Api.Data.Entities;

namespace GoodSort.Api.Services;

/// <summary>
/// Scan-first members earn credit before they have an address. Those scans are
/// written with a null HouseholdId, and settle only ever sees scans filtered by
/// household — so without this they could never be settled and the credit would
/// be stranded forever.
///
/// When the member finally gives us an address, their earlier containers are
/// attached to that household: the credit becomes settleable, and the
/// containers they have been holding finally count toward their suburb's
/// volume, which is the whole point of collecting demand before logistics.
/// </summary>
public static class ScanBackfill
{
    /// <summary>
    /// Attach a member's address-less pending scans to the household they just
    /// joined, and fold their containers into that household's totals.
    /// Returns the number of containers moved.
    /// </summary>
    public static int AttachTo(Household household, IReadOnlyList<Scan> orphanScans)
    {
        if (orphanScans.Count == 0) return 0;

        var cents = 0;
        household.Materials ??= new MaterialBreakdown();

        foreach (var scan in orphanScans)
        {
            scan.HouseholdId = household.Id;
            cents += scan.RefundCents;
            _ = scan.Material switch
            {
                "aluminium" => household.Materials.Aluminium++,
                "pet" => household.Materials.Pet++,
                "glass" => household.Materials.Glass++,
                _ => household.Materials.Other++,
            };
        }

        household.PendingContainers += orphanScans.Count;
        household.PendingValueCents += cents;
        household.EstimatedWeightKg = household.PendingContainers * 0.020;
        household.EstimatedBags = (int)Math.Ceiling(household.PendingContainers / 150.0);
        household.LastScanAt = DateTime.UtcNow;

        return orphanScans.Count;
    }
}
