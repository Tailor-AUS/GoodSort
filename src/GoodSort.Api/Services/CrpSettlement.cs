using System.Security.Cryptography;
using GoodSort.Api.Data.Entities;
using Microsoft.Extensions.Configuration;

namespace GoodSort.Api.Services;

/// <summary>
/// Full-scale COEX Secondary-Sorted Container Refund Point (CRP) unit economics
/// and 4-stream QR bag tag helpers.
///
/// Under a COEX Container Collection Agreement (CCA) in SEQ:
///   - 10.00¢/container (1000 bp) scheme refund reimbursement
///   -  7.68¢/container ( 768 bp) secondary-sorted CRP handling fee
///   = 17.68¢/container (1768 bp) gross COEX revenue
///
/// Full-scale payout stack:
///   - 10.00¢/container Sorter household payout
///   -  1.00¢/container Container Mafia street referrer override (when referred)
///   -  3.00¢/container Suburb Runner collection payout
///   = +3.68¢ to +4.68¢/container (+368 to +468 bp) net GoodSort margin.
/// </summary>
public static class CrpSettlement
{
    public const long CoexRefundBpPerContainer = 1000;       // 10.00¢
    public const long CoexHandlingFeeBpPerContainer = 768;   //  7.68¢
    public const long CoexGrossBpPerContainer = 1768;        // 17.68¢

    public const int CrpHouseholdCentsPerContainer = 10;
    public const int PreCrpHouseholdCentsPerContainer = HouseholdCredit.CentsPerContainer; // 10¢
    public const int ContainerMafiaCentsPerContainer = HouseholdCredit.ReferralCommissionCentsPerContainer; // 1¢
    public const int CrpRunnerTargetCentsPerContainer = 3;

    private const string CrockfordAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

    public static readonly IReadOnlyList<string> ValidStreams =
    [
        "aluminium",
        "pet_clear",
        "pet_coloured",
        "glass",
    ];

    public static readonly IReadOnlySet<string> ValidDiscrepancyCodes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "none",
        "short_count",
        "extra_untagged",
        "mixed_streams",
        "crushed_or_ineligible",
        "bag_missing",
    };

    /// <summary>
    /// Fail-closed by default: stays false until COEX executes the Container
    /// Collection Agreement and COEX_CRP_ACTIVE=true is set.
    /// </summary>
    public static bool IsCrpActive(IConfiguration cfg) =>
        string.Equals(cfg["COEX_CRP_ACTIVE"], "true", StringComparison.OrdinalIgnoreCase);

    public static int ActiveHouseholdRateCents(IConfiguration cfg) =>
        IsCrpActive(cfg) ? CrpHouseholdCentsPerContainer : PreCrpHouseholdCentsPerContainer;

    public static string? NormalizeStream(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        return raw.Trim().ToLowerInvariant() switch
        {
            "aluminium" or "aluminum" or "alu" or "cans" => "aluminium",
            "pet_clear" or "pet" or "clear_pet" => "pet_clear",
            "pet_coloured" or "pet_colored" or "coloured_pet" or "other" or "hdpe" or "hdpe_lpb" or "steel" => "pet_coloured",
            "glass" or "glass_clear" or "glass_brown" or "glass_green" => "glass",
            _ => null,
        };
    }

    public static string StreamPrefix(string normalizedStream) => normalizedStream switch
    {
        "aluminium" => "ALU",
        "pet_clear" => "CLR",
        "pet_coloured" => "COL",
        "glass" => "GLS",
        _ => "BAG",
    };

    public static bool ScanMatchesBagStream(string? scanMaterial, string bagStream)
    {
        var m = (scanMaterial ?? "").Trim().ToLowerInvariant();
        return bagStream switch
        {
            "aluminium" => m is "aluminium" or "aluminum",
            "pet_clear" => m is "pet" or "pet_clear",
            "pet_coloured" => m is "pet_coloured" or "other" or "hdpe" or "hdpe_lpb" or "liquid_paperboard" or "steel",
            "glass" => m.StartsWith("glass", StringComparison.Ordinal),
            _ => false,
        };
    }

    public static string GenerateBagCode(string normalizedStream)
    {
        var prefix = StreamPrefix(normalizedStream);
        Span<char> token = stackalloc char[8];
        for (var i = 0; i < token.Length; i++)
            token[i] = CrockfordAlphabet[RandomNumberGenerator.GetInt32(CrockfordAlphabet.Length)];
        return $"GSB-{prefix}-{new string(token)}";
    }

    public static RunSettlementLedger BuildLedger(
        Guid runId,
        string areaName,
        bool crpActive,
        int verifiedContainers,
        int bagsVerified,
        int discrepancyStops,
        int householdPayoutCents,
        int containerMafiaCents,
        int runnerPayoutCents,
        string? coexDocketRef = null)
    {
        var safeContainers = Math.Max(0, verifiedContainers);
        var refundBp = safeContainers * CoexRefundBpPerContainer;
        var handlingBp = safeContainers * CoexHandlingFeeBpPerContainer;
        var proFormaGrossBp = refundBp + handlingBp; // 17.68¢ / can
        var grossBp = crpActive ? proFormaGrossBp : refundBp;

        var totalPayoutCents = householdPayoutCents + containerMafiaCents + runnerPayoutCents;
        var netMarginBp = grossBp - (totalPayoutCents * 100L);

        // Full-scale CRP pro-forma at 10¢ household + actual Mafia (0 or 1¢) + 3¢ runner:
        var proFormaPayoutCents = (safeContainers * CrpHouseholdCentsPerContainer)
                                + containerMafiaCents
                                + (safeContainers * CrpRunnerTargetCentsPerContainer);
        var proFormaNetMarginBp = proFormaGrossBp - (proFormaPayoutCents * 100L);

        var safeArea = string.IsNullOrWhiteSpace(areaName) ? "Brisbane" : areaName.Trim();
        if (safeArea.Length > 128) safeArea = safeArea[..128];

        var safeDocket = string.IsNullOrWhiteSpace(coexDocketRef) ? null : coexDocketRef.Trim();
        if (safeDocket is { Length: > 64 }) safeDocket = safeDocket[..64];

        return new RunSettlementLedger
        {
            RunId = runId,
            AreaName = safeArea,
            SettlementMode = crpActive ? "coex_crp" : "open_depot",
            CoexDocketRef = safeDocket,
            VerifiedContainers = safeContainers,
            BagsVerified = Math.Max(0, bagsVerified),
            DiscrepancyStops = Math.Max(0, discrepancyStops),
            CoexRefundBasisPoints = refundBp,
            CoexHandlingFeeBasisPoints = handlingBp,
            GrossRevenueBasisPoints = grossBp,
            ProFormaCoexGrossBasisPoints = proFormaGrossBp,
            HouseholdPayoutCents = householdPayoutCents,
            ContainerMafiaCents = containerMafiaCents,
            RunnerPayoutCents = runnerPayoutCents,
            TotalPayoutCents = totalPayoutCents,
            NetMarginBasisPoints = netMarginBp,
            ProFormaCrpNetMarginBasisPoints = proFormaNetMarginBp,
        };
    }

    public static decimal BasisPointsToDollars(long basisPoints) =>
        Math.Round(basisPoints / 10000m, 2, MidpointRounding.AwayFromZero);

    public static decimal BasisPointsToCentsPerCan(long basisPoints, int containers) =>
        containers > 0 ? Math.Round((decimal)basisPoints / containers / 100m, 2, MidpointRounding.AwayFromZero) : 0m;
}
