using GoodSort.Api.Data.Entities;

namespace GoodSort.Api.Services;

/// <summary>
/// Sanity bounds on the settings that decide what a driver is paid.
///
/// PATCH /api/admin/pricing wrote FloorCents, CeilingCents and every
/// multiplier straight through with no checking. Admin-only is not the same as
/// typo-free, and this is the one place where a slip multiplies every payout.
///
/// Two things about CalculateRate make it worth bounding rather than trusting.
///
/// First, the clamp is max(floor, min(ceiling, raw)). Set the floor above the
/// ceiling and that reduces to max(floor, ceiling) = floor: with floor 80 and
/// ceiling 8 a run prices at 80c, ten times the intended cap. The ceiling does
/// not merely stop helping, it is gone, and nothing errors or looks wrong.
///
/// Second — and this is the one that is easy to miss reading the code — the
/// level bonus is added AFTER the clamp:
///
///     finalRate = (int)Math.Round(clampedRate) + levelBonus
///
/// So CeilingCents does not bound what a driver is paid. The real per-container
/// maximum is ceiling plus the largest level bonus, and that is the number
/// checked here. A PlatinumBonus typo bypasses the ceiling completely.
///
/// The bounds are deliberately wide. They are not pricing policy — ops sets
/// policy — they are the difference between a number someone meant and a
/// number nobody could mean.
/// </summary>
public static class PricingBounds
{
    /// <summary>
    /// Twenty times the 5c base, applied to the effective maximum rather than
    /// the ceiling alone. Anything above this is a misplaced decimal: the
    /// scheme refund the whole model rests on is 10c a container.
    /// </summary>
    public const int MaxPerContainerCents = 100;

    /// <summary>A time-of-day factor outside this range is a typo, not a surge.</summary>
    public const double MinMultiplier = 0.1;
    public const double MaxMultiplier = 5.0;

    /// <summary>
    /// Returns the reason an update must be refused, or null if it is sane.
    /// Wording is aimed at whoever has to fix it.
    /// </summary>
    public static string? Reject(PricingConfig c)
    {
        foreach (var (name, cents) in new[]
                 {
                     ("Floor", c.FloorCents),
                     ("Ceiling", c.CeilingCents),
                     ("Base rate", c.BaseCents),
                     ("Bronze bonus", c.BronzeBonus),
                     ("Silver bonus", c.SilverBonus),
                     ("Gold bonus", c.GoldBonus),
                     ("Platinum bonus", c.PlatinumBonus),
                 })
        {
            if (cents < 0) return $"{name} cannot be negative ({cents}c).";
        }

        if (c.FloorCents > c.CeilingCents)
            return $"Floor ({c.FloorCents}c) is above ceiling ({c.CeilingCents}c). That does not " +
                   "raise the floor — it disables the ceiling, because the rate is clamped as " +
                   "max(floor, min(ceiling, rate)), so every run would price at the floor.";

        if (c.BaseCents > c.CeilingCents)
            return $"Base rate ({c.BaseCents}c) is above the ceiling ({c.CeilingCents}c).";

        // Level bonuses are added after the clamp, so the ceiling alone does not
        // bound the payout. This is the number that actually reaches a driver.
        var largestBonus = Math.Max(
            Math.Max(c.BronzeBonus, c.SilverBonus),
            Math.Max(c.GoldBonus, c.PlatinumBonus));
        var effectiveMax = c.CeilingCents + largestBonus;

        if (effectiveMax > MaxPerContainerCents)
            return $"The highest possible rate is {effectiveMax}c per container " +
                   $"(ceiling {c.CeilingCents}c plus the largest level bonus {largestBonus}c), " +
                   $"above the {MaxPerContainerCents}c sanity limit. Level bonuses are added " +
                   "AFTER the ceiling clamp, so a large bonus bypasses the ceiling entirely. " +
                   "The scheme refund is 10c, so this is almost certainly a misplaced decimal.";

        foreach (var (name, value) in new[]
                 {
                     ("Morning surge", c.MorningSurge),
                     ("Afternoon rate", c.AfternoonNormal),
                     ("Evening surge", c.EveningSurge),
                     ("Night discount", c.NightDiscount),
                 })
        {
            if (value < MinMultiplier || value > MaxMultiplier)
                return $"{name} of {value} is outside the sane range " +
                       $"{MinMultiplier}–{MaxMultiplier}. Time-of-day factors scale every payout.";
        }

        return null;
    }
}
