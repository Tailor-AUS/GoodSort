import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { lookupOpenFoodFacts, LOOKUP_TIMEOUT_MS } from "./containers.ts";
import { geocodeAddress, PHOTON_TIMEOUT_MS, suburbFromPhoton } from "./photon.ts";

/**
 * Screens a member cannot get out of.
 *
 * Two of them, both on the path to a first scan, and both invisible to a build:
 *
 * The OTP screen on /scan had a six-digit box, an error line and a Verify
 * button — no resend, and no way back to the email field. A mistyped address, a
 * code that lapsed past its fifteen minutes, or one sitting in spam left the
 * member with nothing to press. Both landing-page CTAs route to /scan, so this
 * is the primary funnel.
 *
 * The barcode lookup rendered a full-screen black "Looking up container..."
 * with no close button, and the fetch behind it had no timeout and no
 * AbortController. A stalled request meant a member at a bin staring at a black
 * screen with no way out but killing the app.
 *
 * Neither throws, neither logs, and both look fine on a fast connection.
 */

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** Source with comments stripped — they quote the strings being searched for. */
function code(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("a hung barcode lookup gives up instead of hanging forever", async () => {
  // The real behaviour, not a source assertion: a fetch that never settles must
  // still resolve, because a member is watching a black screen while it runs.
  const original = globalThis.fetch;
  let aborted = false;

  globalThis.fetch = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      });
    })) as typeof fetch;

  const started = Date.now();
  try {
    const result = await lookupOpenFoodFacts("9300675024457");
    const elapsed = Date.now() - started;

    assert.equal(result, null, "a timeout must resolve null so the caller falls through to the unknown container");
    assert.ok(aborted, "the request must actually be aborted, not just abandoned");
    assert.ok(
      elapsed < LOOKUP_TIMEOUT_MS + 2000,
      `waited ${elapsed}ms — the lookup must be bounded by LOOKUP_TIMEOUT_MS (${LOOKUP_TIMEOUT_MS}ms)`,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("the timeout is short enough for someone standing at a bin", () => {
  assert.ok(LOOKUP_TIMEOUT_MS <= 10_000, "nobody waits ten seconds at a wheelie bin");
  assert.ok(LOOKUP_TIMEOUT_MS >= 3_000, "too short and a slow-but-working lookup is thrown away");
});

test("the lookup overlay has a way out", () => {
  // Belt to the timeout's braces: even bounded, the member must be able to
  // leave. This screen covers the whole viewport while it renders.
  const scanner = code(join("app", "components", "shared", "scanner.tsx"));
  const start = scanner.indexOf("Looking up container");
  assert.ok(start > 0, "the lookup overlay should still exist");

  // Search backwards to the start of the overlay it belongs to.
  const overlayStart = scanner.lastIndexOf("fixed inset-0", start);
  const overlay = scanner.slice(overlayStart, start);

  assert.match(
    overlay,
    /onClick=\{handleClose\}/,
    "the full-screen lookup overlay has no close control, so a stalled lookup traps the member",
  );
});

test("the OTP screen lets a member recover", () => {
  const scan = code(join("app", "scan", "page.tsx"));
  const verifyStart = scan.indexOf('step === "verify"');
  assert.ok(verifyStart > 0, "the verify step should still exist");
  const verifyScreen = scan.slice(verifyStart, scan.indexOf('step === "done"', verifyStart));

  assert.match(verifyScreen, /Resend/i, "a code that expired or never arrived needs a resend");
  assert.match(verifyScreen, /different email/i, "a mistyped address needs a way back");
  assert.match(
    verifyScreen,
    /setStep\("auth"\)/,
    "the way back must actually return to the email step, not just look like it does",
  );
});

test("resending is rate-limited so the button cannot be leaned on", () => {
  const scan = code(join("app", "scan", "page.tsx"));
  assert.match(scan, /resendIn/, "a resend with no cooldown invites a member to hammer it");
  assert.match(scan, /disabled=\{authLoading \|\| resendIn > 0\}/);
});

test("a failed verification says what actually went wrong", () => {
  // "Invalid code" cannot distinguish an expired code from a wrong one, and the
  // two need different actions — resend versus retype.
  const scan = code(join("app", "scan", "page.tsx"));
  const verifyFn = scan.slice(scan.indexOf("async function verifyOtp"), scan.indexOf("async function", scan.indexOf("async function verifyOtp") + 10));

  assert.match(verifyFn, /data\.error/, "the server's reason must be surfaced, not discarded");
  assert.doesNotMatch(
    verifyFn,
    /setAuthError\("Invalid code"\)/,
    "the blanket 'Invalid code' throws away the only information that tells the member what to do next",
  );
});

/**
 * The card must not promise a collection nobody has scheduled.
 *
 * `nextPickup` is NextRunnerLocalDate(councilCollectionDay) — the night before
 * the member's own COUNCIL recycling day. It is not a GoodSort run, and the
 * server is explicit about that: it returns `confirmed: false` for any
 * household that is not yet serviceable, with a reason saying a run unlocks on
 * suburb volume.
 *
 * The card labelled it "We'll collect" regardless, above the date in large
 * extra-bold type, with the qualifier small and grey below. The copy was
 * accurate; the two lines a person reads first were not. And it rendered for
 * every waitlisted member, which on production is every member.
 */

test("an unconfirmed pickup is not labelled as a collection", () => {
  const card = code(join("app", "components", "shared", "collection-night-card.tsx"));

  // The label must be derived from `confirmed`, not hardcoded per tone.
  assert.match(card, /function pickupLabel\(/, "the two tones must share one label rule");

  const label = card.slice(card.indexOf("function pickupLabel("), card.indexOf("}", card.indexOf("function pickupLabel(")) + 1);
  assert.match(label, /confirmed \?/, "the label has to depend on whether a run is confirmed");
  assert.doesNotMatch(
    label,
    /We'll collect|Next pickup/,
    "an unconfirmed date must not be labelled as a collection — it is the member's council recycling night.",
  );
});

test("the confirmed case still gives the instruction", () => {
  // The opposite mistake: hedging the one case where a collection IS scheduled
  // and the member genuinely needs to put containers out.
  const card = code(join("app", "components", "shared", "collection-night-card.tsx"));
  assert.match(card, /"Bag out"/, "a confirmed pickup must still say to bag out");
});

test("the qualifying copy still explains what unlocks a run", () => {
  const card = code(join("app", "components", "shared", "collection-night-card.tsx"));
  assert.match(card, /volume run starts once your suburb/i);
  assert.match(card, /Suburb volume is enough for a driver trip/i);
});

test("/sort and /runner never trap an unauthenticated visitor on Loading...", () => {
  const sort = code(join("app", "sort", "page.tsx"));
  assert.doesNotMatch(sort, /if\s*\(\s*loading\s*\|\|\s*!user\s*\)/, "/sort must separate loading from !user");
  assert.match(sort, /if\s*\(\s*!user\s*\)/, "/sort needs an explicit signed-out recovery screen");
  assert.match(sort, /href="\/scan"/);
  assert.match(sort, /href="\/login"/);

  const runner = code(join("app", "(runner)", "runner", "page.tsx"));
  assert.doesNotMatch(runner, /if\s*\(\s*loading\s*\|\|\s*!user\s*\)/, "/runner must separate loading from !user");
  assert.match(runner, /if\s*\(\s*!user\s*\)/, "/runner needs an explicit signed-out recovery screen");
  assert.match(runner, /href="\/runner\/signup"/);
});

test("/bags and /household link missing-address members to /onboard, never a dead end", () => {
  const bags = code(join("app", "bags", "page.tsx"));
  assert.doesNotMatch(bags, /href="\/household"/, "/bags must not send a no-household member to /household");
  assert.match(bags, /href="\/onboard"/, "/bags should send missing-address members straight to /onboard");
  assert.match(bags, /!signedIn/, "/bags should handle unauthenticated visitors explicitly");

  const household = code(join("app", "household", "page.tsx"));
  assert.match(household, /\/onboard/, "/household error state needs a recovery link to /onboard");
});

test("AccountPanel log out clears all stored auth keys via clearAuth()", () => {
  const panel = code(join("app", "components", "shared", "account-panel.tsx"));
  assert.match(panel, /clearAuth\(\)/, "Log Out must call clearAuth() so goodsort_user cannot bleed across accounts");
});

test("AuthGuard permits /bags, /sort, and /runner/signup without bouncing signed-out visitors to /", () => {
  const guard = code(join("app", "components", "shared", "auth-guard.tsx"));
  for (const prefix of ["/bags", "/sort", "/runner"]) {
    assert.ok(
      guard.includes(`"${prefix}"`),
      `PUBLIC_PATH_PREFIXES must include "${prefix}" so public links on /marketplace and /flyer do not silently bounce to /`,
    );
  }
});

test("/runner/signup supports inline email + OTP verification without losing vehicle fields", () => {
  const signup = code(join("app", "(runner)", "runner", "signup", "page.tsx"));
  assert.doesNotMatch(signup, /router\.push\("\/login"\)/, "/runner/signup must not discard the driver form by bouncing to /login");
  assert.match(signup, /\/api\/auth\/send-otp/);
  assert.match(signup, /\/api\/auth\/verify-otp/);
  assert.match(signup, /resendIn/, "/runner/signup OTP verify needs resend cooldown");
  assert.match(signup, /different email/i, "/runner/signup OTP verify needs a way back to edit email");
  assert.match(signup, /data\.error/, "/runner/signup must surface server error reasons");
});

test("/verify and MarketingHome surface server OTP errors and offer email recovery", () => {
  const verify = code(join("app", "(auth)", "verify", "page.tsx"));
  assert.doesNotMatch(verify, /setError\("Invalid code/, "/verify must surface server data.error instead of blanket 'Invalid code'");
  assert.match(verify, /data\.error/);
  assert.match(verify, /resendIn/);

  const home = code(join("app", "components", "marketing", "marketing-home.tsx"));
  assert.doesNotMatch(home, /setError\("Invalid code"\)/, "MarketingHome must surface server data.error instead of blanket 'Invalid code'");
  assert.match(home, /Use a different email/);
  assert.match(home, /setStep\("email"\)/);
});

test("a hung Photon geocode gives up instead of freezing address setup forever", async () => {
  const original = globalThis.fetch;
  let aborted = false;

  globalThis.fetch = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      });
    })) as typeof fetch;

  const started = Date.now();
  try {
    const result = await geocodeAddress("88 Ekibin Rd East Annerley");
    const elapsed = Date.now() - started;
    assert.equal(result, null, "timed-out Photon geocode must resolve null cleanly");
    assert.ok(aborted, "Photon request must be aborted via AbortController");
    assert.ok(elapsed < PHOTON_TIMEOUT_MS + 2000, `waited ${elapsed}ms — expected <= ${PHOTON_TIMEOUT_MS}ms`);
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(suburbFromPhoton({ district: "Annerley", city: "Brisbane" }), "Annerley");
});

test("no yellow-lid bin decal copy remains on domestic /flyer, /invite, or /sort", () => {
  for (const rel of [
    join("app", "flyer", "page.tsx"),
    join("app", "invite", "page.tsx"),
    join("app", "sort", "components", "waitlist-home.tsx"),
  ]) {
    const src = code(rel);
    assert.doesNotMatch(src, /Yellow-Bin/i, `${rel} must not reference yellow-lid bins`);
  }
});

test("/runner never silently auto-enrolls a visiting Home Sorter as a Runner", () => {
  const runner = code(join("app", "(runner)", "runner", "page.tsx"));
  assert.doesNotMatch(
    runner,
    /registerAsRunner\s*\(/,
    "/runner must not call registerAsRunner() automatically on visit",
  );
  assert.match(runner, /hasRunnerProfile === false/, "/runner must render an explicit opt-in screen for non-runners");
  assert.match(runner, /href="\/runner\/signup"/, "/runner opt-in screen must link to /runner/signup");
  assert.match(runner, /href="\/sort"/, "/runner opt-in screen must give Home Sorters a way back to /sort");

  const marketplace = code(join("app", "marketplace", "page.tsx"));
  assert.match(
    marketplace,
    /isRunner \? "\/runner" : "\/runner\/signup"/,
    "/marketplace driver CTA must send non-runner signed-in members to /runner/signup",
  );
});
