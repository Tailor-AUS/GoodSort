import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CENTS_PER_CONTAINER,
  LAUNCH_BONUS_CONTAINERS,
  formatCredit,
  launchBonusHeadline,
  launchBonusNote,
} from "./credit.ts";

import {
  LIVE_VOLUME_THRESHOLD,
  canonicalSuburb,
  householdCountsTowardUnlock,
  inviteMessage,
  residentialNeedsStreet,
  streetInvitePath,
  streetStatsForViewer,
} from "./brisbane.ts";

/**
 * First tests on the frontend. They cover the two things it gets wrong in ways
 * nobody notices: the numbers it tells a member about their own money and
 * progress, and the claims it makes about the Containers for Change scheme.
 *
 * Both of these have already shipped broken. `justYouStats` reported
 * `households: 1` to a member the server was not counting at all, so one screen
 * said 1 and another said 0 about the single fact in dispute. And a legacy row
 * holding the literal string "BRISBANE" passed a non-empty suburb check, which
 * left that member with no redirect and no prompt — invisible and unwarned.
 */

// ── What a member is told they earned ──────────────────────────────────────

test("credit under a dollar stays in cents, and a dollar or more becomes dollars", () => {
  assert.equal(formatCredit(5), "5¢");
  assert.equal(formatCredit(99), "99¢");
  assert.equal(formatCredit(100), "$1.00");
  assert.equal(formatCredit(120), "$1.20");
});

test("no credit is never rendered as a negative or a bare number", () => {
  assert.equal(formatCredit(0), "0¢");
  assert.equal(formatCredit(-5), "0¢");
  assert.equal(formatCredit(Number.NaN), "0¢");
});

test("the bonus headline disappears the moment ops turns the promotion off", () => {
  // The homepage renders whatever this returns. If it kept producing copy at
  // cap 0 the site would advertise a promotion that no longer pays, which is
  // the one direction of this bug that is a false promise about money.
  assert.equal(launchBonusHeadline(0), null);
  assert.equal(launchBonusHeadline(null), null);
  assert.equal(launchBonusHeadline(undefined), null);
  assert.equal(launchBonusHeadline(-1), null);

  assert.match(launchBonusHeadline(LAUNCH_BONUS_CONTAINERS)!, /double credit/i);
  assert.match(launchBonusHeadline(LAUNCH_BONUS_CONTAINERS)!, /\b20\b/);
});

test("the per-member bonus note stops once a member has used the bonus up", () => {
  assert.equal(launchBonusNote(0), null);
  assert.equal(launchBonusNote(null), null);
  assert.match(launchBonusNote(1)!, /\b1 container\b/);
  assert.match(launchBonusNote(3)!, /\b3 containers\b/);
});

// ── The claim gate ─────────────────────────────────────────────────────────

test("no member-facing copy describes our credit as the scheme refund", () => {
  // The sorting credit is a private reward. The 10c is the Containers for
  // Change refund, which The Good Sort does not pass through and is not an
  // approved refund point for. Copy that conflates them is a claim about a
  // government scheme, not a wording preference — so this asserts on the
  // generated strings rather than trusting a reviewer to catch it.
  const generated = [
    launchBonusHeadline(LAUNCH_BONUS_CONTAINERS),
    launchBonusNote(5),
    inviteMessage("https://thegoodsort.org/s/moorooka", "MOOROOKA", {
      dayName: "Wednesday",
      containers: 10,
      households: 2,
      needed: LIVE_VOLUME_THRESHOLD - 10,
      live: false,
    }),
    inviteMessage("https://thegoodsort.org/s/moorooka", "MOOROOKA", {
      dayName: "Wednesday",
      containers: LIVE_VOLUME_THRESHOLD,
      households: 30,
      needed: 0,
      live: true,
    }),
  ].filter((s): s is string => typeof s === "string");

  assert.ok(generated.length >= 3, "expected copy to actually be generated");

  for (const copy of generated) {
    assert.doesNotMatch(copy, /10\s*(¢|c\b|cents)/i,
      `copy states the scheme refund amount: ${JSON.stringify(copy)}`);
    assert.doesNotMatch(copy, /containers for change|scheme refund|refund scheme/i,
      `copy invokes the scheme: ${JSON.stringify(copy)}`);
  }
});

// ── Progress a member is shown about their own suburb ──────────────────────

test("a member the server does not count is never shown a household of 1", () => {
  // This is the fabrication that shipped: one screen said 1, the server said 0.
  // A viewer who does not count toward unlock must see zero, not themselves.
  const uncounted = streetStatsForViewer(null, null, false);
  assert.equal(uncounted.households, 0);
  assert.equal(uncounted.containers, 0);
  assert.equal(uncounted.live, false);
  assert.equal(uncounted.needed, LIVE_VOLUME_THRESHOLD);

  // A member who does count is the one case where "just you" is honest.
  const counted = streetStatsForViewer(null, null, true);
  assert.equal(counted.households, 1);
  assert.equal(counted.live, false);
});

test("a viewer is never shown their suburb as unlocked when there is no cluster", () => {
  for (const counts of [true, false]) {
    assert.equal(streetStatsForViewer(null, null, counts).live, false);
    assert.equal(streetStatsForViewer(undefined, undefined, counts).live, false);
  }
});

// ── Who counts toward a run ────────────────────────────────────────────────

test("city-wide labels are not suburbs", () => {
  // Photon routinely returns "Brisbane" for an address. Treating it as a
  // cluster would pool unrelated members across the whole city.
  assert.equal(canonicalSuburb("Brisbane"), null);
  assert.equal(canonicalSuburb("BRISBANE"), null);
  assert.equal(canonicalSuburb("  brisbane "), null);
  assert.equal(canonicalSuburb(""), null);
  assert.equal(canonicalSuburb(null), null);
  assert.equal(canonicalSuburb("Moorooka"), "MOOROOKA");
});

test("a household only counts toward unlock when it is residential AND locatable", () => {
  assert.equal(householdCountsTowardUnlock({ type: "residential", suburb: "MOOROOKA" }), true);
  assert.equal(householdCountsTowardUnlock({ type: "unit_complex", suburb: "MOOROOKA" }), false);
  assert.equal(householdCountsTowardUnlock({ type: "residential", suburb: "BRISBANE" }), false);
  assert.equal(householdCountsTowardUnlock({ type: "residential", suburb: null }), false);
  assert.equal(householdCountsTowardUnlock(null), false);
});

test("a legacy BRISBANE row is treated as needing a suburb, not as complete", () => {
  // The silent variant: "BRISBANE" is non-empty, so a looser check returns
  // false here and the member gets no prompt and no redirect at all. They
  // scan into a number that will never move and nothing ever tells them.
  assert.equal(
    residentialNeedsStreet({ type: "residential", suburb: "BRISBANE", councilCollectionDay: 3 }),
    true,
  );
  assert.equal(
    residentialNeedsStreet({ type: "residential", suburb: "MOOROOKA", councilCollectionDay: 3 }),
    false,
  );
  // A real suburb with no collection day is still incomplete.
  assert.equal(
    residentialNeedsStreet({ type: "residential", suburb: "MOOROOKA", councilCollectionDay: null }),
    true,
  );
  // Buildings do not unlock, so they are never "missing a street".
  assert.equal(
    residentialNeedsStreet({ type: "unit_complex", suburb: null, councilCollectionDay: null }),
    false,
  );
});

// ── Invites ────────────────────────────────────────────────────────────────

test("an invite for an unknown suburb degrades to the bare site, so callers must suppress it", () => {
  // Pinning the degraded value rather than pretending it cannot happen. The
  // components check canonicalSuburb before rendering a share control for
  // exactly this reason: a bare city-wide link was removed deliberately, and
  // this is the shape it would come back in.
  assert.equal(streetInvitePath({ suburb: null }), "/");
  assert.equal(streetInvitePath({ suburb: "BRISBANE" }), "/");

  const real = streetInvitePath({ suburb: "MOOROOKA", day: 3 });
  assert.notEqual(real, "/");
  assert.match(real, /moorooka/i);
});
