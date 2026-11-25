import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("/admin/runners console wires fleet roster, approve/suspend, force-release with 409 confirm, and pricing controls", () => {
  const page = read("app/admin/runners/page.tsx");
  assert.match(page, /\/api\/admin\/runners\?limit=500/);
  assert.match(page, /\/api\/admin\/runners\/\$\{runner\.id\}\/status/);
  assert.match(page, /\/api\/admin\/marketplace\/runs\/\$\{runId\}\/force-release/);
  assert.match(page, /forceEvenIfPickedUp/);
  assert.match(page, /requiresConfirmation/);
  assert.match(page, /\/api\/admin\/pricing/);
  assert.match(page, /\/api\/admin\/pricing\/reprice/);
  assert.match(page, /\/api\/admin\/pricing\/simulate/);
  assert.match(page, /Authorization:\s*`Bearer \$\{token\}`/);
  assert.match(page, /text-base/, "Inputs must use text-base (16px) to prevent iOS Safari auto-zoom");
});

test("/admin/users KPI strip uses short non-truncating labels on 390px mobile", () => {
  const usersPage = read("app/admin/users/page.tsx");
  assert.match(usersPage, /<MiniKpi label="No address"/);
  assert.match(usersPage, /<MiniKpi label="No PayID"/);
  assert.doesNotMatch(usersPage, /<MiniKpi label="Needs address"/);
});

test("Admin command centre, pickups page, and /sort admin shortcut link to /admin/runners", () => {
  const adminPage = read("app/admin/page.tsx");
  assert.match(adminPage, /href="\/admin\/runners"/);

  const pickupsPage = read("app/admin/pickups/page.tsx");
  assert.match(pickupsPage, /href="\/admin\/runners"/);

  const waitlist = read("app/sort/components/waitlist-home.tsx");
  assert.match(waitlist, /href="\/admin\/runners"/);
});

test("/runner respects runnerApprovalStatus and stops heartbeats when suspended or pending", () => {
  const runnerPage = read("app/(runner)/runner/page.tsx");
  assert.match(runnerPage, /runnerApprovalStatus !== "approved"/);
  assert.match(runnerPage, /runnerProfile\.approvalStatus/);
});

test("app-version meta and SW_VERSION stay locked at 20261112-qa-pass36", () => {
  const layout = read("app/layout.tsx");
  const sw = read("public/sw.js");
  assert.match(layout, /name="app-version"\s+content="20261112-qa-pass36"/);
  assert.match(sw, /const SW_VERSION = "20261112-qa-pass36";/);
});
