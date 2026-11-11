import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}

const mem = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { value: mem, configurable: true });
Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });

const { flushUnsyncedScans } = await import("./store-api.ts");
const { getHouseholds, getUser, saveHouseholds, saveUser } = await import("./store.ts");

describe("Pass 14 hardening: offline scan credit reconciliation, lease safety & version parity", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mem.clear();
    mem.setItem("goodsort_token", "fake.jwt.token");
    mem.setItem(
      "goodsort_profile",
      JSON.stringify({
        id: "22222222-2222-4222-8222-222222222222",
        householdId: "11111111-1111-4111-8111-111111111111",
      })
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reconciles server creditedCents onto local scan, user pendingCents, and household pendingValueCents when flushing offline scans", async () => {
    const hhId = "11111111-1111-4111-8111-111111111111";
    saveHouseholds([
      {
        id: hhId,
        name: "Moorooka Home",
        address: "10 Test St, Moorooka QLD 4105",
        lat: -27.53,
        lng: 153.02,
        pendingContainers: 1,
        pendingValueCents: 10, // offline 10c standard estimate
        materials: { aluminium: 1, pet: 0, glass: 0, other: 0 },
        estimatedWeightKg: 0.015,
        estimatedBags: 1,
        lastScanAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]);

    saveUser({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Offline Sorter",
      householdId: hhId,
      role: "sorter",
      pendingCents: 10, // offline 10c standard estimate before server launch-bonus credit (20c)
      clearedCents: 0,
      totalContainers: 1,
      totalCO2SavedKg: 0.1,
      scans: [
        {
          id: "scan-offline-1",
          barcode: "9300675001113",
          containerName: "Aluminium Can",
          material: "aluminium",
          refundCents: 10,
          status: "pending",
          householdId: hhId,
          routeId: null,
          timestamp: new Date().toISOString(),
          pendingSync: true,
        },
      ],
      collections: [],
      badges: [],
      createdAt: new Date().toISOString(),
    });

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: "srv-scan-1", creditedCents: 20 }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const result = await flushUnsyncedScans();
    assert.deepEqual(result, { sent: 1, refused: 0, stillPending: 0 });

    const updatedUser = getUser()!;
    assert.equal(updatedUser.pendingCents, 20);
    assert.equal(updatedUser.scans[0].refundCents, 20);
    assert.equal(updatedUser.scans[0].pendingSync, undefined);

    const updatedHh = getHouseholds()[0];
    assert.equal(updatedHh.pendingValueCents, 20);
  });

  it("ensures PickupReminderHost releases its singleton lease in a finally block and sanitises subjects", () => {
    const reminderSrc = fs.readFileSync(
      path.join(process.cwd(), "src/GoodSort.Api/Services/PickupReminderService.cs"),
      "utf8"
    );
    assert.ok(reminderSrc.includes("NotificationService.SingleLineSubject(subject)"));
    assert.match(reminderSrc, /finally\s*\{\s*await SingletonLease\.Release\(db,\s*LeaseName,\s*ct:\s*stoppingToken\);/);
  });

  it("keeps app-version and SW_VERSION synchronised across layout and service worker", () => {
    const layout = fs.readFileSync(path.join(process.cwd(), "app/layout.tsx"), "utf8");
    const sw = fs.readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
    const layoutMatch = layout.match(/name="app-version"\s+content="(20261112-qa-pass\d+)"/);
    const swMatch = sw.match(/SW_VERSION\s*=\s*"(20261112-qa-pass\d+)"/);
    assert.ok(layoutMatch);
    assert.ok(swMatch);
    assert.equal(layoutMatch[1], swMatch[1]);
  });
});
