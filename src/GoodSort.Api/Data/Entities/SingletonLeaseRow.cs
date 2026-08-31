namespace GoodSort.Api.Data.Entities;

/// <summary>
/// One background pass, and which replica currently owns it.
///
/// The name is the primary key on purpose: several replicas starting at the
/// same moment all try to insert the same name, and only one can win a key.
/// See SingletonLease for why any of this is necessary.
/// </summary>
public class SingletonLeaseRow
{
    /// <summary>Pass name, e.g. "run-generation". Primary key.</summary>
    public string Name { get; set; } = "";

    /// <summary>SingletonLease.InstanceId of the replica holding it.</summary>
    public Guid Holder { get; set; }

    /// <summary>When the hold lapses, so a crashed replica cannot block a pass forever.</summary>
    public DateTime ExpiresAt { get; set; }
}
