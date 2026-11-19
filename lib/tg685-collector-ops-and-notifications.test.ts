import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function readClean(relPath: string): string {
  const raw = readFileSync(join(ROOT, relPath), "utf8");
  const clean = stripComments(raw);
  assert.ok(clean.trim().length > 0, `Expected non-empty code in ${relPath}`);
  return clean;
}

test("marketplace-api disables browser GET caching and RunActive flips Verify Bag immediately on scan", () => {
  const apiSrc = readClean("lib/marketplace-api.ts");
  assert.match(apiSrc, /cache:\s*"no-store"/);

  const runActiveSrc = readClean("app/(runner)/runner/components/run-active.tsx");
  assert.match(runActiveSrc, /setManifestBags\(\(prev\)\s*=>/);
  assert.match(runActiveSrc, /bag\.status\s*===\s*"picked_up"\s*\|\|\s*bag\.status\s*===\s*"verified"/);
});

test("admin waitlist and pickups expose self-serve pilot collection, run generation, and run claiming", () => {
  const waitlistSrc = readClean("app/admin/waitlist/page.tsx");
  assert.match(waitlistSrc, /\/api\/admin\/households\/\$\{h\.id\}\/bin-status/);
  assert.match(waitlistSrc, /\/api\/admin\/marketplace\/runs\/generate/);
  assert.match(waitlistSrc, /Enable collecting/);

  const pickupsSrc = readClean("app/admin/pickups/page.tsx");
  assert.match(pickupsSrc, /\/api\/admin\/marketplace\/runs\/generate/);
  assert.match(pickupsSrc, /claimRun\(runId\)/);
  assert.doesNotMatch(pickupsSrc, /·\s*divider/);
});

test("AccountPanel syncs loaded streetStats and householdMeta into InviteFriends", () => {
  const panelSrc = readClean("app/components/shared/account-panel.tsx");
  assert.match(panelSrc, /parentStats=\{streetStats\}/);
  assert.match(panelSrc, /parentMeta=\{householdMeta\}/);
  assert.match(panelSrc, /const containers = parentStats\?\.containers \?\? fallbackCluster\.containers;/);
});

test("SortedBagsPage suppresses 0-container flash while loading and InstallPrompt stays off /runner", () => {
  const bagsSrc = readClean("app/bags/page.tsx");
  assert.match(bagsSrc, /loading\s*\?\s*"Checking scanned containers…"/);

  const installSrc = readClean("app/components/shared/install-prompt.tsx");
  const match = installSrc.match(/const\s+INSTALL_PROMPT_PATHS\s*=\s*\[([^\]]+)\]/);
  assert.ok(match, "Expected INSTALL_PROMPT_PATHS declaration");
  assert.doesNotMatch(match[1], /"\/runner"/);
});

test("runner briefing email avoids double numbering and pickup confirmation uses home-bag copy", () => {
  const reminderCs = readClean("src/GoodSort.Api/Services/PickupReminderService.cs");
  assert.doesNotMatch(reminderCs, /<li>\{i\s*\+\s*1\}\./);
  assert.match(reminderCs, /var stopWord = run\.Stops\.Count == 1 \? "stop" : "stops";/);

  const notifCs = readClean("src/GoodSort.Api/Services/NotificationService.cs");
  assert.doesNotMatch(notifCs, /Bring bags back inside/i);
  assert.match(notifCs, /Keep scanning and sorting into fresh bags at home for your next pickup\./);
});

test("/flyer supports Moorooka, Annerley, and Tarragindi with scannable QR and app-version matches sw.js", () => {
  const flyerSrc = readClean("app/flyer/page.tsx");
  assert.match(flyerSrc, /slug:\s*"moorooka"/);
  assert.match(flyerSrc, /slug:\s*"annerley"/);
  assert.match(flyerSrc, /slug:\s*"tarragindi"/);
  assert.match(flyerSrc, /QRCode\.toDataURL/);
  assert.match(flyerSrc, /Earn 10¢ \/ Can/);

  const layoutSrc = readClean("app/layout.tsx");
  const swSrc = readClean("public/sw.js");
  assert.match(layoutSrc, /content="20261112-qa-pass21"/);
  assert.match(swSrc, /SW_VERSION\s*=\s*"20261112-qa-pass21"/);
});
