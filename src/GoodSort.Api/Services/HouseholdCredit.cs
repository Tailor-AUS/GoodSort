using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

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
    /// Settle up to <paramref name="pickupCount"/> pending scan estimates and credit
    /// the household owner from the runner count. Uncollected scans on a partial pickup
    /// remain pending (never settled and reopened) so their pending estimate and any
    /// launch-bonus grant are conserved for a future pickup.
    /// </summary>
    public static int ApplyPickup(IReadOnlyList<Profile> members, IReadOnlyList<Scan> pendingScans, int pickupCount)
    {
        var taken = Math.Max(0, pickupCount);
        var scansToSettle = pendingScans
            .Where(s => s.Status != "settled")
            .Take(taken)
            .ToList();

        SettleSelectedScans(members, scansToSettle);

        var credit = ClearedCentsForPickup(taken);
        var owner = members.FirstOrDefault();
        if (owner is not null && credit > 0)
            owner.ClearedCents += credit;
        return credit;
    }

    /// <summary>
    /// Single atomic pickup settlement transition shared by both marketplace run
    /// completion (<c>/api/runs/{id}/complete</c>) and legacy route settlement
    /// (<c>/api/routes/{id}/settle</c>).
    ///
    /// Identifies the settled scan subset first (or explicit uncertainty state for
    /// remaining scans), clears member pending/bonus amounts for the settled subset
    /// exactly once, retains uncollected pending credit on members, credits the
    /// household owner for <paramref name="pickupCount"/>, and updates household,
    /// bin, and scan statuses consistently without ever marking and reopening
    /// financially settled scans.
    /// </summary>
    public static int SettleHouseholdPickup(
        Household hh,
        Bin? bin,
        IReadOnlyList<Profile> payees,
        IReadOnlyList<Scan> pendingScans,
        int pickupCount,
        MaterialBreakdown? collectedMaterials = null)
    {
        var taken = Math.Max(0, pickupCount);
        var beforePending = Math.Max(0, hh.PendingContainers);
        var newPending = Math.Max(0, beforePending - taken);

        hh.Materials ??= new MaterialBreakdown();
        var priorAlu = Math.Max(0, hh.Materials.Aluminium);
        var priorPet = Math.Max(0, hh.Materials.Pet);
        var priorGlass = Math.Max(0, hh.Materials.Glass);
        var priorOther = Math.Max(0, hh.Materials.Other);

        hh.PendingContainers = newPending;
        hh.PendingValueCents = newPending * CentsPerContainer;
        hh.EstimatedBags = (int)Math.Ceiling(newPending / 150.0);

        var activeScans = pendingScans.ToList();
        var hasAluScan = activeScans.Any(s => string.Equals(s.Material, "aluminium", StringComparison.OrdinalIgnoreCase));

        List<Scan> settledScans;
        List<Scan> remainingScans;
        string remainingStatus;

        if (newPending == 0)
        {
            hh.Materials = new MaterialBreakdown();
            settledScans = activeScans;
            remainingScans = [];
            remainingStatus = "pending";
        }
        else if (collectedMaterials is not null
            && TryApplyExplicitMaterialBreakdown(
                collectedMaterials, taken, priorAlu, priorPet, priorGlass, priorOther,
                activeScans, out var updatedMaterials, out var byMatSettled, out var byMatRemaining))
        {
            hh.Materials = updatedMaterials;
            settledScans = byMatSettled;
            remainingScans = byMatRemaining;
            remainingStatus = "pending";
        }
        else if (priorAlu == 0 && !hasAluScan)
        {
            // Pure non-aluminium household: remainder has 0 aluminium.
            hh.Materials = new MaterialBreakdown { Aluminium = 0, Pet = 0, Glass = 0, Other = newPending };
            (settledScans, remainingScans) = PartitionOldestScans(activeScans, taken);
            remainingStatus = "pending";
        }
        else if (priorAlu == beforePending && priorPet == 0 && priorGlass == 0 && priorOther == 0
            && activeScans.All(s => string.Equals(s.Material, "aluminium", StringComparison.OrdinalIgnoreCase)))
        {
            // Pure aluminium household: every prior pending container was aluminium.
            hh.Materials = new MaterialBreakdown { Aluminium = newPending, Pet = 0, Glass = 0, Other = 0 };
            (settledScans, remainingScans) = PartitionOldestScans(activeScans, taken);
            remainingStatus = "pending";
        }
        else
        {
            // Mixed-material partial pickup without a verified material breakdown:
            // do NOT guess or clamp remaining containers as aluminium.
            hh.Materials = new MaterialBreakdown { Aluminium = 0, Pet = 0, Glass = 0, Other = newPending };
            (settledScans, remainingScans) = PartitionOldestScans(activeScans, taken);
            remainingStatus = "pending_unreconciled";
        }

        if (bin is not null)
        {
            bin.PendingContainers = Math.Max(0, bin.PendingContainers - taken);
            bin.PendingValueCents = bin.PendingContainers * CentsPerContainer;
            bin.LastCollectedAt = DateTime.UtcNow;
            bin.Materials = new MaterialBreakdown
            {
                Aluminium = hh.Materials.Aluminium,
                Pet = hh.Materials.Pet,
                Glass = hh.Materials.Glass,
                Other = hh.Materials.Other,
            };
        }

        SettleSelectedScans(payees, settledScans);
        foreach (var rem in remainingScans)
        {
            rem.Status = remainingStatus;
        }

        // Recalculate household PendingValueCents from remaining unsettled scans + any unscanned remainder
        if (newPending > 0 && remainingScans.Count > 0)
        {
            var remainingScanValue = remainingScans.Sum(s => Math.Max(0, s.RefundCents));
            var unscannedRemainder = Math.Max(0, newPending - remainingScans.Count) * CentsPerContainer;
            hh.PendingValueCents = remainingScanValue + unscannedRemainder;
            if (bin is not null)
                bin.PendingValueCents = hh.PendingValueCents;
        }

        var credit = ClearedCentsForPickup(taken);
        var owner = payees.FirstOrDefault();
        if (owner is not null && credit > 0)
            owner.ClearedCents += credit;

        return credit;
    }

    /// <summary>
    /// Database-backed atomic stop settlement shared by both <c>/api/runs/{id}/complete</c>
    /// and <c>/api/routes/{id}/settle</c>. Loads the household, members, scan payees,
    /// household bin (if not already provided), and unsettled scans in chronological
    /// order, then applies <see cref="SettleHouseholdPickup"/>.
    /// </summary>
    public static async Task<Household?> SettleHouseholdStopAsync(
        GoodSortDbContext db,
        Guid householdId,
        Bin? stopBin,
        int pickupCount,
        MaterialBreakdown? collectedMaterials = null)
    {
        var hh = await db.Households
            .Include(h => h.Members)
            .FirstOrDefaultAsync(h => h.Id == householdId);
        if (hh is null) return null;

        var bin = stopBin ?? await db.Bins
            .Where(b => b.HouseholdId == hh.Id)
            .OrderBy(b => b.CreatedAt)
            .FirstOrDefaultAsync();

        var pendingScans = await db.Scans
            .Where(s => s.HouseholdId == hh.Id && (s.Status == "pending" || s.Status == "pending_unreconciled"))
            .OrderBy(s => s.CreatedAt)
            .ThenBy(s => s.Id)
            .ToListAsync();

        var payees = hh.Members.ToList();
        foreach (var scan in pendingScans)
        {
            if (payees.Any(m => m.Id == scan.UserId)) continue;
            var extra = await db.Profiles.FindAsync(scan.UserId);
            if (extra is not null) payees.Add(extra);
        }

        SettleHouseholdPickup(hh, bin, payees, pendingScans, pickupCount, collectedMaterials);
        return hh;
    }

    /// <summary>
    /// Reconciles household/bin/scan state when called without a payee list (or after
    /// <see cref="ApplyPickup"/>). Delegates to <see cref="SettleHouseholdPickup"/>
    /// with an empty payee list so already-settled scans are never reopened.
    /// </summary>
    public static void ReconcileHouseholdPickup(
        Household hh,
        Bin? bin,
        IReadOnlyList<Scan> pendingScans,
        int pickupCount,
        MaterialBreakdown? collectedMaterials = null)
    {
        SettleHouseholdPickup(hh, bin, [], pendingScans, pickupCount, collectedMaterials);
    }

    private static void SettleSelectedScans(IReadOnlyList<Profile> members, IReadOnlyList<Scan> scansToSettle)
    {
        foreach (var scan in scansToSettle)
        {
            var alreadySettled = string.Equals(scan.Status, "settled", StringComparison.OrdinalIgnoreCase);
            scan.Status = "settled";
            if (alreadySettled) continue;

            var user = members.FirstOrDefault(m => m.Id == scan.UserId);
            if (user is null) continue;
            user.PendingCents = Math.Max(0, user.PendingCents - scan.RefundCents);

            // The launch bonus is a grant, not an estimate of what the runner
            // will find, so it clears to the member who scanned instead of
            // being dropped with the rest of the estimate.
            var bonus = LaunchBonus.BonusPortionOf(scan.RefundCents);
            if (bonus > 0) user.ClearedCents += bonus;
        }
    }

    private static (List<Scan> Settled, List<Scan> Remaining) PartitionOldestScans(
        IReadOnlyList<Scan> scans,
        int settleCount)
    {
        var remainingToSettle = Math.Max(0, settleCount);
        var settled = new List<Scan>(Math.Min(remainingToSettle, scans.Count));
        var remaining = new List<Scan>();
        foreach (var s in scans)
        {
            if (remainingToSettle > 0)
            {
                settled.Add(s);
                remainingToSettle--;
            }
            else
            {
                remaining.Add(s);
            }
        }
        return (settled, remaining);
    }

    private static bool TryApplyExplicitMaterialBreakdown(
        MaterialBreakdown collectedMaterials,
        int taken,
        int priorAlu,
        int priorPet,
        int priorGlass,
        int priorOther,
        IReadOnlyList<Scan> scans,
        out MaterialBreakdown updatedMaterials,
        out List<Scan> settledScans,
        out List<Scan> remainingScans)
    {
        updatedMaterials = new MaterialBreakdown();
        settledScans = [];
        remainingScans = [];

        var cAlu = Math.Max(0, collectedMaterials.Aluminium);
        var cPet = Math.Max(0, collectedMaterials.Pet);
        var cGlass = Math.Max(0, collectedMaterials.Glass);
        var cOther = Math.Max(0, collectedMaterials.Other);

        if (cAlu + cPet + cGlass + cOther != taken
            || cAlu > priorAlu || cPet > priorPet || cGlass > priorGlass || cOther > priorOther)
        {
            return false;
        }

        updatedMaterials = new MaterialBreakdown
        {
            Aluminium = priorAlu - cAlu,
            Pet = priorPet - cPet,
            Glass = priorGlass - cGlass,
            Other = priorOther - cOther,
        };

        int alu = cAlu, pet = cPet, glass = cGlass, other = cOther;
        foreach (var s in scans)
        {
            var mat = (s.Material ?? "").ToLowerInvariant();
            if (mat == "aluminium" && alu > 0) { settledScans.Add(s); alu--; }
            else if (mat == "pet" && pet > 0) { settledScans.Add(s); pet--; }
            else if (mat == "glass" && glass > 0) { settledScans.Add(s); glass--; }
            else if (mat != "aluminium" && mat != "pet" && mat != "glass" && other > 0) { settledScans.Add(s); other--; }
            else { remainingScans.Add(s); }
        }
        return true;
    }
}
