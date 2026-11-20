using GoodSort.Api.Data.Entities;

namespace GoodSort.Api.Services;

/// <summary>
/// Household sorting credit. Scan earns 10¢ pending. The runner count after a
/// depot drop is the settle authority — Vision outages must not zero a street.
/// </summary>
public static class HouseholdCredit
{
    public const int CentsPerContainer = 10;
    public const int ReferralCommissionCentsPerContainer = 1;
    public const int DefaultUnscannedEstimate = 20;

    public static int ClearedCentsForPickup(int containerCount, int centsPerContainer = CentsPerContainer) =>
        containerCount > 0 ? containerCount * Math.Max(0, centsPerContainer) : 0;

    public static int ReferralCommissionForPickup(int containerCount) =>
        containerCount > 0 ? containerCount * ReferralCommissionCentsPerContainer : 0;

    public static int EstimatedContainers(int pendingContainers) =>
        pendingContainers > 0 ? pendingContainers : DefaultUnscannedEstimate;

    public static bool HouseholdBinIsRunnable(string? binStatus, bool binIsOut, int pendingContainers)
    {
        if (!BinStatuses.IsServiceable(binStatus)) return false;
        return binIsOut || pendingContainers >= 1;
    }

    public static string PickupInstruction(string? binName, string? address = null)
    {
        var name = string.IsNullOrWhiteSpace(binName) ? "sorted bags" : binName.Trim();
        var addr = string.IsNullOrWhiteSpace(address) ? null : address.Trim();
        return addr is null
            ? $"Collect {name} on the kerb. Take eligible containers to a refund point."
            : $"Collect {name} at {addr} — sorted bags on the kerb.";
    }

    /// <summary>
    /// Drop pending scan estimates (the bin was emptied) and credit the
    /// household owner from the runner count. Do not also clear the standard
    /// scan cents into ClearedCents — that would double-pay scanned containers.
    /// The launch-bonus portion is the exception in 5¢ pre-CCA mode: it is a
    /// marketing grant, not an estimate the runner count supersedes, so it clears
    /// to the scanner. In 10¢ CRP mode, the full 10¢ is already paid by the
    /// pickup rate, so any overlapping launch-bonus bridge is absorbed rather
    /// than double-paying 15¢.
    /// </summary>
    public static int ApplyPickup(
        IReadOnlyList<Profile> members,
        IReadOnlyList<Scan> pendingScans,
        int pickupCount,
        int centsPerContainer = CentsPerContainer)
    {
        var rateUpgrade = Math.Max(0, centsPerContainer - CentsPerContainer);
        var memberScanCounts = new Dictionary<Guid, int>();
        foreach (var scan in pendingScans)
        {
            scan.Status = "settled";
            var user = members.FirstOrDefault(m => m.Id == scan.UserId);
            if (user is null) continue;
            user.PendingCents = Math.Max(0, user.PendingCents - scan.RefundCents);
            memberScanCounts[user.Id] = memberScanCounts.GetValueOrDefault(user.Id) + 1;

            var bonus = Math.Max(0, LaunchBonus.BonusPortionOf(scan.RefundCents) - rateUpgrade);
            if (bonus > 0)
            {
                user.ClearedCents += bonus;
            }
        }

        var credit = ClearedCentsForPickup(pickupCount, centsPerContainer);
        if (credit <= 0 || members.Count == 0) return credit;

        var orderedMembers = members.OrderBy(m => m.CreatedAt).ThenBy(m => m.Id).ToList();
        var totalMemberScans = memberScanCounts.Values.Sum();
        if (orderedMembers.Count == 1 || totalMemberScans <= 0)
        {
            orderedMembers[0].ClearedCents += credit;
            return credit;
        }

        // Multi-member household: split ClearedCents proportionally by each member's settled scans
        // via largest-remainder integer allocation so housemates keep their exact scanned share.
        var activeScanners = orderedMembers.Where(m => memberScanCounts.GetValueOrDefault(m.Id) > 0).ToList();
        var shares = activeScanners.Select(m =>
        {
            var scans = memberScanCounts[m.Id];
            var numer = (long)credit * scans;
            return new
            {
                Member = m,
                Floor = (int)(numer / totalMemberScans),
                Remainder = numer % totalMemberScans,
            };
        }).ToList();
        var remainderLeft = credit - shares.Sum(s => s.Floor);
        foreach (var sh in shares) sh.Member.ClearedCents += sh.Floor;
        foreach (var sh in shares.OrderByDescending(s => s.Remainder).ThenBy(s => s.Member.CreatedAt).ThenBy(s => s.Member.Id).Take(Math.Max(0, remainderLeft)))
            sh.Member.ClearedCents += 1;

        return credit;
    }
}
