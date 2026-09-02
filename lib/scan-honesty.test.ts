import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The scanner never tells a member a scan landed when it did not.
 *
 * Both credit paths used to. On the photo path, confirmBatch branched on
 * res.ok, and the else and the catch did the same thing — recompute the total
 * locally at the standard rate — then fell through to a common tail that called
 * onBatchComplete and closed the scanner. So an expired scan token, a spent
 * one, a 401, or a dropped signal at the kerb were all indistinguishable from
 * success. And unlike the barcode path there was deliberately no local write to
 * fall back on: the comment says not to add one, because a success would double
 * count. The scan simply vanished, with the photo and the token going out with
 * the closed scanner.
 *
 * On the barcode path, addScanApi correctly rolled the local write back when
 * the server refused — and the overlay went on announcing "+5c added to your
 * account", because `credited` keeps its default when creditedCents comes back
 * null. The store put the money back and the screen said it had arrived.
 *
 * Neither shows up in a build or a type check, and neither is visible in a
 * happy-path test. The symptom is a member whose balance does not move and who
 * has no idea why — and production has one household and zero scanned
 * containers.
 *
 * These are source assertions rather than rendered ones because the failure is
 * a control-flow shape: a path that must stop before the success tail.
 */

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/**
 * Source with comments removed.
 *
 * Not a nicety — this is the third time in this codebase that a source-scanning
 * check read its own explanation as evidence. The comments here quote the very
 * strings being searched for ("added to your account", "+5c"), and the comment
 * occurrence comes first in the file, so an unstripped search finds the prose
 * and concludes the code is wrong.
 */
function code(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const SCANNER = code(join("app", "components", "shared", "scanner.tsx"));

/** The body of a named function, up to the closing brace at its indent. */
function functionBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `Could not find ${signature} — if it was renamed, update this test rather than deleting it.`);
  const end = src.indexOf("\n  }", start);
  assert.ok(end > start, `Could not find the end of ${signature}.`);
  return src.slice(start, end);
}

test("a refused photo batch never reaches the success callback", () => {
  const body = functionBody(SCANNER, "async function confirmBatch()");

  // Check the two failure branches directly rather than counting
  // setConfirmError calls — the first of those is setConfirmError("") at the
  // top, resetting state for a fresh attempt, and treating it as a failure
  // branch made the first version of this test fail on correct code.
  const elseStart = body.indexOf("} else {");
  assert.ok(elseStart > 0, "confirmBatch should still branch on res.ok");

  // lastIndexOf, not indexOf: the refusal branch parses the server's error body
  // inside its own try/catch, so an inner `} catch {` sits between `} else {`
  // and the outer one. Taking the first match ended the else-block slice before
  // its own return statement, and this test failed on correct code.
  const catchStart = body.lastIndexOf("} catch {");
  assert.ok(catchStart > elseStart, "confirmBatch should still have a network catch");

  const elseBlock = body.slice(elseStart, catchStart);
  const catchBlock = body.slice(catchStart);
  const tailStart = catchBlock.indexOf("onBatchComplete(");

  assert.match(
    elseBlock,
    /return;/,
    "The server-refused branch falls through to onBatchComplete, so a refused scan is reported as credited.",
  );
  assert.match(
    catchBlock.slice(0, tailStart > 0 ? tailStart : undefined),
    /return;/,
    "The network-failure branch falls through to onBatchComplete, so a lost scan is reported as credited.",
  );
});

test("the photo failure path does not invent a total", () => {
  const body = functionBody(SCANNER, "async function confirmBatch()");

  // The old fallback recomputed totalCents from the eligible items at the
  // standard rate and presented it as the credit. Quoting a number the server
  // never agreed to is what made the false receipt convincing.
  const elseBranch = body.slice(body.indexOf("} else {"));
  assert.doesNotMatch(
    elseBranch.slice(0, elseBranch.indexOf("return;")),
    /totalCents\s*=\s*totalItems\s*\*/,
    "The refusal branch recomputes a credit locally. That number is fiction — the server refused.",
  );
});

test("a refused barcode scan is not announced as credit", () => {
  // addScanApi reports `refused` precisely so this branch can exist.
  assert.match(SCANNER, /refused = res\.refused/, "the scanner must read the refusal flag");
  assert.match(SCANNER, /setScanRefused\(/, "the overlay needs to know");

  // The success line must be behind the check, not unconditional. Searched in
  // comment-stripped source, because the comments quote this exact string.
  const creditLine = SCANNER.indexOf("added to your account");
  assert.ok(creditLine > 0, "the credit line should still exist for the success case");
  const guard = SCANNER.lastIndexOf("scanRefused ?", creditLine);
  assert.ok(
    guard > 0 && creditLine - guard < 500,
    "the credit line must sit inside the scanRefused branch, not run unconditionally",
  );
});

test("a refused barcode scan does not raise the parent's toast either", () => {
  const body = functionBody(SCANNER, "async function processBarcodeResult(");

  // onScanComplete is what shows "+5c added" on /sort after the overlay closes.
  // Calling it after a refusal repeats the false claim on the way out.
  assert.match(
    body,
    /if \(!refused\) onScanComplete\(/,
    "onScanComplete must be guarded by the refusal check, or the toast repeats the claim the overlay just withdrew.",
  );
});

test("the offline case is still allowed to keep its credit", () => {
  // The opposite mistake would be treating every failure as a refusal, which
  // would delete work done at a kerb with no signal — the whole reason writes
  // go local-first. A network catch must NOT set the refused state.
  const body = functionBody(SCANNER, "async function processBarcodeResult(");
  const catchBlock = body.slice(body.indexOf("} catch {"), body.indexOf("setScanRefused("));
  assert.doesNotMatch(catchBlock, /refused = true/, "an unreachable server is not a refusal");
});
