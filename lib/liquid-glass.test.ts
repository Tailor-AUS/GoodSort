import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("Apple iOS 26 Liquid Glass CSS system defines refractive classes with specular inset rims and backdrop fallbacks", () => {
  const css = read("app/globals.css");
  for (const cls of [
    ".liquid-glass {",
    ".liquid-glass-emerald {",
    ".liquid-glass-pill {",
    ".liquid-glass-dock {",
    ".liquid-glass-light {",
    ".liquid-glass-blue {",
    ".liquid-glass-teal {",
    ".liquid-glass-amber {",
    ".liquid-glass-green {",
  ]) {
    assert.ok(css.includes(cls), `Missing ${cls} in app/globals.css`);
  }
  assert.match(css, /backdrop-filter:\s*blur\(26px\)\s*saturate\(200%\)/);
  assert.match(css, /inset 0 1px 0\.5px rgba\(255, 255, 255, 0\.78\)/);
  assert.match(css, /@supports not/);
});

test("Brisbane golden-hour backdrop WebP exists and stays under 180 KB", () => {
  const asset = path.join(ROOT, "public", "images", "brisbane-veranda-glass.webp");
  assert.ok(fs.existsSync(asset), "Missing public/images/brisbane-veranda-glass.webp");
  const kb = fs.statSync(asset).size / 1024;
  assert.ok(kb > 20 && kb < 180, `Expected optimized WebP (20–180 KB), got ${kb.toFixed(1)} KB`);
});

test("Shared sunlit GlassBackdrop and Liquid Glass apply consistently across consumer screens", () => {
  const backdrop = read("app/components/shared/glass-backdrop.tsx");
  assert.match(backdrop, /\/images\/brisbane-veranda-glass\.webp/);
  assert.match(backdrop, /print:hidden/);

  const sort = read("app/sort/components/waitlist-home.tsx");
  assert.match(sort, /<GlassBackdrop\b/);
  assert.match(sort, /liquid-glass-dock/);
  assert.match(sort, /liquid-glass-emerald/);
  assert.match(sort, /GlassTileLink/);

  const home = read("app/components/marketing/marketing-home.tsx");
  assert.match(home, /\/images\/brisbane-veranda-glass\.webp/);
  assert.match(home, /<GlassBackdrop\b/);
  assert.match(home, /liquid-glass-pill/);
  assert.match(home, /heroSuburbs/);

  const market = read("app/marketplace/page.tsx");
  assert.match(market, /liquid-glass-light/);

  const bags = read("app/bags/page.tsx");
  assert.match(bags, /<GlassBackdrop\s+printHidden/);
  assert.match(bags, /liquid-glass-blue/);
  assert.match(bags, /liquid-glass-teal/);
  assert.match(bags, /liquid-glass-amber/);
  assert.match(bags, /liquid-glass-green/);

  for (const rel of [
    "app/sort/page.tsx",
    "app/invite/page.tsx",
    "app/household/page.tsx",
    "app/(auth)/login/page.tsx",
    "app/(auth)/verify/page.tsx",
    "app/(auth)/onboard/page.tsx",
    "app/(runner)/runner/signup/page.tsx",
    "app/(runner)/runner/page.tsx",
    "app/flyer/page.tsx",
    "app/brisbane/page.tsx",
    "app/scan/page.tsx",
    "app/terms/page.tsx",
    "app/privacy/page.tsx",
    "app/guides/containers-for-change-brisbane/page.tsx",
  ]) {
    const src = read(rel);
    assert.match(src, /<GlassBackdrop\b/, `Expected <GlassBackdrop /> in ${rel}`);
    assert.match(src, /liquid-glass/, `Expected Liquid Glass classes in ${rel}`);
  }
});
