namespace GoodSort.Api.Data.Entities;

/// <summary>
/// Immutable per-run settlement audit row capturing exact COEX Secondary-Sorted CRP
/// revenue (17.68¢/container = 10.00¢ scheme refund + 7.68¢ handling fee in basis
/// points, where 100 bp = 1¢) alongside Sorter, Container Mafia, and Runner payouts.
/// </summary>
public class RunSettlementLedger
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid RunId { get; set; }
    public Run Run { get; set; } = null!;

    public string AreaName { get; set; } = "";

    /// <summary>
    /// "coex_crp" when COEX_CRP_ACTIVE=true (17.68¢/container live CCA);
    /// "open_depot" pre-CCA while COEX CRP approval is pending.
    /// </summary>
    public string SettlementMode { get; set; } = "open_depot";

    public string? CoexDocketRef { get; set; }

    public int VerifiedContainers { get; set; }
    public int BagsVerified { get; set; }
    public int DiscrepancyStops { get; set; }

    // Basis points: 100 bp = 1.00¢, 1768 bp = 17.68¢, 10000 bp = $1.00
    public long CoexRefundBasisPoints { get; set; }
    public long CoexHandlingFeeBasisPoints { get; set; }
    public long GrossRevenueBasisPoints { get; set; }
    public long ProFormaCoexGrossBasisPoints { get; set; }

    // Actual payouts credited to Profile.ClearedCents (in integer cents)
    public int HouseholdPayoutCents { get; set; }
    public int ContainerMafiaCents { get; set; }
    public int RunnerPayoutCents { get; set; }
    public int TotalPayoutCents { get; set; }

    // Net retained margin in basis points (100 bp = 1¢)
    public long NetMarginBasisPoints { get; set; }
    public long ProFormaCrpNetMarginBasisPoints { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
