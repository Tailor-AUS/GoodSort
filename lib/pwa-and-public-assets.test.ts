import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

test("PWA manifest advertises 10¢ domestic sorting credit and valid routes", () => {
  const raw = fs.readFileSync(path.join(repoRoot, "public", "manifest.json"), "utf8");
  const manifest = JSON.parse(raw) as {
    description: string;
    start_url: string;
    shortcuts: Array<{ description: string; url: string }>;
    icons: Array<{ src: string }>;
  };

  assert.match(manifest.description, /10¢/);
  assert.doesNotMatch(manifest.description, /\b5¢|5c\b/i);
  assert.equal(manifest.start_url, "/");
  assert.ok(manifest.icons.length >= 2);
  assert.ok(manifest.shortcuts.length >= 2);
  assert.match(manifest.shortcuts[0].description, /10¢/);
  assert.doesNotMatch(manifest.shortcuts[0].description, /\b5¢|5c\b/i);
});

test("home sorting sticker SVG has no stale 5c, yellow-lid, or night-before copy", () => {
  const svg = fs.readFileSync(path.join(repoRoot, "public", "bin-sticker-template.svg"), "utf8");
  assert.match(svg, /^<svg[\s>]/);
  assert.match(svg, /<\/svg>\s*$/);
  assert.match(svg, /10¢/);
  assert.doesNotMatch(svg, /\b5¢|5c\b/i);
  assert.doesNotMatch(svg, /night before council|yellow[- ]bin|purple-bin waitlist/i);
});

test("service worker ignores non-GET, cross-origin API/tile requests, and /sw.js", () => {
  const sw = fs.readFileSync(path.join(repoRoot, "public", "sw.js"), "utf8");
  assert.match(sw, /event\.request\.method\s*!==\s*"GET"/);
  assert.match(sw, /url\.origin\s*!==\s*self\.location\.origin/);
  assert.match(sw, /url\.pathname\s*===\s*"\/sw\.js"/);
});

test("Apple Liquid Glass icon suite is present and replaces legacy bin-lid and G-SORT marks", () => {
  const requiredAssets = [
    ["public", "images", "tgs-glass-icon.webp"],
    ["public", "images", "tgs-glass-icon.png"],
    ["public", "icon-192.png"],
    ["public", "icon-512.png"],
    ["public", "icon-512-maskable.png"],
    ["public", "apple-touch-icon.png"],
    ["public", "favicon-16x16.png"],
    ["public", "favicon-32x32.png"],
    ["app", "favicon.ico"],
  ];

  for (const parts of requiredAssets) {
    const filePath = path.join(repoRoot, ...parts);
    assert.ok(fs.existsSync(filePath), `Missing required icon asset: ${parts.join("/")}`);
    const bytes = fs.readFileSync(filePath);
    assert.ok(bytes.length > 500, `Icon asset looks empty/corrupt: ${parts.join("/")}`);
  }

  const logoSrc = fs.readFileSync(path.join(repoRoot, "app", "components", "shared", "logo.tsx"), "utf8");
  assert.match(logoSrc, /\/images\/tgs-glass-icon\.webp/);
  assert.doesNotMatch(logoSrc, /Purple lid|#7c3aed|#eab308/i);

  for (const svgName of ["favicon.svg", "icon.svg", "logo-icon.svg", "logo.svg", "logo-dark.svg"]) {
    const svg = fs.readFileSync(path.join(repoRoot, "public", svgName), "utf8");
    assert.match(svg, /^<svg[\s>]/);
    assert.doesNotMatch(svg, /#eab308|>SORT</i, `Legacy artwork remained in public/${svgName}`);
  }

  const manifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "public", "manifest.json"), "utf8"),
  ) as { icons: Array<{ src: string; purpose?: string }> };
  assert.ok(
    manifest.icons.some((i) => i.src === "/icon-512-maskable.png" && i.purpose === "maskable"),
    "manifest.json must wire /icon-512-maskable.png as maskable icon",
  );

  // MapLibre GL 6.x worker must be served from public/maplibre-gl-worker.js
  const workerPath = path.join(repoRoot, "public", "maplibre-gl-worker.js");
  assert.ok(fs.existsSync(workerPath), "Missing public/maplibre-gl-worker.js");
  assert.ok(fs.statSync(workerPath).size > 100_000, "public/maplibre-gl-worker.js looks truncated");
  for (const rel of ["app/components/shared/map-view.tsx", "app/admin/users/page.tsx"]) {
    const src = fs.readFileSync(path.join(repoRoot, rel), "utf8");
    assert.match(src, /setWorkerUrl\("\/maplibre-gl-worker\.js"\)/, `${rel} must pin setWorkerUrl("/maplibre-gl-worker.js")`);
  }
});
