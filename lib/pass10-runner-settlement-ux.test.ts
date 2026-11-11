import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readStoredProfileId } from "./config.ts";
import { SORTER_CREDIT_CENTS } from "./streams.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function readRel(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function makeFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

test("readStoredProfileId falls back to valid JWT sub when goodsort_profile is empty, and ignores expired JWTs", () => {
  const prevWindow = (globalThis as Record<string, unknown>).window;
  const prevStorage = (globalThis as Record<string, unknown>).localStorage;

  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };

  try {
    (globalThis as Record<string, unknown>).window = {};
    (globalThis as Record<string, unknown>).localStorage = mockStorage;

    const uid = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    store.set("goodsort_token", makeFakeJwt({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 }));
    assert.equal(readStoredProfileId(), uid);

    // Expired JWT must NOT return a profile id
    store.set("goodsort_token", makeFakeJwt({ sub: uid, exp: Math.floor(Date.now() / 1000) - 60 }));
    assert.equal(readStoredProfileId(), undefined);
  } finally {
    if (prevWindow === undefined) delete (globalThis as Record<string, unknown>).window;
    else (globalThis as Record<string, unknown>).window = prevWindow;
    if (prevStorage === undefined) delete (globalThis as Record<string, unknown>).localStorage;
    else (globalThis as Record<string, unknown>).localStorage = prevStorage;
  }
});

test("SORTER_CREDIT_CENTS matches the 10c home sorting credit rate", () => {
  assert.equal(SORTER_CREDIT_CENTS, 10);
});

test("RunActive supports up to 2,000 containers per stop, clamps depot verified count, and uses noopener", () => {
  const src = readRel("app/(runner)/runner/components/run-active.tsx");
  assert.match(src, /MAX_STOP_CONTAINERS\s*=\s*2000/);
  assert.match(src, /MAX_DEPOT_CONTAINERS\s*=\s*50_000/);
  assert.doesNotMatch(src, /max=\{200\}/);
  assert.match(src, /aria-label="Manual QR bag code"/);
  assert.match(src, /aria-label="Discrepancy note"/);
  assert.match(src, /window\.open\(url,\s*"_blank",\s*"noopener,noreferrer"\)/);
});

test("PhotoCapture downscales high-res verification images below the 2M-char API limit", () => {
  const src = readRel("app/(runner)/runner/components/photo-capture.tsx");
  assert.match(src, /MAX_CAPTURE_EDGE\s*=\s*1600/);
  assert.match(src, /TARGET_DATA_URL_CHARS\s*=\s*1_400_000/);
  assert.match(src, /aria-label="Capture pickup verification photo"/);
});

test("HouseholdPage loads live getUserApi stats, MarketingHome auto-continues multi-device sessions, and BinDayFinder labels input", () => {
  const hhSrc = readRel("app/household/page.tsx");
  assert.match(hhSrc, /getUserApi\(\)\.catch\(\(\) => null\)/);
  assert.match(hhSrc, /liveUser\?\.totalContainers/);

  const mktSrc = readRel("app/components/marketing/marketing-home.tsx");
  assert.match(mktSrc, /void waitlistContinuePath\(\)/);

  const binFinderSrc = readRel("app/components/marketing/bin-day-finder.tsx");
  assert.match(binFinderSrc, /ariaLabel=\{suburbName \?/);
});
