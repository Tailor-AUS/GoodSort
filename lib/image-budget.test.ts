import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  fitWithin,
  base64Length,
  exceedsApiLimit,
  scanErrorMessage,
  MAX_BASE64_CHARS,
  TARGET_BASE64_CHARS,
  MAX_EDGE_PX,
  QUALITY_LADDER,
} from "./image-budget.ts";

/**
 * The gallery upload path, which could not work at all.
 *
 * /scan read the chosen file straight through FileReader and posted the raw
 * bytes, accepting anything up to 10 MB — while the API refuses a base64 body
 * over 2,000,000 characters, about 1.5 MB of image. A photo off any recent
 * phone is 2-5 MB, so the window where this worked was 0-1.5 MB: a screenshot,
 * or nothing.
 *
 * It matters more than a normal upload bug because it is the path the app tells
 * you to use. With the camera denied, the status line reads "tap the green
 * button to use your photo gallery" and that button becomes the big green
 * primary action. So the recommended recovery from a denied camera was the one
 * route guaranteed to fail.
 *
 * And it failed dishonestly: every non-ok response became "Could not reach the
 * server. Check your connection and try again." A 413 is not a connection
 * problem, and that advice produces an identical failure every time.
 */

test("a real phone photo is over the API limit before shrinking", () => {
  // The premise. If this ever stops being true the fix is unnecessary, and
  // this test should be the thing that says so.
  const twelveMegapixelJpeg = 3 * 1024 * 1024; // ~3 MB, unremarkable for a phone
  assert.ok(
    exceedsApiLimit(base64Length(twelveMegapixelJpeg)),
    "A 3 MB photo should exceed the API limit — that is why this module exists.",
  );

  // And a canvas re-encode at 1600px lands far under it.
  const shrunkJpeg = 400 * 1024;
  assert.ok(!exceedsApiLimit(base64Length(shrunkJpeg)));
});

test("base64 length accounts for the ~33% inflation", () => {
  assert.equal(base64Length(3), 4);
  assert.equal(base64Length(1), 4); // padded
  assert.equal(base64Length(0), 0);
  assert.equal(base64Length(-5), 0);
  // 1.5 MB of image is right at the ceiling, which is where the comment in
  // Program.cs puts it.
  assert.ok(base64Length(1_500_000) > MAX_BASE64_CHARS * 0.99);
});

test("the target leaves headroom under the hard ceiling", () => {
  // Aiming at the limit rather than below it means a photo that fits on one
  // phone fails on another, for reasons nobody can reproduce.
  assert.ok(TARGET_BASE64_CHARS < MAX_BASE64_CHARS);
  assert.ok(MAX_BASE64_CHARS - TARGET_BASE64_CHARS >= 200_000, "keep real headroom, not a token margin");
});

test("a large photo is scaled to fit, keeping its shape", () => {
  const portrait = fitWithin(3024, 4032);
  assert.equal(Math.max(portrait.width, portrait.height), MAX_EDGE_PX);
  assert.ok(Math.abs(portrait.width / portrait.height - 3024 / 4032) < 0.01, "aspect ratio must survive");

  const landscape = fitWithin(4032, 3024);
  assert.equal(Math.max(landscape.width, landscape.height), MAX_EDGE_PX);
});

test("a small photo is left alone rather than blown up", () => {
  // Upscaling adds bytes and no information.
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(MAX_EDGE_PX, 900).width, MAX_EDGE_PX);
});

test("extreme shapes still produce a drawable canvas", () => {
  // A panorama scaled hard could round an edge to zero, and a 0-width canvas
  // throws rather than degrading.
  const panorama = fitWithin(20000, 40);
  assert.ok(panorama.width > 0 && panorama.height > 0, "no zero edges");
  assert.equal(panorama.width, MAX_EDGE_PX);

  for (const bad of [[0, 100], [100, 0], [-5, 10], [NaN, 100]] as const) {
    const r = fitWithin(bad[0], bad[1]);
    assert.deepEqual(r, { width: 0, height: 0 }, `${bad} should be rejected, not guessed at`);
  }
});

test("the quality ladder actually descends", () => {
  // A ladder that does not go down cannot rescue an oversized photo.
  for (let i = 1; i < QUALITY_LADDER.length; i++) {
    assert.ok(QUALITY_LADDER[i] < QUALITY_LADDER[i - 1], "each step must be lower than the last");
  }
  assert.ok(QUALITY_LADDER[QUALITY_LADDER.length - 1] >= 0.3, "do not degrade past recognisable");
});

test("a too-large photo is not described as a connection problem", () => {
  // The whole point. "Check your connection and try again" sends the member to
  // repeat a request that fails identically every time.
  const tooLarge = scanErrorMessage(413);
  assert.match(tooLarge, /too large/i);
  assert.doesNotMatch(tooLarge, /connection/i);
  assert.match(tooLarge, /camera/i, "tell them what to do instead");
});

test("each failure the member can actually cause says something useful", () => {
  assert.match(scanErrorMessage(401), /sign in/i);
  assert.match(scanErrorMessage(403), /sign in/i);
  assert.match(scanErrorMessage(429), /wait/i);
  assert.match(scanErrorMessage(500), /our side/i);
  assert.match(scanErrorMessage(503), /our side/i);

  // A genuine network failure has no status, and only then is the connection
  // message the right one.
  assert.match(scanErrorMessage(null), /connection/i);
});

test("the client's idea of the API limit is the API's", () => {
  // MAX_BASE64_CHARS restates a number that lives in Program.cs. If the server
  // tightens its limit and this does not follow, the client goes back to
  // sending photos the server refuses — the exact bug, returned quietly.
  const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const program = readFileSync(join(ROOT, "src", "GoodSort.Api", "Program.cs"), "utf8");

  const m = program.match(/base64\.Length\s*>\s*([\d_]+)/);
  assert.ok(m, "Could not find the photo size guard in Program.cs - if it moved, update this test rather than deleting it.");

  const serverLimit = Number(m![1].replace(/_/g, ""));
  assert.equal(
    MAX_BASE64_CHARS,
    serverLimit,
    `The API refuses bodies over ${serverLimit} base64 chars but the client aims at ${MAX_BASE64_CHARS}.`,
  );
});
