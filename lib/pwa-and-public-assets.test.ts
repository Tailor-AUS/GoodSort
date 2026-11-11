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
