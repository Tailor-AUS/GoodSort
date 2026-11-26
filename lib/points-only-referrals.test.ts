import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function walkTsx(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
    const full = path.join(dir, ent.name);
    return ent.isDirectory() ? walkTsx(full) : ent.name.endsWith(".tsx") ? [full] : [];
  });
}

test("no cash referral promises ($1 signup bonus or 1¢/can override) remain in app/**/*.tsx", () => {
  for (const file of walkTsx(path.join(ROOT, "app"))) {
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);
    assert.doesNotMatch(src, /\$1\s*(when|per|\/house|\+\s*1¢)|\$1\.00\s+pending\s+signup/i, `Cash $1 referral promise remained in ${rel}`);
    assert.doesNotMatch(src, /\b1¢\s*(\/can|\/container|bonus|neighbour|Referrals|street bonus)/i, `Cash 1¢ referral promise remained in ${rel}`);
    assert.doesNotMatch(src, /\+3\.68¢\s*(CRP\s*)?Margin/i, `Stale +3.68¢ margin remained in ${rel}`);
  }
});

test("terms and admin reflect points-only referrals and +6.68¢ CRP margin", () => {
  const terms = fs.readFileSync(path.join(ROOT, "app", "terms", "page.tsx"), "utf8");
  assert.match(terms, /non-cash Good Sort Points/i);
  assert.match(terms, /no cash signup bonus or per-container cash commission/i);

  const admin = fs.readFileSync(path.join(ROOT, "app", "admin", "page.tsx"), "utf8");
  assert.match(admin, /\+6\.68¢ CRP Margin/);
});
