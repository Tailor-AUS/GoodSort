using GoodSort.Api.Data.Entities;

namespace GoodSort.Api.Services;

/// <summary>
/// Household sorting credit. Scan is optional. The runner count after a
/// depot drop is the authority — Vision outages must not zero a street.
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
        var name = string.IsNullOrWhiteSpace(binName) ? "the purple The Good Sort bin" : binName.Trim();
        return $"Collect {name} — purple The Good Sort bin only. Do not open the council yellow bin.";
    }

    /// <summary>
    /// Drop pending scan estimates (the bin was emptied) and credit the
    /// household owner from the runner count. Do not also clear scan cents
    /// into ClearedCents — that would double-pay scanned containers.
    /// </summary>
    public static int ApplyPickup(IReadOnlyList<Profile> members, IReadOnlyList<Scan> pendingScans, int pickupCount)
    {
        foreach (var scan in pendingScans)
        {
            scan.Status = "settled";
            var user = members.FirstOrDefault(m => m.Id == scan.UserId);
            if (user is not null)
                user.PendingCents = Math.Max(0, user.PendingCents - scan.RefundCents);
        }

        var credit = ClearedCentsForPickup(pickupCount);
        var owner = members.FirstOrDefault();
        if (owner is not null && credit > 0)
            owner.ClearedCents += credit;
        return credit;
    }
}
