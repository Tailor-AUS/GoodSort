import { test } from "node:test";
import assert from "node:assert/strict";

import { lookupLocal, lookupContainer, createUnknownContainer, toBagMaterial } from "./containers.ts";

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
