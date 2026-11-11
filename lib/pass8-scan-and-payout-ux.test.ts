import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function readRel(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

test("standalone /scan live camera capture enforces fitWithin and QUALITY_LADDER image budget", () => {
  const scanSrc = readRel("app/scan/page.tsx");
  const captureStart = scanSrc.indexOf("async function capture()");
  const captureEnd = scanSrc.indexOf("function handleFileCapture", captureStart);
  assert.ok(captureStart > 0 && captureEnd > captureStart, "capture() function not found in app/scan/page.tsx");

  const captureBlock = scanSrc.slice(captureStart, captureEnd);
  assert.match(captureBlock, /fitWithin\(video\.videoWidth,\s*video\.videoHeight\)/);
  assert.match(captureBlock, /QUALITY_LADDER/);
  assert.match(captureBlock, /TARGET_BASE64_CHARS/);
  assert.doesNotMatch(captureBlock, /canvas\.width\s*=\s*video\.videoWidth/);
});

test("PostScanSetup commits saved household state before attempting payout save and recovers server householdId", () => {
  const src = readRel("app/components/shared/post-scan-setup.tsx");

  // Multi-device / stale-storage recovery via /api/profiles/me/payout
  assert.match(src, /payoutRes\.householdId/);

  // Inside handleSave, household persistence & UI lock must occur BEFORE `if (wantPayout)`
  const handleSaveStart = src.indexOf("async function handleSave()");
  assert.ok(handleSaveStart > 0, "handleSave() not found");
  const saveBody = src.slice(handleSaveStart);

  const wantAddressPersistIdx = saveBody.indexOf("setHasCompleteAddress(true)");
  const payoutPutIdx = saveBody.indexOf('fetch(apiUrl("/api/profiles/me/payout")');
  assert.ok(wantAddressPersistIdx > 0, "setHasCompleteAddress(true) missing in handleSave");
  assert.ok(payoutPutIdx > wantAddressPersistIdx, "Household state must lock green before PUT /api/profiles/me/payout");
});

test("readStoredProfile safely handles corrupt localStorage JSON without throwing", async () => {
  const { readStoredProfile } = await import("./config.ts");
  const prevWindow = (globalThis as Record<string, unknown>).window;
  const prevLocalStorage = (globalThis as Record<string, unknown>).localStorage;
  try {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).window = {};
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    };

    store.set("goodsort_profile", "{not-valid-json");
    assert.deepEqual(readStoredProfile(), {});

    store.set("goodsort_profile", JSON.stringify(["not", "an", "object"]));
    assert.deepEqual(readStoredProfile(), {});

    store.set("goodsort_profile", JSON.stringify({ id: "abc", householdId: "hh-1" }));
    assert.deepEqual(readStoredProfile(), { id: "abc", householdId: "hh-1" });
  } finally {
    if (prevWindow === undefined) delete (globalThis as Record<string, unknown>).window;
    else (globalThis as Record<string, unknown>).window = prevWindow;
    if (prevLocalStorage === undefined) delete (globalThis as Record<string, unknown>).localStorage;
    else (globalThis as Record<string, unknown>).localStorage = prevLocalStorage;
  }
});

test("payout, onboarding, and OTP form inputs expose accessible labels", () => {
  const postScan = readRel("app/components/shared/post-scan-setup.tsx");
  assert.match(postScan, /htmlFor=\{`\$\{fieldPrefix\}-payid`\}/);
  assert.match(postScan, /htmlFor=\{`\$\{fieldPrefix\}-bsb`\}/);
  assert.match(postScan, /htmlFor=\{`\$\{fieldPrefix\}-acct`\}/);
  assert.match(postScan, /htmlFor=\{`\$\{fieldPrefix\}-holder`\}/);
  assert.match(postScan, /htmlFor=\{`\$\{setupFieldPrefix\}-name`\}/);
  assert.match(postScan, /htmlFor=\{`\$\{setupFieldPrefix\}-address`\}/);

  const onboard = readRel("app/(auth)/onboard/page.tsx");
  assert.match(onboard, /htmlFor=\{`\$\{onboardFieldId\}-name`\}/);
  assert.match(onboard, /htmlFor=\{`\$\{onboardFieldId\}-address`\}/);

  const scan = readRel("app/scan/page.tsx");
  assert.match(scan, /aria-label="Email address"/);
  assert.match(scan, /aria-label="6-digit verification code"/);

  const verify = readRel("app/(auth)/verify/page.tsx");
  assert.match(verify, /aria-label="6-digit verification code"/);

  const marketing = readRel("app/components/marketing/marketing-home.tsx");
  assert.match(marketing, /aria-label="Email address"/);
  assert.match(marketing, /aria-label="6-digit verification code"/);
});

test("terms page Section 5 explicitly covers PayID alongside bank transfer (BSB / ABA)", () => {
  const terms = readRel("app/terms/page.tsx");
  assert.match(terms, /cashed out via PayID or bank transfer \(BSB and account number\)/);
});
