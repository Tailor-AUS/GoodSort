import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function code(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("onboard continueFromPlace awaits lookupBinDayOnce before saving residential household", () => {
  const src = code(join("app", "(auth)", "onboard", "page.tsx"));
  const fnStart = src.indexOf("async function continueFromPlace()");
  assert.ok(fnStart >= 0, "continueFromPlace must exist in app/(auth)/onboard/page.tsx");
  const fnSlice = src.slice(fnStart, src.indexOf("\n  if (step ===", fnStart));
  assert.match(
    fnSlice,
    /await\s+lookupBinDayOnce\(/,
    "continueFromPlace must await lookupBinDayOnce so typed-and-geocoded addresses save their real council collection day instead of racing and defaulting to Sunday (0).",
  );
});

test("bin-out toggles on /sort and /household only flip state when the API accepts", () => {
  const sortSrc = code(join("app", "sort", "page.tsx"));
  const hhSrc = code(join("app", "household", "page.tsx"));
  assert.match(sortSrc, /if\s*\(\s*res\?\.ok\s*\)\s*setHousehold\(/, "/sort onBinOut must check res?.ok before flipping binIsOut");
  assert.match(hhSrc, /if\s*\(\s*res\.ok\s*\)\s*onChange\(next\)/, "/household BinOutToggle must check res.ok before flipping binIsOut");
});

test("Scanner.capturePhoto bounds frame dimensions and resets quotedCents on retake", () => {
  const scannerSrc = code(join("app", "components", "shared", "scanner.tsx"));
  assert.match(scannerSrc, /fitWithin\(video\.videoWidth,\s*video\.videoHeight\)/, "Scanner.capturePhoto must bound dimensions via fitWithin");
  assert.match(scannerSrc, /TARGET_BASE64_CHARS/, "Scanner.capturePhoto must step down quality against TARGET_BASE64_CHARS");
  const retakeStart = scannerSrc.indexOf("function retake()");
  assert.ok(retakeStart >= 0);
  const retakeSlice = scannerSrc.slice(retakeStart, scannerSrc.indexOf("\n  }", retakeStart));
  assert.match(retakeSlice, /setQuotedCents\(null\)/, "Scanner.retake must clear quotedCents so stale preview quotes never carry over");
});

test("AuthGuard permits /household so signed-out visitors see its onboarding prompt", () => {
  const guardSrc = code(join("app", "components", "shared", "auth-guard.tsx"));
  assert.match(guardSrc, /"\/household"/, "PUBLIC_PATH_PREFIXES must include /household");
});
