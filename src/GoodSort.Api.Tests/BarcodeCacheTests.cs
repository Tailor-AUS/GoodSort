using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

/// <summary>
/// The cache policy for barcode lookups.
///
/// Measured against production before adding this: an unknown container cost
/// ~0.8s on every lookup, and a repeat of the same barcode cost the same again
/// because nothing was cached. That repeat is the normal case — a household
/// bagging a 24-pack scans one barcode twenty-four times.
/// </summary>
public class BarcodeCacheTests
{
    [Fact]
    public void A_miss_is_cached_too_but_not_for_as_long_as_a_hit()
    {
        // Caching only hits would leave the common path paying full price every
        // time: OFF has no record for any of the 39 real Australian barcodes in
        // the local table, so "not found" is the usual answer.
        Assert.True(BarcodeCache.LifetimeFor(found: false) > TimeSpan.Zero,
            "A miss must be cached — it is the common answer, not the rare one.");

        // But a missing product is a state a contributor can change, while a
        // product's packaging rarely does.
        Assert.True(BarcodeCache.LifetimeFor(found: true) > BarcodeCache.LifetimeFor(found: false),
            "A hit should outlive a miss.");
    }

    [Fact]
    public void Nothing_is_cached_indefinitely()
    {
        // An entry that never expires is a wrong answer with no way out.
        Assert.True(BarcodeCache.FoundFor <= TimeSpan.FromDays(7));
        Assert.True(BarcodeCache.NotFoundFor <= TimeSpan.FromDays(1));
    }

    [Fact]
    public void The_cache_is_bounded()
    {
        // Keyed on caller-supplied input and running in every replica, so an
        // unbounded cache is a way to grow memory until the container is killed.
        Assert.True(BarcodeCache.MaxEntries > 0);
        Assert.True(BarcodeCache.MaxEntries <= 50_000, "Bounded, but this is not a bound.");
    }

    [Fact]
    public void Keys_are_namespaced_and_distinct_per_barcode()
    {
        // Shares an IMemoryCache with anything else that wants one.
        Assert.StartsWith("barcode:", BarcodeCache.Key("9300675024457"));
        Assert.NotEqual(BarcodeCache.Key("9300675024457"), BarcodeCache.Key("9300675024464"));
    }
}
