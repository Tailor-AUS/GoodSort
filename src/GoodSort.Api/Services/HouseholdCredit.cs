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
}
