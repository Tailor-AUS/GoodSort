import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const mem = new Map<string, string>();
const storage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
};
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
Object.defineProperty(globalThis, "window", { value: { localStorage: storage }, configurable: true, writable: true });

test("getUserApi preserves server createdAt timestamps and 0-cent ineligible scan records", async () => {
  storage.clear();
  storage.setItem("goodsort_profile", JSON.stringify({ id: "user-p17", householdId: "hh-p17" }));
  storage.setItem("goodsort_token", "tok-p17");

  const origFetch = globalThis.fetch;
  try {
    (globalThis as Record<string, unknown>).fetch = async (url: string) => {
      const s = String(url);
      if (s.includes("/api/profiles/user-p17")) {
        return new Response(
          JSON.stringify({
            id: "user-p17",
            name: "Sam",
            householdId: "hh-p17",
            role: "sorter",
            pendingCents: 10,
            clearedCents: 0,
            totalContainers: 1,
            totalCo2SavedKg: 0.035,
            badges: [],
            createdAt: "2026-10-15T01:00:00.000Z",
          }),
          { status: 200 },
        );
      }
      if (s.includes("/api/scans")) {
        return new Response(
          JSON.stringify([
            {
              id: "scan-eligible",
              barcode: "9300675024457",
              containerName: "Coca-Cola 375ml",
              material: "aluminium",
              refundCents: 10,
              status: "pending",
              createdAt: "2026-11-01T08:00:00.000Z",
            },
            {
              id: "scan-zero",
              barcode: "PHOTO",
              containerName: "Non-CDS jar",
              material: "other",
              refundCents: 0,
              status: "pending",
              createdAt: "2026-11-02T09:30:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    };

    const { getUserApi } = await import("./store-api.ts");
    const user = await getUserApi();
    assert.ok(user);
    assert.equal(user!.scans.length, 2);
    assert.equal(
      user!.scans[0].timestamp,
      "2026-11-01T08:00:00.000Z",
      "getUserApi must map C# Scan.createdAt instead of overwriting historical timestamps with now()",
    );
    assert.equal(user!.scans[1].timestamp, "2026-11-02T09:30:00.000Z");
    assert.equal(
      user!.scans[1].refundCents,
      0,
      "getUserApi must preserve 0-cent scans instead of inflating 0 || 10 to 10",
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("flushUnsyncedScans caps each burst at MAX_FLUSH_BATCH (50) so offline hauls do not self-trigger 60/min 429s", async () => {
  storage.clear();
  const { saveUser, saveHouseholds, getUnsyncedScans } = await import("./store.ts");
  const { addScanApi, flushUnsyncedScans, MAX_FLUSH_BATCH } = await import("./store-api.ts");

  assert.equal(MAX_FLUSH_BATCH, 50);

  saveUser({
    id: "user-burst",
    name: "Burst Sorter",
    householdId: "hh-burst",
    role: "sorter",
    pendingCents: 0,
    clearedCents: 0,
    totalContainers: 0,
    totalCO2SavedKg: 0,
    scans: [],
    collections: [],
    badges: [],
    createdAt: new Date(0).toISOString(),
  });
  saveHouseholds([
    {
      id: "hh-burst",
      name: "Burst House",
      address: "10 Mayfield Rd, Moorooka QLD 4105",
      lat: -27.535,
      lng: 153.025,
      pendingContainers: 0,
      pendingValueCents: 0,
      estimatedWeightKg: 0,
      estimatedBags: 0,
      materials: { aluminium: 0, pet: 0, glass: 0, other: 0 },
      lastScanAt: null,
      createdAt: new Date(0).toISOString(),
    },
  ]);
  storage.setItem("goodsort_profile", JSON.stringify({ id: "user-burst", householdId: "hh-burst" }));
  storage.setItem("goodsort_token", "tok-burst");

  const origFetch = globalThis.fetch;
  try {
    // Offline: member scans 65 cans in garage
    (globalThis as Record<string, unknown>).fetch = async () => {
      throw new Error("offline");
    };
    for (let i = 0; i < 65; i++) {
      await addScanApi("9300675024457", `Can ${i + 1}`, "aluminium");
    }
    assert.equal(getUnsyncedScans().length, 65);

    // Back online: pass 1 sends 50 (< 60/min limit), leaving 15 safely queued
    let postCalls = 0;
    (globalThis as Record<string, unknown>).fetch = async () => {
      postCalls++;
      return new Response(JSON.stringify({ creditedCents: 10, bonusRemaining: 0 }), { status: 200 });
    };

    const pass1 = await flushUnsyncedScans();
    assert.equal(pass1.sent, 50);
    assert.equal(pass1.refused, 0);
    assert.equal(pass1.stillPending, 15);
    assert.equal(postCalls, 50);

    // Pass 2 sends the remaining 15
    const pass2 = await flushUnsyncedScans();
    assert.equal(pass2.sent, 15);
    assert.equal(pass2.stillPending, 0);
    assert.equal(postCalls, 65);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("Scanner accepts 14-digit GTIN-14 barcodes, preserves 0-container server count, and clears expired tokens on 401", () => {
  const src = readFileSync(join(ROOT, "app", "components", "shared", "scanner.tsx"), "utf8");

  assert.match(src, /cleaned\.length < 8 \|\| cleaned\.length > 14/);
  assert.doesNotMatch(src, /cleaned\.length > 13/);
  assert.match(src, /typeof data\.totalContainers === "number"/);
  assert.match(src, /if \(res\.status === 401\) clearAuth\(\)/);
  assert.match(src, /res\.status === 429/);
});

test("RunActive updates stop count even when verified total is 0 (contaminated bag) and extracts GSB codes cleanly", () => {
  const src = readFileSync(join(ROOT, "app", "(runner)", "runner", "components", "run-active.tsx"), "utf8");

  assert.match(src, /typeof res\.stopVerifiedTotal === "number"/);
  assert.doesNotMatch(src, /res\.stopVerifiedTotal > 0 \?/);
  assert.match(src, /\\b\(GSB-\[A-Z0-9-\]\+\)\\b/);
});
