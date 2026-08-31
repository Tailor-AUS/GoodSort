namespace GoodSort.Api.Services;

/// <summary>
/// How long a barcode lookup is worth remembering.
///
/// Every unknown container currently costs a round trip to Open Food Facts —
/// measured at roughly 0.8s against production, paid again on every repeat of
/// the same barcode. That repeat is not rare: a household bagging a 24-pack
/// scans one barcode twenty-four times, and before this each of those was a
/// separate outbound request for an answer that had not changed.
///
/// It also matters for the service on the other end. OFF is volunteer-run and
/// asks API consumers to cache; its search API was flapping between 200 and 503
/// within minutes while this was written. Caching is the difference between
/// being a good citizen of a free service and being the reason it rate-limits
/// us.
///
/// Misses are cached too, and deliberately. A miss is the common answer here —
/// OFF has no record for any of the 39 real Australian barcodes in the local
/// table — so caching only hits would leave the common path paying full price
/// every time. They get a shorter life than hits because a missing product is
/// something a contributor can add, while a product's packaging rarely changes.
/// </summary>
public static class BarcodeCache
{
    /// <summary>A product we found. Packaging data is stable; this can be held a while.</summary>
    public static readonly TimeSpan FoundFor = TimeSpan.FromHours(24);

    /// <summary>
    /// A product OFF does not know. Shorter, because "not in the database yet"
    /// is a state that changes when someone contributes the product.
    /// </summary>
    public static readonly TimeSpan NotFoundFor = TimeSpan.FromHours(6);

    /// <summary>
    /// Entries to hold before evicting. Bounded on purpose: this runs in every
    /// replica, and an unbounded cache keyed on caller-supplied input is a way
    /// to grow memory until the container is killed.
    ///
    /// Per replica also means partial: with ten instances, consecutive requests
    /// for the same barcode can land on a cold one and pay full price. Measured
    /// on production, most repeats returned at the network floor and an
    /// occasional one did not — that is this, not a broken cache. It still cuts
    /// outbound calls to OFF substantially, which is the point; making every
    /// repeat cheap would need shared state, and at current volume that is not
    /// worth an extra dependency.
    /// </summary>
    public const int MaxEntries = 5_000;

    public static string Key(string barcode) => $"barcode:{barcode}";

    public static TimeSpan LifetimeFor(bool found) => found ? FoundFor : NotFoundFor;
}
