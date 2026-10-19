using GoodSort.Api.Data.Entities;

namespace GoodSort.Api.Services;

/// <summary>
/// Household sorting credit. Scan earns 5¢ pending. The runner count after a
/// depot drop is the settle authority — Vision outages must not zero a street.
/// </summary>
public static class HouseholdCredit
{
    public const int CentsPerContainer = 5;
    public const int DefaultUnscannedEstimate = 20;

    public static int ClearedCentsForPickup(int containerCount) =>
        containerCount > 0 ? containerCount * CentsPerContainer : 0;

    public static int EstimatedContainers(int pendingContainers) =>
        pendingContainers > 0 ? pendingContainers : DefaultUnscannedEstimate;

    public static bool HouseholdBinIsRunnable(string? binStatus, bool binIsOut, int pendingContainers)
    {
        if (!BinStatuses.IsServiceable(binStatus)) return false;
        return binIsOut || pendingContainers >= 1;
    }

    public static string PickupInstruction(string? binName)
    {
        var name = string.IsNullOrWhiteSpace(binName) ? "sorted bags" : binName.Trim();
        return $"Collect {name} on the kerb. Take eligible containers to a refund point.";
    }

    /// <summary>
    /// Drop pending scan estimates (the bin was emptied) and credit the
    /// household owner from the runner count. Do not also clear the standard
    /// scan cents into ClearedCents — that would double-pay scanned containers.
    /// The launch-bonus portion is the exception: it is a marketing grant, not
    /// an estimate the runner count supersedes, so it clears to the scanner.
    /// </summary>
    public static int ApplyPickup(IReadOnlyList<Profile> members, IReadOnlyList<Scan> pendingScans, int pickupCount)
    {
        foreach (var scan in pendingScans)
        {
            scan.Status = "settled";
            var user = members.FirstOrDefault(m => m.Id == scan.UserId);
            if (user is null) continue;
            user.PendingCents = Math.Max(0, user.PendingCents - scan.RefundCents);

            // The launch bonus is a grant, not an estimate of what the runner
            // will find, so it clears to the member who scanned instead of
            // being dropped with the rest of the estimate. Without this the
            // bonus would sit in PendingCents forever and never be payable.
            var bonus = LaunchBonus.BonusPortionOf(scan.RefundCents);
            if (bonus > 0) user.ClearedCents += bonus;
        }

        var credit = ClearedCentsForPickup(pickupCount);
        var owner = members.FirstOrDefault();
        if (owner is not null && credit > 0)
            owner.ClearedCents += credit;
        return credit;
    }

    /// <summary>
    /// Reconciles household and bin pending container tallies and material breakdowns
    /// when a pickup settles.
    ///
    /// - Full pickup (newPending == 0): zeroes Materials on both household and bin
    ///   and marks all pendingScans as "settled".
    /// - Partial pickup with explicit collectedMaterials whose sum matches pickupCount:
    ///   decrements each material on household and bin, and settles only the collected
    ///   scans per material (leaving remaining scans "pending").
    /// - Partial pickup of a pure-aluminium household (all prior pending containers were
    ///   aluminium): remaining containers are known to be aluminium.
    /// - Partial pickup of a household with zero prior aluminium: remaining containers
    ///   have 0 aluminium.
    /// - Partial pickup of a mixed-material household that had aluminium where no
    ///   material breakdown was supplied: material composition of the remainder is
    ///   unknown. Never infer or clamp aluminium from total remaining containers; set
    ///   Materials.Aluminium = 0, Materials.Other = newPending, and mark remaining
    ///   scans as "pending_unreconciled" so WaitlistDensity surfaces
    ///   PendingMaterialReconciliation.
    /// </summary>
    public static void ReconcileHouseholdPickup(
        Household hh,
        Bin? bin,
        IReadOnlyList<Scan> pendingScans,
        int pickupCount,
        MaterialBreakdown? collectedMaterials = null)
    {
        var taken = Math.Max(0, pickupCount);
        var beforePending = Math.Max(0, hh.PendingContainers);
        var newPending = Math.Max(0, beforePending - taken);

        hh.PendingContainers = newPending;
        hh.PendingValueCents = newPending * CentsPerContainer;
        hh.EstimatedBags = (int)Math.Ceiling(newPending / 150.0);
        hh.Materials ??= new MaterialBreakdown();

        if (bin is not null)
        {
            bin.PendingContainers = Math.Max(0, bin.PendingContainers - taken);
            bin.PendingValueCents = bin.PendingContainers * CentsPerContainer;
            bin.Materials ??= new MaterialBreakdown();
        }

        if (newPending == 0)
        {
            hh.Materials = new MaterialBreakdown();
            if (bin is not null) bin.Materials = new MaterialBreakdown();
            foreach (var s in pendingScans) s.Status = "settled";
            return;
        }

        var priorAlu = Math.Max(0, hh.Materials.Aluminium);
        var priorPet = Math.Max(0, hh.Materials.Pet);
        var priorGlass = Math.Max(0, hh.Materials.Glass);
        var priorOther = Math.Max(0, hh.Materials.Other);
        var hasAluScan = pendingScans.Any(s => string.Equals(s.Material, "aluminium", StringComparison.OrdinalIgnoreCase));

        if (collectedMaterials is not null)
        {
            var cAlu = Math.Max(0, collectedMaterials.Aluminium);
            var cPet = Math.Max(0, collectedMaterials.Pet);
            var cGlass = Math.Max(0, collectedMaterials.Glass);
            var cOther = Math.Max(0, collectedMaterials.Other);
            if (cAlu + cPet + cGlass + cOther == taken
                && cAlu <= priorAlu && cPet <= priorPet && cGlass <= priorGlass && cOther <= priorOther)
            {
                hh.Materials = new MaterialBreakdown
                {
                    Aluminium = priorAlu - cAlu,
                    Pet = priorPet - cPet,
                    Glass = priorGlass - cGlass,
                    Other = priorOther - cOther,
                };
                if (bin is not null)
                {
                    bin.Materials = new MaterialBreakdown
                    {
                        Aluminium = hh.Materials.Aluminium,
                        Pet = hh.Materials.Pet,
                        Glass = hh.Materials.Glass,
                        Other = hh.Materials.Other,
                    };
                }
                SettleByMaterial(pendingScans, cAlu, cPet, cGlass, cOther);
                return;
            }
        }

        // Pure non-aluminium household: remainder has 0 aluminium.
        if (priorAlu == 0 && !hasAluScan)
        {
            hh.Materials = new MaterialBreakdown { Aluminium = 0, Pet = 0, Glass = 0, Other = newPending };
            if (bin is not null)
                bin.Materials = new MaterialBreakdown { Aluminium = 0, Pet = 0, Glass = 0, Other = newPending };
            SettleOldestCount(pendingScans, taken, remainingStatus: "pending");
            return;
        }

        // Pure aluminium household: every prior pending container was aluminium.
        if (priorAlu == beforePending && priorPet == 0 && priorGlass == 0 && priorOther == 0
            && pendingScans.All(s => string.Equals(s.Material, "aluminium", StringComparison.OrdinalIgnoreCase)))
        {
            hh.Materials = new MaterialBreakdown { Aluminium = newPending, Pet = 0, Glass = 0, Other = 0 };
            if (bin is not null)
                bin.Materials = new MaterialBreakdown { Aluminium = newPending, Pet = 0, Glass = 0, Other = 0 };
            SettleOldestCount(pendingScans, taken, remainingStatus: "pending");
            return;
        }

        // Mixed-material partial pickup without a verified material breakdown:
        // do NOT guess or clamp remaining containers as aluminium.
        hh.Materials = new MaterialBreakdown { Aluminium = 0, Pet = 0, Glass = 0, Other = newPending };
        if (bin is not null)
            bin.Materials = new MaterialBreakdown { Aluminium = 0, Pet = 0, Glass = 0, Other = newPending };
        SettleOldestCount(pendingScans, taken, remainingStatus: "pending_unreconciled");
    }

    private static void SettleByMaterial(IReadOnlyList<Scan> scans, int alu, int pet, int glass, int other)
    {
        foreach (var s in scans)
        {
            var mat = (s.Material ?? "").ToLowerInvariant();
            if (mat == "aluminium" && alu > 0) { s.Status = "settled"; alu--; }
            else if (mat == "pet" && pet > 0) { s.Status = "settled"; pet--; }
            else if (mat == "glass" && glass > 0) { s.Status = "settled"; glass--; }
            else if (mat != "aluminium" && mat != "pet" && mat != "glass" && other > 0) { s.Status = "settled"; other--; }
            else { s.Status = "pending"; }
        }
    }

    private static void SettleOldestCount(IReadOnlyList<Scan> scans, int settleCount, string remainingStatus)
    {
        var remainingToSettle = Math.Max(0, settleCount);
        foreach (var s in scans)
        {
            if (remainingToSettle > 0)
            {
                s.Status = "settled";
                remainingToSettle--;
            }
            else
            {
                s.Status = remainingStatus;
            }
        }
    }
}
