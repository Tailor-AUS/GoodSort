import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { lookupOpenFoodFacts, LOOKUP_TIMEOUT_MS } from "./containers.ts";

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
