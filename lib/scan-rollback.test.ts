import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * `removeScan` must exactly reverse `addScan`.
 *
 * Scan writes are offline-first: the scan lands in localStorage before the API
 * is asked, so a member keeps scanning through a dead connection and syncs
 * later. That is right for a network failure and wrong for a refusal — over a
 * daily cap, past the rate limit, not signed in. Those never land, so the local
 * copy has to go back out or the member is shown credit and a container count
 * the server does not have.
 *
 * The risk in a rollback is doing it partially. Undoing the balance but not the
 * container count, or the member but not the household, leaves drift that no
 * later sync corrects — so these assert the round trip as a whole rather than
 * field by field.
 *
 * store.ts is browser code, so this stands up a minimal localStorage and window
 * before importing it.
 */

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  get length() { return this.map.size; }
}

const storage = new MemoryStorage();
(globalThis as Record<string, unknown>).localStorage = storage;
(globalThis as Record<string, unknown>).window = globalThis;

const { addScan, removeScan, saveUser, getUser, getHouseholds, saveHouseholds, SORTER_PAYOUT_CENTS } =
  await import("./store.ts");

const HOUSEHOLD_ID = "hh-1";

function seed() {
  storage.clear();
  saveUser({
    id: "user-1",
    name: "Test Member",
    householdId: HOUSEHOLD_ID,
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
  saveHouseholds([{
    id: HOUSEHOLD_ID,
    name: "Test House",
    address: "12 Test St, Moorooka",
    suburb: "MOOROOKA",
    lat: -27.53,
    lng: 153.02,
    binIsOut: false,
    binStatus: "waitlisted",
    pendingContainers: 0,
    pendingValueCents: 0,
    estimatedWeightKg: 0,
    estimatedBags: 0,
    materials: undefined,
    createdAt: new Date(0).toISOString(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any]);
}

/** Everything a scan is supposed to move, in one comparable shape. */
function snapshot() {
  const user = getUser()!;
  const household = getHouseholds().find((h) => h.id === HOUSEHOLD_ID)!;
  return {
    scans: user.scans.length,
    pendingCents: user.pendingCents,
    totalContainers: user.totalContainers,
    co2: Number(user.totalCO2SavedKg.toFixed(6)),
    hhContainers: household.pendingContainers,
    hhValueCents: household.pendingValueCents,
    hhBags: household.estimatedBags,
    hhAluminium: household.materials?.aluminium ?? 0,
  };
}

beforeEach(seed);

test("a scan followed by its rollback leaves no trace anywhere", () => {
  const before = snapshot();

  const user = addScan("9300675024235", "Coca-Cola 375ml Can", "aluminium");
  const scanId = user.scans[0].id;

  const during = snapshot();
  assert.equal(during.scans, 1);
  assert.equal(during.pendingCents, SORTER_PAYOUT_CENTS);
  assert.equal(during.hhContainers, 1);

  removeScan(scanId);

  // The whole state, not one field: a partial rollback is the failure mode.
  assert.deepEqual(snapshot(), before);
});

test("rolling back one scan of several leaves the others untouched", () => {
  addScan("111", "Can A", "aluminium");
  const second = addScan("222", "Can B", "pet");
  const secondId = second.scans[0].id;
  addScan("333", "Can C", "glass");

  removeScan(secondId);

  const after = snapshot();
  assert.equal(after.scans, 2);
  assert.equal(after.totalContainers, 2);
  assert.equal(after.pendingCents, SORTER_PAYOUT_CENTS * 2);
  assert.equal(after.hhContainers, 2);
  // Only the PET one went; the aluminium tally is untouched.
  assert.equal(after.hhAluminium, 1);

  const ids = getUser()!.scans.map((s) => s.id);
  assert.ok(!ids.includes(secondId));
});

test("rolling back an unknown scan changes nothing", () => {
  addScan("111", "Can A", "aluminium");
  const before = snapshot();

  assert.equal(removeScan("not-a-real-scan-id"), null);
  assert.deepEqual(snapshot(), before);
});

test("rolling the same scan back twice is a no-op, not a double subtraction", () => {
  // The shape of a retry. The second call finds no such scan and returns null
  // before touching anything, so the arithmetic never runs twice.
  const user = addScan("111", "Can A", "aluminium");
  const scanId = user.scans[0].id;

  removeScan(scanId);
  const afterFirst = snapshot();

  assert.equal(removeScan(scanId), null);
  assert.deepEqual(snapshot(), afterFirst);
});

test("a rollback clamps rather than going negative when stored totals are already out of step", () => {
  // What the Math.max clamps are actually for, which the retry case above does
  // NOT reach — the id guard returns first, so removing the clamps leaves that
  // test green. localStorage is client-side and editable, and a half-finished
  // write or a stale mirror can leave a balance lower than the scan it holds.
  // Undoing that must floor at zero, not hand the member a negative balance.
  const user = addScan("111", "Can A", "aluminium");
  const scanId = user.scans[0].id;

  const drifted = getUser()!;
  drifted.pendingCents = 0;
  drifted.totalContainers = 0;
  drifted.totalCO2SavedKg = 0;
  saveUser(drifted);

  const households = getHouseholds();
  const hh = households.find((h) => h.id === HOUSEHOLD_ID)!;
  hh.pendingContainers = 0;
  hh.pendingValueCents = 0;
  saveHouseholds(households);

  removeScan(scanId);

  const after = snapshot();
  assert.equal(after.pendingCents, 0);
  assert.equal(after.totalContainers, 0);
  assert.equal(after.hhContainers, 0);
  assert.equal(after.hhValueCents, 0);
});

// ── The behaviour the rollback exists for ────────────────────────────────────

const { addScanApi } = await import("./store-api.ts");

/** Stands in for the API, returning whatever status the test asks for. */
function stubFetch(status: number | "network-failure") {
  (globalThis as Record<string, unknown>).fetch = async () => {
    if (status === "network-failure") throw new Error("offline");
    if (status >= 400) {
      return new Response(JSON.stringify({ error: "no" }), { status });
    }
    return new Response(JSON.stringify({ creditedCents: 10, bonusRemaining: 19 }), { status });
  };
}

function signedIn() {
  storage.setItem("goodsort_profile", JSON.stringify({ id: "user-1", householdId: HOUSEHOLD_ID }));
  storage.setItem("goodsort_token", "test-token");
}

test("a scan the server refuses is rolled back, not left showing credit", async () => {
  // 429 is what the daily cap and the rate limit return. That scan is never
  // going to be accepted, so leaving the local copy shows a balance the server
  // does not have — the exact bug the rate limit would otherwise have created.
  seed();
  signedIn();
  const before = snapshot();

  stubFetch(429);
  const result = await addScanApi("111", "Can A", "aluminium");

  assert.equal(result.creditedCents, null);
  // `refused` is separate from a null credit deliberately. A credit is also
  // null when nobody is signed in, or when the response omitted the field, and
  // neither means the scan was rejected. The scanner branches on this to decide
  // whether to say "+5c added to your account", and inferring it from the null
  // is how a rolled-back scan still got announced as credit.
  assert.equal(result.refused, true);
  assert.deepEqual(snapshot(), before);
});

test("an unauthorised scan is rolled back too", async () => {
  seed();
  signedIn();
  const before = snapshot();

  stubFetch(401);
  const result = await addScanApi("111", "Can A", "aluminium");

  assert.equal(result.refused, true);
  assert.deepEqual(snapshot(), before);
});

test("a scan that only failed to reach the server keeps its local credit", async () => {
  // The offline case, and the whole reason writes go local-first. This one
  // must survive: the member is scanning in a garage with no signal and the
  // scan syncs later.
  seed();
  signedIn();

  stubFetch("network-failure");
  const result = await addScanApi("111", "Can A", "aluminium");

  // Not a refusal — so the scanner keeps showing the credit, correctly.
  assert.equal(result.refused, false);
  const after = snapshot();
  assert.equal(after.scans, 1);
  assert.equal(after.pendingCents, SORTER_PAYOUT_CENTS);
  assert.equal(after.hhContainers, 1);
});

test("a server error is treated as a failure to reach, not a refusal", async () => {
  // A 500 is our fault and may well succeed on retry, so the local write
  // stays. Only a 4xx is final.
  seed();
  signedIn();

  stubFetch(503);
  const result = await addScanApi("111", "Can A", "aluminium");

  assert.equal(result.refused, false, "a 5xx is not final, so it is not a refusal");
  assert.equal(snapshot().scans, 1);
});

test("an accepted scan keeps its local copy and reports the server's credit", async () => {
  seed();
  signedIn();

  stubFetch(200);
  const result = await addScanApi("111", "Can A", "aluminium");

  assert.equal(result.refused, false);
  assert.equal(result.creditedCents, 10);
  assert.equal(snapshot().scans, 1);
});
