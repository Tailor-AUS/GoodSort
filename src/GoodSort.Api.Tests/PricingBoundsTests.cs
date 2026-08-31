using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

/// <summary>
/// Sanity bounds on the knob that multiplies every driver payout.
///
/// PATCH /api/admin/pricing wrote FloorCents, CeilingCents and every
/// multiplier straight through unchecked. Admin-only is not the same as
/// typo-free, and CalculateRate ends with max(floor, min(ceiling, raw)), so
/// the ceiling is the last line between a pricing mistake and the bank.
///
/// The inverted case is the one worth the code. With floor 80 and ceiling 8
/// that expression yields 80 — ten times the intended cap — and nothing errors
/// or looks wrong. Verified arithmetically, not assumed.
/// </summary>
public class PricingBoundsTests
{
    private static PricingConfig Sane() => new();   // defaults: floor 3, ceiling 8, base 5

    [Fact]
    public void The_shipped_defaults_are_accepted()
    {
        // If the bounds ever reject the defaults, ops cannot save the config at
        // all — the guard would take pricing down rather than protect it.
        Assert.Null(PricingBounds.Reject(Sane()));
    }

    [Fact]
    public void An_inverted_floor_and_ceiling_is_refused()
    {
        var c = Sane();
        c.FloorCents = 80;
        c.CeilingCents = 8;

        var reason = PricingBounds.Reject(c);
        Assert.NotNull(reason);
        Assert.Contains("disables the ceiling", reason);
    }

    [Fact]
    public void A_misplaced_decimal_on_the_ceiling_is_refused()
    {
        // 5000c where 50c was meant: a 500-container run settles at $25,000 to
        // one driver, by entirely correct arithmetic.
        var c = Sane();
        c.CeilingCents = 5000;

        Assert.Contains("sanity limit", PricingBounds.Reject(c)!);
    }

    [Fact]
    public void Negative_rates_are_refused()
    {
        var floor = Sane(); floor.FloorCents = -1;
        var ceiling = Sane(); ceiling.CeilingCents = -1;
        var basec = Sane(); basec.BaseCents = -1;

        Assert.NotNull(PricingBounds.Reject(floor));
        Assert.NotNull(PricingBounds.Reject(ceiling));
        Assert.NotNull(PricingBounds.Reject(basec));
    }

    [Fact]
    public void A_base_rate_above_the_ceiling_is_refused()
    {
        var c = Sane();
        c.BaseCents = 20;   // ceiling is 8

        Assert.NotNull(PricingBounds.Reject(c));
    }

    [Theory]
    [InlineData(50.0)]      // 50x surge
    [InlineData(0.0)]       // pays nothing
    [InlineData(-1.5)]      // negative
    public void A_time_of_day_factor_far_outside_the_sane_range_is_refused(double bad)
    {
        var morning = Sane(); morning.MorningSurge = bad;
        var night = Sane(); night.NightDiscount = bad;
        var evening = Sane(); evening.EveningSurge = bad;

        Assert.NotNull(PricingBounds.Reject(morning));
        Assert.NotNull(PricingBounds.Reject(night));
        Assert.NotNull(PricingBounds.Reject(evening));
    }

    [Fact]
    public void A_level_bonus_that_bypasses_the_ceiling_is_refused()
    {
        // The one that is easy to miss reading the code: the level bonus is
        // added AFTER the clamp, so CeilingCents does not bound the payout. A
        // platinum bonus of 5000c pays 5008c a container with a ceiling of 8.
        var c = Sane();
        c.PlatinumBonus = 5000;

        var reason = PricingBounds.Reject(c);
        Assert.NotNull(reason);
        Assert.Contains("AFTER the ceiling clamp", reason);
    }

    [Fact]
    public void A_zero_level_bonus_is_fine_because_that_is_the_default()
    {
        // Bronze and silver ship at 0. Treating bonuses as multipliers would
        // reject the shipped configuration — which is how I first wrote this.
        var c = Sane();
        c.BronzeBonus = 0;
        c.SilverBonus = 0;

        Assert.Null(PricingBounds.Reject(c));
    }

    [Fact]
    public void A_negative_level_bonus_is_refused()
    {
        var c = Sane();
        c.GoldBonus = -5;

        Assert.NotNull(PricingBounds.Reject(c));
    }

    [Fact]
    public void Real_pricing_decisions_are_left_alone()
    {
        // The bounds catch what nobody could mean. They must not become policy:
        // doubling the ceiling, or a 2x morning surge, is ops doing their job.
        var c = Sane();
        c.FloorCents = 3;
        c.CeilingCents = 16;
        c.BaseCents = 9;
        c.MorningSurge = 2.0;
        c.NightDiscount = 0.5;

        Assert.Null(PricingBounds.Reject(c));
    }
}
