import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function readRel(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

test("DensityBoard bounds /api/growth/brisbane fetch with an 8s AbortController timeout and cleanup", () => {
  const src = readRel("app/components/marketing/density-board.tsx");
  assert.match(src, /new AbortController\(\)/);
  assert.match(src, /setTimeout\(\(\) => controller\.abort\(\), 8000\)/);
  assert.match(src, /signal: controller\.signal/);
});

test("SuburbFinder uses useId() rather than a static duplicate id attribute", () => {
  const src = readRel("app/components/marketing/suburb-finder.tsx");
  assert.match(src, /const inputId = useId\(\)/);
  assert.match(src, /htmlFor=\{inputId\}/);
  assert.match(src, /id=\{inputId\}/);
  assert.doesNotMatch(src, /id="suburb-finder"/);
});

test("StreetCard print button declares explicit type='button'", () => {
  const src = readRel("app/components/marketing/street-card.tsx");
  assert.match(src, /type="button"[\s\S]{0,60}window\.print\(\)/);
});
