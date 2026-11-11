import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

describe("Pass 13 — Runner stop/dropPoint graph, claimed-run release & inline /onboard OTP", () => {
  it("guards RunActive allDone against empty stops and wires releaseRun across client & runner sheet", () => {
    const apiClient = fs.readFileSync(path.join(ROOT, "lib/marketplace-api.ts"), "utf8");
    const runnerPage = fs.readFileSync(path.join(ROOT, "app/(runner)/runner/page.tsx"), "utf8");
    const runnerSheet = fs.readFileSync(path.join(ROOT, "app/(runner)/runner/components/runner-sheet.tsx"), "utf8");
    const runActive = fs.readFileSync(path.join(ROOT, "app/(runner)/runner/components/run-active.tsx"), "utf8");

    assert.match(apiClient, /export async function releaseRun\(runId:\s*string\)/);
    assert.match(apiClient, /\/api\/marketplace\/runs\/\$\{runId\}\/release/);

    assert.match(runnerPage, /handleRelease/);
    assert.match(runnerPage, /onRelease=\{handleRelease\}/);
    assert.match(runnerSheet, /onRelease=\{onRelease\}/);

    assert.match(
      runActive,
      /const allDone = totalStops > 0 && run\.stops\.every/,
      "RunActive must never treat an empty stops array as allDone"
    );
    assert.match(runActive, /Release Run/);
  });

  it("supports inline email + OTP verification and URL referral persistence on /onboard", () => {
    const onboard = fs.readFileSync(path.join(ROOT, "app/(auth)/onboard/page.tsx"), "utf8");
    const invite = fs.readFileSync(path.join(ROOT, "app/invite/page.tsx"), "utf8");

    assert.match(onboard, /persistWaitlistFromUrl\(\)/);
    assert.match(onboard, /setStep\("auth"\)/);
    assert.match(onboard, /\/api\/auth\/send-otp/);
    assert.match(onboard, /\/api\/auth\/verify-otp/);
    assert.match(onboard, /Verify & Start Scanning/);
    assert.doesNotMatch(
      onboard,
      /if \(!hasValidToken\(\)\) \{\s*writePlaceHint[^}]*router\.push\("\/login"\)/,
      "Signed-out visitors submitting /onboard should verify inline rather than bouncing to /login"
    );

    assert.match(invite, /<Link\s+href="\/flyer"/);
  });

  it("keeps app-version and SW_VERSION synchronized", () => {
    const layout = fs.readFileSync(path.join(ROOT, "app/layout.tsx"), "utf8");
    const sw = fs.readFileSync(path.join(ROOT, "public/sw.js"), "utf8");

    const layoutMatch = layout.match(/name="app-version"\s+content="(20261112-qa-pass\d+)"/);
    const swMatch = sw.match(/SW_VERSION\s*=\s*"(20261112-qa-pass\d+)"/);
    assert.ok(layoutMatch, "app/layout.tsx must declare app-version meta");
    assert.ok(swMatch, "public/sw.js must declare SW_VERSION");
    assert.equal(layoutMatch[1], swMatch[1]);
  });
});
