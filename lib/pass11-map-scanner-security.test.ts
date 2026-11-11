import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function readRel(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

test("MapView escapes dynamic SVG text before assigning marker innerHTML", () => {
  const src = readRel("app/components/shared/map-view.tsx");
  assert.match(src, /export function escapeSvgText\(value: string\): string/);
  assert.match(src, /const safeCode = escapeSvgText\(bin\.code\)/);
  assert.match(src, /const safeLabel = escapeSvgText\(c\.label\)/);
  assert.doesNotMatch(src, /\$\{bin\.code\}/);
  assert.doesNotMatch(src, /\$\{c\.label\}/);
});

test("Scanner cleans up ZXing controls on stopCamera, recovers JWT sub userId, and labels manual barcode input", () => {
  const src = readRel("app/components/shared/scanner.tsx");
  assert.match(src, /zxingControlsRef\.current\.stop\(\)/);
  assert.match(src, /cameraSessionRef\.current/);
  assert.match(src, /return readStoredProfileId\(\) \?\? ""/);
  assert.match(src, /aria-label="Manual barcode number"/);
});

test("marketplace-api getStoredUserId falls back to readStoredProfileId for multi-device runners", () => {
  const src = readRel("lib/marketplace-api.ts");
  assert.match(src, /import \{ apiUrl, readStoredProfileId \} from "\.\/config\.ts"/);
  assert.match(src, /return readStoredProfileId\(\) \?\? null/);
});

test("containers.ts local DB and unknown container fallback align with 10c domestic sorting credit", async () => {
  const { LOCAL_DB, createUnknownContainer } = await import("./containers.ts");
  assert.ok(LOCAL_DB.length > 0);
  for (const c of LOCAL_DB) {
    assert.equal(c.refund_cents, 10, `${c.name} should carry 10c sorting credit`);
  }
  assert.equal(createUnknownContainer("9999999999999").refund_cents, 10);
});
