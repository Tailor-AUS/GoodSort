import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

test("AccountPanel handles 401 session expiry across payout, cashout, and account deletion and declares button types", () => {
  const src = readFileSync(path.join(ROOT, "app/components/shared/account-panel.tsx"), "utf8");

  // Every <button in AccountPanel must carry an explicit type="button"
  const buttonTags = src.match(/<button\b[^>]*>/g) ?? [];
  assert.ok(buttonTags.length >= 10, "expected at least 10 buttons in account-panel.tsx");
  for (const tag of buttonTags) {
    assert.match(tag, /\btype="button"/, `button missing explicit type="button": ${tag}`);
  }

  // Client-side PayID/BSB validation runs before cashout requests
  const cashoutIdx = src.indexOf("async function handleCashout()");
  assert.ok(cashoutIdx > 0);
  const cashoutSlice = src.slice(cashoutIdx, cashoutIdx + 2600);
  assert.match(cashoutSlice, /validateClientPayout\(\{/);

  // 401 clears stored auth on payout PUT, PayID cashout, ABA cashout, and DELETE /api/profiles/{id}
  const fourOhOnes = src.match(/res\.status === 401/g) ?? [];
  assert.ok(fourOhOnes.length >= 4, `expected >= 4 explicit 401 handlers in AccountPanel, got ${fourOhOnes.length}`);
});

test("Admin pages clear stale error banners and surface clear 401/403 status messages", () => {
  const pickups = readFileSync(path.join(ROOT, "app/admin/pickups/page.tsx"), "utf8");
  assert.match(pickups, /r\.status === 401 \|\| r\.status === 403/);
  assert.match(pickups, /DAY_NAMES\[data\.tomorrowDayOfWeek\] \?\? "Unknown"/);
  assert.doesNotMatch(pickups, /setTriggerResult\("Failed\."\)/);

  const waitlist = readFileSync(path.join(ROOT, "app/admin/waitlist/page.tsx"), "utf8");
  const errResets = waitlist.match(/setErr\(null\)/g) ?? [];
  assert.ok(errResets.length >= 3, "reload, allocate, and advance should clear stale error banners");

  const invite = readFileSync(path.join(ROOT, "app/invite/page.tsx"), "utf8");
  assert.match(invite, /meRes\?\.status === 401/);
  assert.match(invite, /hhRes\.status === 401/);
  assert.match(invite, /clearAuth\(\)/);
});

test("SEO metadata, structured data, and legal pages preserve 10¢ credit honesty and ABN 13 688 827 572", () => {
  const seo = readFileSync(path.join(ROOT, "app/seo.ts"), "utf8");
  assert.match(seo, /Earn 10¢ sorting credit each/);

  const suburbPage = readFileSync(path.join(ROOT, "app/brisbane/[suburb]/page.tsx"), "utf8");
  assert.match(suburbPage, /"@type": "Service"/);
  assert.match(suburbPage, /Earn 10¢ each/);

  const guide = readFileSync(path.join(ROOT, "app/guides/containers-for-change-brisbane/page.tsx"), "utf8");
  assert.match(guide, /"@type": "FAQPage"/);
  assert.match(guide, /not a Containers for Change refund point/i);
  assert.doesNotMatch(guide, /Earn 5¢|5¢ sorting credit/i);

  const privacy = readFileSync(path.join(ROOT, "app/privacy/page.tsx"), "utf8");
  assert.match(privacy, /ABN 13 688 827 572/);
  assert.doesNotMatch(privacy, /61 674 493 498/);
  assert.match(privacy, /East Asia/);

  const terms = readFileSync(path.join(ROOT, "app/terms/page.tsx"), "utf8");
  assert.doesNotMatch(terms, /61 674 493 498/);
  assert.doesNotMatch(terms, /12 houses|12 households|yellow-lid/i);
});
