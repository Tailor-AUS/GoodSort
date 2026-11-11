import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function readRel(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

test("/bags renders distinct picked_up vs verified status and hides kerb controls once collected", () => {
  const bagsSrc = readRel("app/bags/page.tsx");
  assert.match(bagsSrc, /bag\.status === "picked_up"/);
  assert.match(bagsSrc, /Collected — in transit/);
  assert.match(bagsSrc, /Verified at depot/);
  assert.match(bagsSrc, /bag\.status !== "verified" && bag\.status !== "picked_up"/);
  assert.match(bagsSrc, /const updated = await updateBagStatus\(bagId, status\)/);
});

test("admin ABA & PayID exports check res.ok and revoke temporary Blob URLs", () => {
  const adminSrc = readRel("app/admin/page.tsx");
  const abaStart = adminSrc.indexOf("async function exportAba()");
  const payIdStart = adminSrc.indexOf("async function exportPayIdCsv()");
  const afterExports = adminSrc.indexOf("if (loading)", payIdStart);
  assert.ok(abaStart > 0 && payIdStart > abaStart && afterExports > payIdStart);

  const abaBody = adminSrc.slice(abaStart, payIdStart);
  const payIdBody = adminSrc.slice(payIdStart, afterExports);

  assert.match(abaBody, /if \(!res\.ok\)/);
  assert.match(abaBody, /URL\.revokeObjectURL\(url\)/);
  assert.match(payIdBody, /if \(!res\.ok\)/);
  assert.match(payIdBody, /URL\.revokeObjectURL\(url\)/);

  const pickupsSrc = readRel("app/admin/pickups/page.tsx");
  assert.match(pickupsSrc, /if \(!res\.ok\)/);

  const binsSrc = readRel("app/admin/bins/page.tsx");
  assert.match(binsSrc, /aria-label="Bin code"/);
  assert.match(binsSrc, /aria-label="Bin name"/);
  assert.match(binsSrc, /ariaLabel="Bin address"/);
});

test("AccountPanel deducts cashed-out balance immediately, caps single cashout at MaxSingleCashoutCents, and labels inputs", () => {
  const panelSrc = readRel("app/components/shared/account-panel.tsx");
  assert.match(panelSrc, /MAX_SINGLE_CASHOUT_CENTS\s*=\s*99_999_999/);
  assert.match(panelSrc, /Math\.min\(clearedCents,\s*MAX_SINGLE_CASHOUT_CENTS\)/);
  assert.match(panelSrc, /effectiveClearedCents\s*=\s*Math\.max\(0,\s*user\.clearedCents\s*-\s*cashedOutCents\)/);
  assert.match(panelSrc, /onCashedOut\?\.\(requestAmountCents\)/);
  assert.match(panelSrc, /htmlFor=\{`\$\{fieldId\}-payid-value`\}/);
  assert.match(panelSrc, /htmlFor=\{`\$\{fieldId\}-bsb`\}/);
  assert.match(panelSrc, /htmlFor=\{`\$\{fieldId\}-account`\}/);
  assert.match(panelSrc, /htmlFor=\{`\$\{fieldId\}-name`\}/);

  const sortSrc = readRel("app/sort/page.tsx");
  assert.match(sortSrc, /onRefresh=\{refreshData\}/);
});
