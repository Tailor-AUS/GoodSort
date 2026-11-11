import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalSuburb } from "./brisbane.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function code(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("admin/users passes Authorization headers and checks r.ok on /api/bins", () => {
  const src = code(join("app", "admin", "users", "page.tsx"));
  assert.match(
    src,
    /fetch\(apiUrl\("\/api\/bins"\),\s*\{\s*headers\s*\}\)\.then\(r\s*=>\s*r\.ok\s*\?\s*r\.json\(\)/,
    "AdminUsersPage must send { headers } and guard r.ok when calling /api/bins (.RequireAuthorization).",
  );
});

test("canonicalSuburb rejects municipality-wide Brisbane labels while keeping Brisbane City CBD", () => {
  for (const label of ["Brisbane", "City of Brisbane", "Brisbane City Council", "Greater Brisbane", "QLD", "Queensland", "Australia"]) {
    assert.equal(canonicalSuburb(label), null, `${label} must never form a suburb cluster`);
  }
  assert.equal(canonicalSuburb("Brisbane City"), "BRISBANE CITY");
  assert.equal(canonicalSuburb("Moorooka"), "MOOROOKA");
});

test("RunMarketplace empty state states 1,000 scanned containers across 3+ homes (not legacy 50+ bins)", () => {
  const src = code(join("app", "(runner)", "runner", "components", "run-marketplace.tsx"));
  assert.doesNotMatch(src, /50\+\s*containers/i);
  assert.match(src, /1,000 scanned containers across 3\+ homes/);
});

test("RunnerSignupPage binds accessible htmlFor/id labels and matches backend 100-bag / 200km limits", () => {
  const src = code(join("app", "(runner)", "runner", "signup", "page.tsx"));
  for (const id of [
    "runner-vehicle-type",
    "runner-vehicle-make",
    "runner-vehicle-rego",
    "runner-capacity-bags",
    "runner-service-radius",
    "runner-scheme-id",
  ]) {
    assert.match(src, new RegExp(`htmlFor="${id}"`), `Missing htmlFor="${id}"`);
    assert.match(src, new RegExp(`id="${id}"`), `Missing id="${id}"`);
  }
  assert.match(src, /id="runner-capacity-bags"[^>]*max=\{100\}/);
  assert.match(src, /id="runner-service-radius"[^>]*max=\{200\}/);
});

test("RunActive locks depotVerifiedInput and coexDocketRef when retrying settlement on a completed run", () => {
  const src = code(join("app", "(runner)", "runner", "components", "run-active.tsx"));
  assert.match(src, /const\s+isLockedCompleted\s*=\s*run\.status\s*===\s*"completed"/);
  assert.match(src, /id="depot-verified-count"[\s\S]*?disabled=\{isLockedCompleted\}/);
  assert.match(src, /id="depot-docket-ref"[\s\S]*?disabled=\{isLockedCompleted\}/);
});
