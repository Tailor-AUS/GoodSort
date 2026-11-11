/**
 * Sorting-credit rates, mirrored from the API (`Services/HouseholdCredit.cs`
 * and `Services/LaunchBonus.cs`). These are display defaults only — whenever
 * the API reports what it actually credited, show that number instead.
 *
 * The sorting credit is paid by The Good Sort after pickup and depot
 * verification. Never describe it as the Containers for Change scheme refund
 * or imply The Good Sort is an approved refund point.
 */
export const CENTS_PER_CONTAINER = 10;

/** Containers per member that earn double credit while an optional promotion runs (0 = off). */
export const LAUNCH_BONUS_CONTAINERS = 0;

export const LAUNCH_BONUS_CENTS = CENTS_PER_CONTAINER * 2;

/** "5¢" / "$1.20" — cents under a dollar stay in cents. */
export function formatCredit(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0) return "0¢";
  return cents < 100 ? `${Math.round(cents)}¢` : `$${(cents / 100).toFixed(2)}`;
}

/**
 * Headline promo copy driven by the live cap from `/api/growth/brisbane`, so
 * it disappears the moment ops sets LAUNCH_BONUS_CONTAINERS=0. Deliberately
 * says "double credit", never "10c" — that is the scheme refund, not ours.
 */
export function launchBonusHeadline(cap?: number | null): string | null {
  if (cap == null || cap <= 0) return null;
  return `Launch bonus: double credit on your first ${cap} containers.`;
}

/** Copy for the bonus, or null once a member has used it up. */
export function launchBonusNote(bonusRemaining?: number | null): string | null {
  if (bonusRemaining == null || bonusRemaining <= 0) return null;
  return `Launch bonus: double credit on your next ${bonusRemaining} container${bonusRemaining === 1 ? "" : "s"}.`;
}
