import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function readCode(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

describe("tg#680 — /sort council recycling-night suppression & desktop AccountPanel viewport bounds", () => {
  it("suppresses unconfirmed council recycling-night cards across /sort and /household", () => {
    const card = readCode("app/components/shared/collection-night-card.tsx");
    const waitlistHome = readCode("app/sort/components/waitlist-home.tsx");
    const householdPage = readCode("app/household/page.tsx");

    assert.match(
      card,
      /if\s*\(\s*!confirmed\s*\)\s*return\s+null/,
      "CollectionNightCard must return null when confirmed is false/undefined"
    );
    assert.doesNotMatch(card, /recycling night/i);
    assert.doesNotMatch(waitlistHome, /recycling night/i);
    assert.doesNotMatch(householdPage, /Set your council collection day/i);
  });

  it("keeps AccountPanel clipped strictly inside the inner viewport width and locks background scroll", () => {
    const panel = readCode("app/components/shared/account-panel.tsx");
    const globalsCss = readCode("app/globals.css");

    assert.match(
      panel,
      /fixed inset-0 z-50 flex justify-end overflow-hidden/,
      "AccountPanel must wrap backdrop + drawer in a full-viewport overflow-hidden flex container"
    );
    assert.match(
      panel,
      /w-\[calc\(100%-2\.5rem\)\]\s+max-w-\[22rem\]/,
      "AccountPanel drawer width must size against 100% of inset-0 rather than 100vw"
    );
    assert.doesNotMatch(
      panel,
      /\d+vw\b/,
      "AccountPanel must avoid vw units that exceed clientWidth when scrollbars are present"
    );
    assert.match(panel, /overflow-x-hidden/);
    assert.match(panel, /document\.body\.style\.overflow\s*=\s*"hidden"/);
    assert.match(globalsCss, /overflow-x:\s*clip/);
  });

  it("removes personal name placeholders across app/**/*.tsx", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir))) {
        const rel = path.join(dir, entry);
        if (fs.statSync(path.join(ROOT, rel)).isDirectory()) walk(rel);
        else if (entry.endsWith(".tsx")) files.push(rel);
      }
    };
    walk("app");
    assert.ok(files.length > 20, "expected to scan app/**/*.tsx files");
    for (const rel of files) {
      const code = readCode(rel);
      assert.doesNotMatch(code, /Knox Hart/i, `${rel} must not contain personal name Knox Hart`);
    }
  });
});
