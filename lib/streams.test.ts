import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyToStream, STREAMS, getStreamById } from "./streams.ts";

/**
 * Which of the four bags a container is sent to.
 *
 * `classifyToStream` takes a material and a free-text description from the
 * vision model and picks a stream. It decides what a member is told to do with
 * a bottle in their hand, and the streams are not interchangeable: clear PET
 * and coloured PET go to different recyclers at different prices, so a
 * misclassification puts clear bottles in the lower-value bag and downgrades
 * the load at the depot.
 *
 * The whole thing was substring matching on the description, which is fine
 * until a word contains another word. `desc.includes("colour")` also matches
 * "colourless" — the exact opposite meaning — so a colourless bottle was sent
 * to COLOURED. Measured, not guessed: it returned pet_coloured before the fix
 * and pet_clear after.
 */

test("a colourless bottle is clear, not coloured", () => {
  // The bug. Both spellings, since the model may produce either.
  assert.equal(classifyToStream("pet", "colourless plastic bottle").key, "pet_clear");
  assert.equal(classifyToStream("pet", "colorless bottle").key, "pet_clear");
});

test("a coloured bottle is still coloured", () => {
  // The other direction, which a careless fix breaks — and mine did, briefly:
  // a mangled escape turned the pattern into something that matched nothing,
  // so every PET fell to clear. That is worse than the original bug, because
  // it is silent for coloured bottles too.
  assert.equal(classifyToStream("pet", "coloured bottle").key, "pet_coloured");
  assert.equal(classifyToStream("pet", "colored PET").key, "pet_coloured");
});

test("clear PET stays clear", () => {
  assert.equal(classifyToStream("pet", "clear PET bottle").key, "pet_clear");
  assert.equal(classifyToStream("pet", "plain water bottle").key, "pet_clear");
  assert.equal(classifyToStream("pet", "Mount Franklin 600ml").key, "pet_clear");
});

test("the colour words that should still route to coloured PET do", () => {
  for (const desc of ["green Sprite bottle", "Fanta orange bottle", "dark tinted bottle", "brown plastic bottle"]) {
    assert.equal(classifyToStream("pet", desc).key, "pet_coloured", desc);
  }
});

test("aluminium and steel go to their own streams", () => {
  assert.equal(classifyToStream("aluminium", "Coca-Cola can").key, "aluminium");
  assert.equal(classifyToStream("aluminum", "US spelling can").key, "aluminium");
  assert.equal(classifyToStream("steel", "steel can").key, "steel");
});

test("glass is split by colour, defaulting to clear", () => {
  assert.equal(classifyToStream("glass", "brown stubby").key, "glass_brown");
  assert.equal(classifyToStream("glass", "XXXX beer bottle").key, "glass_brown");
  assert.equal(classifyToStream("glass", "Heineken green bottle").key, "glass_green");
  assert.equal(classifyToStream("glass", "clear wine bottle").key, "glass_clear");
  // Default matters: an unrecognised glass bottle must land somewhere sane
  // rather than in the "other" bag.
  assert.equal(classifyToStream("glass", "unlabelled bottle").key, "glass_clear");
});

test("anything unrecognised lands in the other bag rather than throwing", () => {
  // A member is standing at a bin holding something. Whatever the model says,
  // they need an answer.
  for (const [mat, desc] of [["hdpe", "milk bottle"], ["carton", "juice box"], ["", ""], ["unobtainium", "???"]]) {
    const s = classifyToStream(mat, desc);
    assert.ok(s, `${mat} / ${desc} produced nothing`);
    assert.ok(s.key.length > 0);
  }
});

test("every stream is reachable and has what the UI renders", () => {
  // The bins are physical; a stream with no label or colour is a bag nobody
  // can identify.
  assert.equal(STREAMS.length, 8);
  for (const s of STREAMS) {
    assert.ok(s.key && s.label && s.shortLabel && s.hex, `stream ${s.id} incomplete`);
    assert.equal(getStreamById(s.id)?.key, s.key);
  }
  assert.equal(new Set(STREAMS.map((s) => s.key)).size, STREAMS.length, "stream keys must be unique");
});
