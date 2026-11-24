import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { looksLikeMultiUnitOrCommercialAddress } from "./syndicate-api.ts";

const ROOT = process.cwd();

test("looksLikeMultiUnitOrCommercialAddress detects commercial towers and residential multi-unit blocks without false-positiving houses", () => {
  assert.deepEqual(looksLikeMultiUnitOrCommercialAddress("Unit 12, 45 Ekibin Rd East, Annerley"), {
    detected: true,
    kind: "residential",
  });
  assert.deepEqual(looksLikeMultiUnitOrCommercialAddress("3/45 Ekibin Road East, Annerley"), {
    detected: true,
    kind: "residential",
  });
  assert.deepEqual(looksLikeMultiUnitOrCommercialAddress("Level 18/1 William St, Brisbane City"), {
    detected: true,
    kind: "commercial",
  });
  assert.deepEqual(looksLikeMultiUnitOrCommercialAddress("Suite 4, 100 Creek Street, Brisbane"), {
    detected: true,
    kind: "commercial",
  });
  assert.deepEqual(looksLikeMultiUnitOrCommercialAddress("67 Northview Outlook, Moorooka QLD 4105"), {
    detected: false,
    kind: "residential",
  });
});

test("BuildingSyndicatePanel enforces anonymous handles, explicit button types, and zero-PII copy", () => {
  const panel = fs.readFileSync(
    path.join(ROOT, "app", "sort", "components", "building-syndicate-panel.tsx"),
    "utf8",
  );
  assert.match(panel, /100% anonymous/);
  assert.match(panel, /Request to join anonymous syndicate/);
  assert.match(panel, /Request building collection/);
  assert.match(panel, /Official Syndicate/);

  const buttonTags = panel.match(/<button\b[^>]*>/g) ?? [];
  assert.ok(buttonTags.length >= 6, "expected interactive buttons in BuildingSyndicatePanel");
  for (const tag of buttonTags) {
    assert.match(tag, /\btype="(button|submit)"/, `button missing explicit type: ${tag}`);
  }
});

test("Admin Syndicates page handles 401/403, resets errors, declares button types, and is linked from /admin", () => {
  const adminPage = fs.readFileSync(path.join(ROOT, "app", "admin", "syndicates", "page.tsx"), "utf8");
  assert.match(adminPage, /r\.status === 401 \|\| r\.status === 403/);
  const errResets = adminPage.match(/setErr\(null\)/g) ?? [];
  assert.ok(errResets.length >= 3, "expected load and action handlers to clear stale errors");
  assert.match(adminPage, /Promote Official/);
  assert.match(adminPage, /Schedule Pickup/);

  const buttonTags = adminPage.match(/<button\b[^>]*>/g) ?? [];
  assert.ok(buttonTags.length >= 8);
  for (const tag of buttonTags) {
    assert.match(tag, /\btype="button"/, `admin syndicate button missing type="button": ${tag}`);
  }

  const adminHub = fs.readFileSync(path.join(ROOT, "app", "admin", "page.tsx"), "utf8");
  const links = adminHub.match(/href="\/admin\/syndicates"/g) ?? [];
  assert.equal(links.length, 1, "expected exactly one /admin/syndicates link on /admin dashboard");

  const home = fs.readFileSync(path.join(ROOT, "app", "sort", "components", "waitlist-home.tsx"), "utf8");
  assert.match(home, /BuildingSyndicatePanel/);
  assert.match(home, /fetchMySyndicate/);
});
