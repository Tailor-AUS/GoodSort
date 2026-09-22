import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * IndexNow compares the key in the POST body to the bytes of
 * https://thegoodsort.org/{key}.txt. A trailing newline — the kind a text
 * editor or `Write` adds without anyone noticing — makes that comparison fail
 * with 403 UserForbiddedToAccessSite, and the site stays out of Bing. The
 * file has to be the key and nothing else.
 */
const KEY = "goodsort2026indexnowkeye82a91b4";

test("the IndexNow key file is the key alone", () => {
  const bytes = readFileSync(new URL("../public/goodsort2026indexnowkeye82a91b4.txt", import.meta.url));
  const text = bytes.toString("utf8");
  assert.equal(text, KEY);
  assert.equal(bytes.length, KEY.length);
  assert.match(text, /^[A-Za-z0-9-]{8,128}$/);
});

test("the submit script posts that same key", () => {
  const script = readFileSync(new URL("../scripts/submit-indexnow.mjs", import.meta.url), "utf8");
  assert.match(script, new RegExp(KEY));
  assert.match(script, /guides\/containers-for-change-brisbane/);
  assert.doesNotMatch(script, /\/scan`/);
});
