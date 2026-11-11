import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

test("PostScanSetup persists hh.id before residentialNeedsStreet early return and handles 401 on payout PUT", () => {
  const src = readFileSync(join(ROOT, "app", "components", "shared", "post-scan-setup.tsx"), "utf8");

  const jsonIdx = src.indexOf("const hh = await hhRes.json();");
  const persistIdx = src.indexOf("setExistingHouseholdId(hh.id);", jsonIdx);
  const needsStreetIdx = src.indexOf("if (residentialNeedsStreet(hh))", jsonIdx);
  assert.ok(jsonIdx !== -1, "Expected const hh = await hhRes.json() in PostScanSetup");
  assert.ok(
    persistIdx !== -1 && needsStreetIdx !== -1 && persistIdx < needsStreetIdx,
    "PostScanSetup must persist hh.id to state/localStorage before residentialNeedsStreet(hh) early return so retries PATCH /street instead of looping on POST /api/households",
  );

  const payoutIdx = src.indexOf('fetch(apiUrl("/api/profiles/me/payout")', jsonIdx);
  assert.ok(payoutIdx !== -1, "Expected payout PUT fetch in PostScanSetup");
  const afterPayout = src.slice(payoutIdx, payoutIdx + 900);
  assert.match(afterPayout, /payoutRes\.status === 401/, "PostScanSetup must handle 401 on payout PUT");
  assert.match(afterPayout, /clearAuth\(\)/, "PostScanSetup must clearAuth() on 401 payout PUT");
});

test("OnboardPage persists hh.id before residentialNeedsStreet early return and handles 401 on payout PUT", () => {
  const src = readFileSync(join(ROOT, "app", "(auth)", "onboard", "page.tsx"), "utf8");

  const jsonIdx = src.indexOf("const hh = await hhRes.json();");
  const persistIdx = src.indexOf("profile.householdId = hh.id;", jsonIdx);
  const needsStreetIdx = src.indexOf("if (residentialNeedsStreet(hh))", jsonIdx);
  assert.ok(jsonIdx !== -1, "Expected const hh = await hhRes.json() in OnboardPage");
  assert.ok(
    persistIdx !== -1 && needsStreetIdx !== -1 && persistIdx < needsStreetIdx,
    "OnboardPage must persist profile.householdId = hh.id before residentialNeedsStreet(hh) early return so retries PATCH /street",
  );

  const payoutIdx = src.indexOf('fetch(apiUrl("/api/profiles/me/payout")', jsonIdx);
  assert.ok(payoutIdx !== -1, "Expected payout PUT fetch in OnboardPage");
  const afterPayout = src.slice(payoutIdx, payoutIdx + 900);
  assert.match(afterPayout, /payRes\.status === 401/, "OnboardPage must handle 401 on payout PUT");
  assert.match(afterPayout, /clearAuth\(\)/, "OnboardPage must clearAuth() on 401 payout PUT");
});

test("Standalone /scan clamps item counts and reconciles server totalContainers on confirm()", () => {
  const src = readFileSync(join(ROOT, "app", "scan", "page.tsx"), "utf8");
  const confirmIdx = src.indexOf("async function confirm()");
  assert.ok(confirmIdx !== -1, "Expected confirm() in app/scan/page.tsx");
  const confirmBlock = src.slice(confirmIdx, confirmIdx + 1900);

  assert.match(confirmBlock, /Math\.max\(0,\s*Math\.min\(100,\s*r\.count\)\)/);
  assert.match(confirmBlock, /typeof data\.totalContainers === "number"/);
  assert.match(confirmBlock, /setTotalItems\(data\.totalContainers\)/);
});

test("SorterSheet prompts collecting households missing payout details and uses explicit button types", () => {
  const src = readFileSync(join(ROOT, "app", "sort", "components", "sorter-sheet.tsx"), "utf8");

  assert.match(src, /\/api\/profiles\/me\/payout/);
  assert.match(src, /hasPayoutDetails === false/);
  assert.match(src, /Add your PayID or bank details so we can pay you/);

  const buttonTags = src.match(/<button\b[^>]*>/g) ?? [];
  assert.ok(buttonTags.length >= 3, "Expected at least 3 <button> elements in SorterSheet");
  for (const tag of buttonTags) {
    assert.match(tag, /type="button"/, `SorterSheet button missing type="button": ${tag}`);
  }
});

test("Household BinOutToggle exposes switch role and aria-checked, and /flyer uses honest Earn 10¢ / Can badge", () => {
  const hhSrc = readFileSync(join(ROOT, "app", "household", "page.tsx"), "utf8");
  assert.match(hhSrc, /role="switch"/);
  assert.match(hhSrc, /aria-checked=\{hh\.binIsOut\}/);

  const flyerSrc = readFileSync(join(ROOT, "app", "flyer", "page.tsx"), "utf8");
  assert.match(flyerSrc, /Earn 10¢ \/ Can/);
  assert.doesNotMatch(flyerSrc, /\+10¢ \/ Can Bonus/i);
});
