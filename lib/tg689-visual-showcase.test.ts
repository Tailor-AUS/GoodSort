import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
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

test("SortAnimation replaces retired wheelie-bin stick SVG with interactive 4-stage home-bag showcase", () => {
  const sortAnimSrc = readClean("app/components/shared/sort-animation.tsx");
  assert.doesNotMatch(sortAnimSrc, /sa-can-to-bin/);
  assert.doesNotMatch(sortAnimSrc, /viewBox="0 0 400 140"/);
  assert.match(sortAnimSrc, /\/images\/how-it-works-flow\.webp/);
  assert.match(sortAnimSrc, /\/images\/brisbane-kerbside-hero\.webp/);
  assert.match(sortAnimSrc, /prefers-reduced-motion:\s*reduce/);
  assert.match(sortAnimSrc, /role="tablist"/);
  assert.match(sortAnimSrc, /role="tabpanel"/);
  assert.match(sortAnimSrc, /col-start-1\s+row-start-1/);
  assert.match(sortAnimSrc, /media="\(min-width:\s*1024px\)"/);

  for (const rel of ["public/images/brisbane-kerbside-hero.webp", "public/images/how-it-works-flow.webp"]) {
    const abs = join(ROOT, rel);
    assert.ok(existsSync(abs), `Missing visual asset: ${rel}`);
    const kb = statSync(abs).size / 1024;
    assert.ok(kb > 20 && kb < 260, `Expected optimized WebP size (20–260 KB) for ${rel}, got ${kb.toFixed(1)} KB`);
  }
});

test("MarketingHome renders HeroKerbsideCard in hero and SortAnimation in How It Works with synced app-version", () => {
  const marketingSrc = readClean("app/components/marketing/marketing-home.tsx");
  assert.match(marketingSrc, /<HeroKerbsideCard\s+suburbName=\{suburbName\}\s*\/>/);
  assert.match(marketingSrc, /<SortAnimation\s*\/>/);

  const layoutSrc = readClean("app/layout.tsx");
  const swSrc = readClean("public/sw.js");
  const layoutVer = layoutSrc.match(/name="app-version"\s+content="([^"]+)"/)?.[1];
  const swVer = swSrc.match(/SW_VERSION\s*=\s*"([^"]+)"/)?.[1];
  assert.ok(layoutVer, "Expected app-version meta tag in app/layout.tsx");
  assert.equal(swVer, layoutVer);
});
