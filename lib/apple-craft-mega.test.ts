import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("Part A: iOS Safari & PWA sky-matched theme_color and adaptive bright glass CSS", () => {
  const layout = read("app/layout.tsx");
  const manifest = JSON.parse(read("public/manifest.json")) as {
    theme_color: string;
    background_color: string;
  };
  assert.match(layout, /themeColor:\s*"#226b91"/);
  assert.equal(manifest.theme_color, "#226b91");
  assert.equal(manifest.background_color, "#1c5878");

  const css = read("app/globals.css");
  assert.match(css, /\.liquid-glass-bright\s*\{/);
  assert.match(css, /\.animate-tab-in\s*\{/);
  assert.match(css, /\.animate-shutter-flash\s*\{/);
});

test("Part A: straggler cards (WaitlistCard, MemberStatusCard, InstallPrompt) use Liquid Glass and /bags defaults putOnKerb=false", () => {
  const waitlistCard = read("app/components/shared/waitlist-card.tsx");
  assert.match(waitlistCard, /liquid-glass/);
  assert.doesNotMatch(waitlistCard, /bg-violet-50/);

  const memberCard = read("app/sort/components/member-status-card.tsx");
  assert.match(memberCard, /liquid-glass/);
  assert.doesNotMatch(memberCard, /rounded-2xl bg-white p-4/);

  const installPrompt = read("app/components/shared/install-prompt.tsx");
  assert.match(installPrompt, /liquid-glass-light/);

  const bags = read("app/bags/page.tsx");
  assert.match(bags, /useState<boolean>\(false\)/, "/bags must default putOnKerb to false so kitchen tags do not trigger false kerb dispatches");
  assert.match(bags, /role="switch"/);

  const mkt = read("app/components/marketing/marketing-home.tsx");
  assert.match(mkt, /liquid-glass-bright/, "MarketingHome hero scan capsule must use bright milky glass for contrast over bright sky");
  assert.match(mkt, /bg-\[#f6f7f5\]/, "MarketingHome below-the-fold editorial canvas should use warm alabaster #f6f7f5");
});

test("Part A: /sort Home decluttered with dual progress, primary Scan capsule, real Guide & Pass sheets, scroll reset, and spring dock", () => {
  const home = read("app/sort/components/waitlist-home.tsx");
  assert.match(home, /FIRST_BAG_TARGET\s*=\s*50/);
  assert.match(home, /liquid-glass-bright/);
  assert.match(home, /showHelpSheet/);
  assert.match(home, /showPassSheet/);
  assert.match(home, /window\.scrollTo\(0,\s*0\)/);
  assert.match(home, /TAB_DOCK_INDEX/);
  assert.doesNotMatch(home, /Your suburb run/, "Duplicate Your suburb run photo card should stay removed from Home");
});

test("Part B: Apple Camera v2 wires hardware torch, haptics, rapid barcode batching, photo Bank+Next, session tray, and Liquid Glass results", () => {
  const scan = read("app/scan/page.tsx");
  assert.match(scan, /torchSupported/);
  assert.match(scan, /toggleTorch/);
  assert.match(scan, /applyConstraints/);
  assert.match(scan, /triggerHaptic/);
  assert.match(scan, /shutterFlash/);
  assert.match(scan, /sessionBatch/);
  assert.match(scan, /confirmAndScanNext/);
  assert.match(scan, /finishBatchSession/);
  assert.match(scan, /Bank \+\$\{displayCents\}c & scan next/);
  assert.match(scan, /liquid-glass-bright/);
  assert.doesNotMatch(scan, /className="fixed inset-0 bg-white flex flex-col z-50"/, "/scan results should use Liquid Glass instead of flat white");
});
