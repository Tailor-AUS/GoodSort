namespace GoodSort.Api.Services;

/// <summary>
/// Operator configuration for when a suburb's aluminium volume warrants a
/// driver trip to a recycler.
///
/// There is deliberately no default. The 1,000-container LiveThreshold is a
/// Path-A break-even estimate from an assumed ~$50 trip (see
/// docs/collection-economics.md), counted across every material — it is not an
/// operator-approved aluminium trigger. Until an operator sets
/// COLLECTION_ALUMINIUM_THRESHOLD_CONTAINERS, households see their suburb's
/// aluminium accumulating and a readiness status of
/// "pending_operator_configuration" — never an invented number, household
/// count, bin service or collection date.
///
/// COLLECTION_READINESS_FIXTURE_LABEL marks the value as a local test fixture
/// (shown to the member as such) so a local run cannot be mistaken for an
/// approved operator setting.
/// </summary>
public static class CollectionReadiness
{
    public const string ThresholdKey = "COLLECTION_ALUMINIUM_THRESHOLD_CONTAINERS";
    public const string FixtureLabelKey = "COLLECTION_READINESS_FIXTURE_LABEL";

    public const string PendingOperatorConfiguration = "pending_operator_configuration";
    public const string Accumulating = "accumulating";
    public const string VolumeReachedAwaitingOps = "aluminium_volume_reached_awaiting_ops";
    public const string OpsCommitted = "ops_committed";

    public static CollectionReadinessConfig ConfigFrom(IConfiguration? cfg)
    {
        if (cfg is null) return CollectionReadinessConfig.Pending;
        // Literal keys (not the constants) so ConfigRestoreCoverageTests sees them.
        var raw = cfg["COLLECTION_ALUMINIUM_THRESHOLD_CONTAINERS"];
        if (!int.TryParse(raw, out var threshold) || threshold <= 0)
            return CollectionReadinessConfig.Pending;
        var label = cfg["COLLECTION_READINESS_FIXTURE_LABEL"];
        var fixture = !string.IsNullOrWhiteSpace(label);
        return new CollectionReadinessConfig(
            Configured: true,
            AluminiumThreshold: threshold,
            Source: fixture ? "local_fixture" : "operator_config",
            FixtureLabel: fixture ? label!.Trim() : null);
    }

    /// <summary>
    /// Readiness for one suburb. Ops commitment (bins allocated / delivered /
    /// collecting) is the only state that implies a collection; reaching the
    /// configured aluminium volume only means ops may now consider a run.
    /// </summary>
    public static SuburbReadinessDto ForSuburb(CollectionReadinessConfig config, int aluminiumContainers, bool committed)
    {
        var aluminium = Math.Max(0, aluminiumContainers);
        if (committed)
            return new SuburbReadinessDto(OpsCommitted, aluminium, config.AluminiumThreshold, 0);
        if (!config.Configured || config.AluminiumThreshold is not int threshold)
            return new SuburbReadinessDto(PendingOperatorConfiguration, aluminium, null, null);
        return aluminium >= threshold
            ? new SuburbReadinessDto(VolumeReachedAwaitingOps, aluminium, threshold, 0)
            : new SuburbReadinessDto(Accumulating, aluminium, threshold, threshold - aluminium);
    }
}

public record CollectionReadinessConfig(bool Configured, int? AluminiumThreshold, string Source, string? FixtureLabel)
{
    public static readonly CollectionReadinessConfig Pending = new(false, null, "none", null);
}

public record SuburbReadinessDto(string Status, int AluminiumContainers, int? AluminiumThreshold, int? AluminiumNeeded);
