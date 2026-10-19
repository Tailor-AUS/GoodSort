import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PENDING_READINESS_CONFIG,
  normaliseReadiness,
  normaliseReadinessConfig,
  readinessCopy,
} from "./collection-readiness.ts";
import { inviteMessage } from "./brisbane.ts";
import { sanitiseApiBase } from "./config.ts";

const FORBIDDEN = [/\b1,?000\b/, /yellow/i, /night before/i, /\b12 (houses|households)\b/i, /we'll collect/i, /we drive/i];

function assertNoInventedPromise(text: string) {
  for (const re of FORBIDDEN) assert.doesNotMatch(text, re, `copy must not contain ${re}: ${text}`);
}

test("missing readiness from an older API is pending, never a threshold", () => {
  const r = normaliseReadiness(undefined, 7);
  assert.equal(r.status, "pending_operator_configuration");
  assert.equal(r.aluminiumThreshold, null);
  assert.equal(r.aluminiumNeeded, null);
  assert.equal(r.aluminiumContainers, 7);
});

test("accumulating without a threshold is incoherent and degrades to pending", () => {
  const r = normaliseReadiness({ status: "accumulating", aluminiumContainers: 3, aluminiumThreshold: null, aluminiumNeeded: 2 });
  assert.equal(r.status, "pending_operator_configuration");
  assert.equal(r.aluminiumThreshold, null);
});

test("unknown status degrades to pending", () => {
  assert.equal(normaliseReadiness({ status: "live" }).status, "pending_operator_configuration");
});

test("config without a positive integer threshold is pending", () => {
  assert.deepEqual(normaliseReadinessConfig({ configured: true, aluminiumThreshold: 0 }), PENDING_READINESS_CONFIG);
  assert.deepEqual(normaliseReadinessConfig({ configured: true, aluminiumThreshold: 0.4 }), PENDING_READINESS_CONFIG);
  assert.deepEqual(normaliseReadinessConfig(null), PENDING_READINESS_CONFIG);
});

test("readiness status normalises coherently against aluminium and threshold", () => {
  const reached = normaliseReadiness({
    status: "accumulating",
    aluminiumContainers: 5,
    aluminiumThreshold: 3,
    aluminiumNeeded: 0,
  });
  assert.equal(reached.status, "aluminium_volume_reached_awaiting_ops");
  assert.equal(reached.aluminiumNeeded, 0);

  const below = normaliseReadiness({
    status: "aluminium_volume_reached_awaiting_ops",
    aluminiumContainers: 1,
    aluminiumThreshold: 3,
    aluminiumNeeded: 0,
  });
  assert.equal(below.status, "accumulating");
  assert.equal(below.aluminiumNeeded, 2);
});

test("pending_material_reconciliation copy states reconciliation is required before counting remainder", () => {
  const cfg = normaliseReadinessConfig({ configured: true, aluminiumThreshold: 3, source: "operator_config" });
  const r = normaliseReadiness({
    status: "pending_material_reconciliation",
    aluminiumContainers: 0,
    aluminiumThreshold: 3,
    aluminiumNeeded: 3,
  });
  assert.equal(r.status, "pending_material_reconciliation");
  const c = readinessCopy(r, cfg, "Moorooka");
  assert.match(c.title, /pending material reconciliation/i);
  assert.match(c.body, /material breakdown/i);
  assert.equal(c.progressPct, null);
  assertNoInventedPromise(`${c.title} ${c.body}`);
});

test("pending copy names the pending configuration, shows the aluminium count, draws no bar", () => {
  const c = readinessCopy(normaliseReadiness({ status: "pending_operator_configuration", aluminiumContainers: 2 }), PENDING_READINESS_CONFIG, "Moorooka");
  assert.match(c.body, /2 aluminium cans scanned in Moorooka/);
  assert.match(c.body, /pending operator configuration/);
  assert.match(c.body, /no collection is scheduled/);
  assert.equal(c.progressPct, null);
  assert.equal(c.fixtureNote, null);
  assertNoInventedPromise(`${c.title} ${c.body}`);
});

test("accumulating copy uses only the configured threshold and labels a local fixture", () => {
  const cfg = normaliseReadinessConfig({ configured: true, aluminiumThreshold: 3, source: "local_fixture", fixtureLabel: "LOCAL TEST FIXTURE" });
  const c = readinessCopy(
    normaliseReadiness({ status: "accumulating", aluminiumContainers: 1, aluminiumThreshold: 3, aluminiumNeeded: 2 }),
    cfg,
    "Moorooka",
  );
  assert.match(c.body, /1\/3 aluminium cans/);
  assert.match(c.body, /2 more/);
  assert.match(c.body, /No collection is scheduled yet/);
  assert.equal(c.progressPct, 33);
  assert.match(c.fixtureNote ?? "", /LOCAL TEST FIXTURE/);
  assertNoInventedPromise(`${c.title} ${c.body}`);
});

test("reaching the volume is not a collection — ops still decide", () => {
  const cfg = normaliseReadinessConfig({ configured: true, aluminiumThreshold: 3, source: "operator_config" });
  const c = readinessCopy(
    normaliseReadiness({ status: "aluminium_volume_reached_awaiting_ops", aluminiumContainers: 3, aluminiumThreshold: 3, aluminiumNeeded: 0 }),
    cfg,
    "Moorooka",
  );
  assert.match(c.body, /nothing is scheduled until they confirm/);
  assert.equal(c.fixtureNote, null);
  assertNoInventedPromise(`${c.title} ${c.body}`);
});

test("inviteMessage never promises a 1000-container run across pending, building, configured, and committed states", () => {
  const url = "https://thegoodsort.org/brisbane/moorooka";
  const samples = [
    inviteMessage(url, "MOOROOKA"),
    inviteMessage(url, "MOOROOKA", { containers: 5, needed: 995, live: false }),
    inviteMessage(url, "MOOROOKA", { containers: 1000, needed: 0, live: true }),
    inviteMessage(url, "MOOROOKA", { aluminium: 2, aluminiumThreshold: null }),
    inviteMessage(url, "MOOROOKA", { aluminium: 1, aluminiumThreshold: 3 }),
    inviteMessage(url, "MOOROOKA", { aluminium: 3, aluminiumThreshold: 3 }),
    inviteMessage(url, "MOOROOKA", { committed: true, aluminium: 0 }),
  ];
  for (const s of samples) {
    assertNoInventedPromise(s);
  }
  assert.match(inviteMessage(url, "MOOROOKA", { aluminium: 1, aluminiumThreshold: 3 }), /1\/3 aluminium cans/);
  assert.match(inviteMessage(url, "MOOROOKA", { committed: true }), /Ops have committed/);
});

test("sanitiseApiBase allows only same-origin, localhost loopback, or https://api.aukus.si/v1", () => {
  assert.equal(sanitiseApiBase(undefined), "");
  assert.equal(sanitiseApiBase(""), "");
  assert.equal(sanitiseApiBase("http://localhost:5113/"), "http://localhost:5113");
  assert.equal(sanitiseApiBase("http://127.0.0.1:5113"), "http://127.0.0.1:5113");
  assert.equal(sanitiseApiBase("https://api.aukus.si/v1"), "https://api.aukus.si/v1");
  assert.equal(sanitiseApiBase("https://api.aukus.si/v1/goodsort/"), "https://api.aukus.si/v1/goodsort");
  assert.equal(sanitiseApiBase("https://api.tailor.au"), "");
  assert.equal(sanitiseApiBase("https://api.livelyfield-64227152.eastasia.azurecontainerapps.io"), "");
  assert.equal(sanitiseApiBase("https://evil.example.com/v1"), "");
});

