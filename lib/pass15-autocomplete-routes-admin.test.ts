import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

test("AddressAutocomplete syncs lastQueryRef on pick() and exposes WAI-ARIA combobox attributes", () => {
  const src = readFileSync(join(ROOT, "app", "components", "shared", "address-autocomplete.tsx"), "utf8");

  // Selecting an item must update lastQueryRef BEFORE calling onChange(sel.address)
  // so useEffect([value]) never pops the dropdown back open 250ms later over PayID/BSB fields.
  const pickMatch = src.match(/function pick\([\s\S]*?\n  \}/);
  assert.ok(pickMatch, "Expected function pick(...) in address-autocomplete.tsx");
  const pickBody = pickMatch[0];
  const syncIdx = pickBody.indexOf("lastQueryRef.current = sel.address.trim()");
  const onChangeIdx = pickBody.indexOf("onChange(sel.address)");
  assert.ok(syncIdx !== -1, "pick() must assign lastQueryRef.current = sel.address.trim()");
  assert.ok(onChangeIdx !== -1 && syncIdx < onChangeIdx, "lastQueryRef must be synced before onChange(sel.address)");

  // WAI-ARIA 1.2 combobox + listbox + option roles
  assert.match(src, /role="combobox"/);
  assert.match(src, /aria-expanded=\{isExpanded\}/);
  assert.match(src, /aria-autocomplete="list"/);
  assert.match(src, /role="listbox"/);
  assert.match(src, /role="option"/);
  assert.match(src, /aria-selected=\{i === highlight\}/);
});

test("lib/routes.ts settles an explicit 0-container stop at 0c instead of falling back to estimated containerCount", async () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => { mem.clear(); },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  Object.defineProperty(globalThis, "window", { value: { localStorage: storage }, configurable: true, writable: true });

  const store = await import("./store.ts");
  const routesMod = await import("./routes.ts");

  const driverId = "drv-pass15";
  store.saveUser({
    id: driverId,
    name: "Driver Pass15",
    householdId: "",
    role: "both",
    pendingCents: 0,
    clearedCents: 0,
    totalContainers: 0,
    totalCO2SavedKg: 0,
    scans: [],
    collections: [],
    badges: [],
    createdAt: new Date().toISOString(),
  });

  store.saveHouseholds([
    {
      id: "hh-zero",
      name: "Zero Kerb House",
      address: "12 Moorooka Rd, Moorooka QLD 4105",
      lat: -27.53,
      lng: 153.02,
      pendingContainers: 150,
      pendingValueCents: 1500,
      estimatedWeightKg: 2.25,
      estimatedBags: 2,
      materials: store.emptyMaterials(),
      lastScanAt: null,
      createdAt: new Date().toISOString(),
    },
  ]);

  store.saveRoutes([
    {
      id: "route-zero-test",
      status: "in_progress",
      driverId,
      claimedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: null,
      settledAt: null,
      depotId: "depot-1",
      stops: [
        {
          id: "stop-zero",
          householdId: "hh-zero",
          householdName: "Zero Kerb House",
          address: "12 Moorooka Rd, Moorooka QLD 4105",
          lat: -27.53,
          lng: 153.02,
          sequence: 1,
          containerCount: 150,
          estimatedBags: 2,
          materials: store.emptyMaterials(),
          status: "pending",
          pickedUpAt: null,
          actualContainerCount: null,
        },
      ],
      totalContainers: 150,
      totalWeightKg: 2.25,
      totalValueCents: 1500,
      driverPayoutCents: 0,
      estimatedDurationMin: 15,
      estimatedDistanceKm: 3.5,
      createdAt: new Date().toISOString(),
    },
  ]);

  const updated = routesMod.markStopPickedUp("route-zero-test", "stop-zero", 0);
  assert.ok(updated);
  assert.equal(updated.status, "at_depot");
  assert.equal(updated.stops[0].actualContainerCount, 0);

  const settled = routesMod.settleRoute("route-zero-test");
  assert.ok(settled);
  assert.equal(settled.householdPayouts.length, 1);
  assert.equal(settled.householdPayouts[0].containerCount, 0, "0-container pickup must NOT fall back to estimated 150");
  assert.equal(settled.householdPayouts[0].payoutCents, 0);
  assert.equal(settled.driverEarned, store.DRIVER_BASE_PAYOUT_CENTS);

  const hhAfter = store.getHouseholds().find((h) => h.id === "hh-zero")!;
  assert.equal(hhAfter.pendingContainers, 150, "Household pending count must remain intact when 0 containers were collected");
});

test("Admin /admin/users guards Null-Island/NaN bin coordinates and /admin/bins surfaces auth/API errors", () => {
  const usersSrc = readFileSync(join(ROOT, "app", "admin", "users", "page.tsx"), "utf8");
  assert.match(usersSrc, /!Number\.isFinite\(b\.lat\)\s*\|\|\s*!Number\.isFinite\(b\.lng\)\s*\|\|\s*\(!b\.lat\s*&&\s*!b\.lng\)/);
  assert.match(usersSrc, /!Number\.isFinite\(h\.lat\)\s*\|\|\s*!Number\.isFinite\(h\.lng\)\s*\|\|\s*\(!h\.lat\s*&&\s*!h\.lng\)/);

  const binsSrc = readFileSync(join(ROOT, "app", "admin", "bins", "page.tsx"), "utf8");
  assert.match(binsSrc, /Admin sign-in required to view and manage bins\./);
  assert.match(binsSrc, /body\.error/);
});
