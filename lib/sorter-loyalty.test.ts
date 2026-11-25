import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildSorterLoyaltySummary,
  computeScanStreaks,
  countStreamsFromScans,
  resolveSorterTier,
} from "./sorter-loyalty.ts";
import type { ScanRecord, User } from "./store.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u1",
    name: "Alex",
    householdId: "hh1",
    role: "sorter",
    pendingCents: 0,
    clearedCents: 0,
    totalContainers: 0,
    totalCO2SavedKg: 0,
    scans: [],
    collections: [],
    badges: [],
    createdAt: "2026-11-20T00:00:00Z",
    ...overrides,
  };
}

function makeScan(id: string, material: string, timestamp: string): ScanRecord {
  return {
    id,
    barcode: "9300675000001",
    containerName: "Drink Can 375mL",
    material,
    refundCents: 10,
    status: "pending",
    householdId: "hh1",
    routeId: null,
    timestamp,
  };
}

test("resolveSorterTier maps Bronze / Silver / Gold / Platinum cleanly at thresholds", () => {
  assert.equal(resolveSorterTier(0).id, "bronze");
  assert.equal(resolveSorterTier(49).id, "bronze");
  assert.equal(resolveSorterTier(50).id, "silver");
  assert.equal(resolveSorterTier(249).id, "silver");
  assert.equal(resolveSorterTier(250).id, "gold");
  assert.equal(resolveSorterTier(999).id, "gold");
  assert.equal(resolveSorterTier(1000).id, "platinum");
});

test("computeScanStreaks calculates Brisbane-local consecutive days accurately", () => {
  const now = new Date("2026-11-25T00:30:00Z"); // 2026-11-25 10:30 AEST
  const scans = [
    makeScan("s1", "aluminium", "2026-11-20T01:00:00Z"), // Nov 20 AEST
    makeScan("s2", "aluminium", "2026-11-23T02:00:00Z"), // Nov 23 AEST
    makeScan("s3", "pet", "2026-11-24T05:00:00Z"),       // Nov 24 AEST
    makeScan("s4", "glass", "2026-11-24T23:00:00Z"),     // Nov 25 09:00 AEST
  ];
  const { currentStreakDays, longestStreakDays } = computeScanStreaks(scans, now);
  assert.equal(currentStreakDays, 3);
  assert.equal(longestStreakDays, 3);

  // Stale streak (>1 day gap) resets currentStreakDays to 0 while preserving longest
  const stale = computeScanStreaks(scans, new Date("2026-11-28T00:00:00Z"));
  assert.equal(stale.currentStreakDays, 0);
  assert.equal(stale.longestStreakDays, 3);
});

test("buildSorterLoyaltySummary computes points, 4 streams, progress ring, and milestones", () => {
  const scans = [
    makeScan("s1", "aluminium", "2026-11-24T22:00:00Z"),
    makeScan("s2", "pet", "2026-11-24T22:05:00Z"),
    makeScan("s3", "glass", "2026-11-24T22:10:00Z"),
    makeScan("s4", "hdpe", "2026-11-24T22:15:00Z"),
  ];
  const streams = countStreamsFromScans(scans);
  assert.deepEqual(streams, { aluminium: 1, clearPet: 1, coloured: 1, glass: 1 });

  const summary = buildSorterLoyaltySummary(
    makeUser({ totalContainers: 12, pendingCents: 120, clearedCents: 50, totalCO2SavedKg: 1.8, scans }),
    { sortersCount: 2, referredContainers: 30, totalNetworkCents: 0, totalNetworkPoints: 230 },
    new Date("2026-11-25T00:00:00Z"),
  );

  assert.equal(summary.tier.id, "bronze");
  assert.equal(summary.goodSortPoints, 350); // 12*10 + 2*100 + 30 referred = 350 PTS
  assert.equal(summary.totalCreditCents, 170);
  assert.equal(summary.containersToNextTier, 38);
  assert.equal(summary.progressPct, 24);
  assert.equal(summary.milestones.find((m) => m.id === "first_can")?.earned, true);
  assert.equal(summary.milestones.find((m) => m.id === "ten_club")?.earned, true);
  assert.equal(summary.milestones.find((m) => m.id === "four_streams")?.earned, true);
  assert.equal(summary.milestones.find((m) => m.id === "street_captain")?.earned, true);
  assert.equal(summary.milestones.find((m) => m.id === "silver_status")?.earned, false);
});

test("/scan post-scan CTA says Back to dashboard, MemberStatusCard stays honest, and zero visible Mafia copy remains in app/", () => {
  const postScan = fs.readFileSync(path.join(repoRoot, "app", "components", "shared", "post-scan-setup.tsx"), "utf8");
  assert.match(postScan, /Back to dashboard/);
  assert.doesNotMatch(postScan, /Back to my suburb/);

  const card = fs.readFileSync(path.join(repoRoot, "app", "sort", "components", "member-status-card.tsx"), "utf8");
  assert.match(card, /Frequent Sorter/);
  assert.match(card, /Good Sort Points/);
  assert.match(card, /Points Swap/);
  // Never claim unauthorised airline trademark/partnership live before a signed partner agreement
  assert.doesNotMatch(card, /\bQantas\b/i);

  // Zero user-facing "Mafia" copy anywhere under app/ (only internal API DTO property containerMafiaCents allowed)
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
      const full = path.join(dir, ent.name);
      return ent.isDirectory() ? walk(full) : ent.name.endsWith(".tsx") ? [full] : [];
    });

  for (const file of walk(path.join(repoRoot, "app"))) {
    const cleaned = fs.readFileSync(file, "utf8").replace(/\bcontainerMafiaCents\b/g, "");
    assert.doesNotMatch(cleaned, /\bmafia\b/i, `Visible Mafia copy remained in ${path.relative(repoRoot, file)}`);
  }

  // Native 5-tab floating Liquid Glass app shell present on /sort
  const home = fs.readFileSync(path.join(repoRoot, "app", "sort", "components", "waitlist-home.tsx"), "utf8");
  assert.match(home, /aria-label="Main app navigation"/);
  assert.match(home, /Sort and explore/);
  assert.match(home, /Pickups/);
  assert.match(home, /Profile/);
});
