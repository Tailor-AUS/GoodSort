import { test } from "node:test";
import assert from "node:assert/strict";

import { lookupLocal, lookupContainer, createUnknownContainer, toBagMaterial, classifyMaterialFromOFF, LOCAL_DB } from "./containers.ts";

/**
 * Finding a scanned container in the local table.
 *
 * A miss is not harmless. `lookupContainerAsync` falls through to
 * `createUnknownContainer`, which assumes aluminium — so a glass bottle that
 * fails to match is named "Unknown Container" and sent to the aluminium bag.
 * Wrong bag, wrong stream, rejected or downgraded at the depot.
 *
 * These are guards, not a regression test: measured against the current table
 * (46 AU 93x EAN-13s, none zero-prefixed) and the current caller (which already
 * strips non-digits), nothing misses in production today. They pin the lookup
 * for when the table gains an imported product, whose UPC-A form is the EAN-13
 * minus a leading zero.
 *
 * Both directions are falsifiable and were falsified. Removing the
 * normalisation fails the two "same product" tests; broadening it to strip
 * zeros anywhere fails the guard below.
 */

const KNOWN = "9300675024457";   // Coca-Cola 375ml, in LOCAL_DB

test("the plain barcode still resolves", () => {
  assert.equal(lookupLocal(KNOWN)?.name, "Coca-Cola 375ml");
  assert.equal(lookupContainer(KNOWN)?.name, "Coca-Cola 375ml");
});

test("a scanner's whitespace does not lose the product", () => {
  // Keyboard-wedge readers append a newline; pasted values carry spaces.
  assert.equal(lookupLocal(` ${KNOWN} `)?.name, "Coca-Cola 375ml");
  assert.equal(lookupLocal(`${KNOWN}\n`)?.name, "Coca-Cola 375ml");
  assert.equal(lookupLocal(`\t${KNOWN}`)?.name, "Coca-Cola 375ml");
});

test("the same product written as a wider GTIN still resolves", () => {
  // EAN-13 widened to GTIN-14 is a leading zero, and UPC-A widens to EAN-13 the
  // same way. Same product, different digits.
  assert.equal(lookupLocal(`0${KNOWN}`)?.name, "Coca-Cola 375ml");
  assert.equal(lookupLocal(`00${KNOWN}`)?.name, "Coca-Cola 375ml");
});

test("nothing resolves to the wrong product", () => {
  // The normalisation must not become a fuzzy match — stripping leading zeros
  // is safe, dropping digits anywhere else would collide products.
  assert.equal(lookupLocal(""), null);
  assert.equal(lookupLocal("   "), null);
  assert.equal(lookupLocal("abc"), null);
  assert.equal(lookupLocal("9999999999999"), null);
  // One digit different is a different product, not a near miss.
  assert.equal(lookupLocal("9300675024458")?.name ?? null, null);
  // A truncated barcode must not match its longer sibling.
  assert.equal(lookupLocal(KNOWN.slice(0, -1)), null);
  // Interior zeros are part of the number. Stripping zeros anywhere rather than
  // only at the front would collide these onto KNOWN, and no two entries in the
  // table collide that way today — so without these two the over-broad version
  // passes the whole suite. Verified: it did.
  assert.equal(lookupLocal("9367524457"), null);       // KNOWN with every zero removed
  assert.equal(lookupLocal("93000675024457"), null);   // KNOWN with one zero added inside
});

test("an unresolved barcode is answered, not thrown", () => {
  // A member is standing at a bin holding a container. They need a number.
  const c = createUnknownContainer("9999999999999");
  assert.equal(c.barcode, "9999999999999");
  assert.equal(c.confidence, "low");
  assert.ok(c.refund_cents > 0);
});

test("materials map onto the four bags with no gaps", () => {
  // The physical bin has four sections; anything the type allows has to land
  // in one of them.
  assert.equal(toBagMaterial("aluminium"), "aluminium");
  assert.equal(toBagMaterial("pet"), "pet");
  assert.equal(toBagMaterial("glass"), "glass");
  assert.equal(toBagMaterial("hdpe"), "other");
  assert.equal(toBagMaterial("liquid_paperboard"), "other");
});

/**
 * Every row in the table has to be a barcode a reader can actually produce.
 *
 * Nine of the original 48 were not. Eight had invalid EAN-13 check digits and
 * were visibly sequential fabrications (...200019, ...200026, ...200033), and
 * one was eleven digits, which is not a retail length. A reader cannot emit a
 * barcode whose check digit does not compute, so those rows were unreachable —
 * coverage on paper that no scan could ever hit. Real coverage was 39.
 *
 * This is worth a build-breaking test rather than a comment, because the
 * failure is invisible: a fabricated row looks exactly like a real one in the
 * diff, matches nothing at runtime, and produces no error. It just quietly
 * isn't there. And the cost of a miss is high — Open Food Facts has no record
 * for any Australian beverage barcode in this table (measured 2026-08-31,
 * 48/48 HTTP 404), so a miss goes straight to the aluminium guess.
 */

/** Standard GS1 modulo-10 check digit, for EAN-8, UPC-A and EAN-13. */
function checkDigitValid(barcode: string): boolean {
  const d = [...barcode].map(Number);
  const body = d.slice(0, -1);
  // Weights alternate 3,1,... from the RIGHT of the body, which is what makes
  // this work for all three lengths without special-casing each.
  const sum = body
    .reverse()
    .reduce((acc, digit, i) => acc + digit * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === d[d.length - 1];
}

test("the check digit helper agrees with known-good and known-bad barcodes", () => {
  // Pin the helper itself, so a broken helper cannot silently pass the table.
  assert.equal(checkDigitValid("9300675024457"), true, "real EAN-13");
  assert.equal(checkDigitValid("3017620422003"), true, "real EAN-13 (Nutella)");
  assert.equal(checkDigitValid("90162602"), true, "real EAN-8");
  assert.equal(checkDigitValid("9310015200019"), false, "fabricated, removed");
  assert.equal(checkDigitValid("9300675024458"), false, "last digit altered");
});

test("every table entry is a barcode a reader could produce", () => {
  assert.ok(LOCAL_DB.length > 0, "table is empty");
  for (const c of LOCAL_DB) {
    assert.ok(/^\d+$/.test(c.barcode), `${c.name}: barcode is not all digits`);
    assert.ok(
      [8, 12, 13].includes(c.barcode.length),
      `${c.name}: ${c.barcode} is ${c.barcode.length} digits — not EAN-8, UPC-A or EAN-13`,
    );
    assert.ok(
      checkDigitValid(c.barcode),
      `${c.name}: ${c.barcode} has an invalid check digit — no reader can emit this`,
    );
  }
});

test("no two entries share a barcode", () => {
  const seen = new Map();
  for (const c of LOCAL_DB) {
    assert.equal(seen.get(c.barcode), undefined, `${c.barcode} appears twice (${seen.get(c.barcode)} / ${c.name})`);
    seen.set(c.barcode, c.name);
  }
});

/**
 * Packaging tags from Open Food Facts decide which bag a member is told to use.
 *
 * These were unreachable until the lookup that feeds them started working — the
 * client fetched openfoodfacts.org directly, CSP refused it, and the failure
 * was swallowed — so the mapping had never actually run in production. Two
 * entries were wrong: HDPE and polypropylene both returned "pet".
 *
 * That is not a cosmetic mislabel. PET clear is the highest-value plastic
 * stream, so putting a milk or juice bottle in the PET bag downgrades the whole
 * load at the depot. The four-bag system already has an "other" section for
 * exactly these materials.
 */

const tagged = (...tags: string[]) => classifyMaterialFromOFF({ packaging_materials_tags: tags });

test("HDPE and polypropylene are not PET", () => {
  // The bug. Both used to return "pet".
  assert.equal(tagged("en:hdpe-2-high-density-polyethylene"), "hdpe");
  assert.equal(tagged("en:pp-5-polypropylene"), "hdpe");
  assert.equal(tagged("en:polypropylene"), "hdpe");
});

test("actual PET is still PET", () => {
  // The other direction, which an over-broad fix breaks.
  assert.equal(tagged("en:pet-1-polyethylene-terephthalate"), "pet");
  assert.equal(tagged("en:pet"), "pet");
});

test("the other materials still map where they did", () => {
  assert.equal(tagged("en:aluminium"), "aluminium");
  assert.equal(tagged("en:steel"), "aluminium");
  assert.equal(tagged("en:glass"), "glass");
  assert.equal(tagged("en:tetra-pak"), "liquid_paperboard");
  assert.equal(tagged("en:paperboard"), "liquid_paperboard");
});

test("what the member is actually told: the bag, not the material name", () => {
  // The mapping only matters through this. A wrong material is a wrong bag.
  assert.equal(toBagMaterial(tagged("en:hdpe-2-high-density-polyethylene")), "other");
  assert.equal(toBagMaterial(tagged("en:pp-5-polypropylene")), "other");
  assert.equal(toBagMaterial(tagged("en:pet-1-polyethylene-terephthalate")), "pet");
  assert.equal(toBagMaterial(tagged("en:aluminium")), "aluminium");
  assert.equal(toBagMaterial(tagged("en:glass")), "glass");
});
