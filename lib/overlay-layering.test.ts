import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Nothing incidental may cover something the member opened on purpose.
 *
 * The install prompt rendered at z-[60] while the scanner renders at z-50, both
 * as direct children of <body> with no intervening stacking context — AuthGuard
 * returns a bare fragment and the sort layout just returns children. So the
 * nag painted over the scanner.
 *
 * It is worse than a cosmetic overlap because of where and when. The prompt is
 * `fixed inset-x-0 bottom-0`, armed by a three-second timer, on exactly the
 * paths /sort, /runner and /household — and /sort is where a member taps
 * "Scan a container". The scanner's bottom controls are in that same band: the
 * white shutter button, and in barcode mode the "Enter barcode manually" field
 * and its Add button. Tapping the shutter fired "Install App" or "Later"
 * instead of taking the photo, and the only way out was to spot the small X on
 * the install card first.
 *
 * That is the first scan a member ever attempts, and production has zero of
 * them.
 *
 * Nothing catches this. Both components are correct in isolation, both render,
 * the build is green, and on a desktop browser with no install prompt showing
 * you would never see it.
 */

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** Full-screen things a member deliberately opens. Nothing may sit above these. */
const MODALS = [
  join("app", "components", "shared", "scanner.tsx"),
  join("app", "components", "shared", "account-panel.tsx"),
  join("app", "scan", "page.tsx"),
];

/** Incidental UI: nags and passive banners the member did not ask for. */
const INCIDENTAL = [join("app", "components", "shared", "install-prompt.tsx")];

/**
 * Every z-index literal in a file's CODE, as numbers. Handles z-50 and z-[60].
 *
 * Comments are stripped first, and that is not a nicety. The first version of
 * this read the prose too, so a comment in install-prompt.tsx explaining "at
 * z-[60] this sat above the scanner's z-50" was itself scored as a z-60 — the
 * test failed on the very file whose fix it was describing. A checker that
 * reads its own explanation as evidence is worse than no checker.
 */
function zIndexes(rel: string): number[] {
  const src = readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const out: number[] = [];
  for (const m of src.matchAll(/\bz-\[(\d+)\]/g)) out.push(Number(m[1]));
  for (const m of src.matchAll(/\bz-(\d+)\b/g)) out.push(Number(m[1]));
  return out;
}

test("the extraction finds z-indexes at all", () => {
  // Two empty sets compare equal, so prove the parse works before trusting a
  // comparison built on it.
  const modalZ = MODALS.flatMap(zIndexes);
  const nagZ = INCIDENTAL.flatMap(zIndexes);
  assert.ok(modalZ.length > 0, "found no z-index in the modal files — the parse is broken, not the app");
  assert.ok(nagZ.length > 0, "found no z-index in the install prompt — the parse is broken, not the app");
});

test("the install prompt sits below every modal", () => {
  const highestNag = Math.max(...INCIDENTAL.flatMap(zIndexes));

  for (const modal of MODALS) {
    // The modal's own layer is the HIGHEST z in its file. Taking the minimum
    // picks up some element nested inside the overlay instead — scanner.tsx
    // has a z-10 on content within it — which made the first version of this
    // test report the scanner as sitting at z-10 and fail on correct code.
    const modalLayer = Math.max(...zIndexes(modal));
    assert.ok(
      highestNag < modalLayer,
      `The install prompt renders at z-${highestNag}, at or above ${modal.replace(/\\/g, "/")} `
        + `(z-${modalLayer}). It is fixed to the bottom of the screen on /sort, which is exactly where the `
        + `scanner's shutter and manual-barcode entry live — so it intercepts the taps meant for them.`,
    );
  }
});

test("no new component quietly outranks the scanner", () => {
  // The scanner is the product's primary surface. If something new needs to go
  // above it, that should be a deliberate decision recorded here rather than a
  // number someone picked to win a layering argument.
  const scannerZ = Math.max(...zIndexes(join("app", "components", "shared", "scanner.tsx")));

  /** Allowed above the scanner, with the reason. */
  const ALLOWED_ABOVE: Record<string, string> = {
    "app/(runner)/runner/page.tsx": "A red error banner. An error must stay visible over anything.",
  };

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const rel = join(dir, entry);
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (/\.tsx$/.test(entry) && !entry.includes(".test.")) files.push(rel);
    }
  };
  walk("app");

  const offenders = files
    .filter((f) => {
      const key = f.replace(/\\/g, "/");
      if (key in ALLOWED_ABOVE) return false;
      if (key.endsWith("components/shared/scanner.tsx")) return false;
      const z = zIndexes(f);
      return z.length > 0 && Math.max(...z) > scannerZ;
    })
    .map((f) => `${f.replace(/\\/g, "/")} (z-${Math.max(...zIndexes(f))})`);

  assert.deepEqual(
    offenders,
    [],
    `These render above the scanner (z-${scannerZ}). If that is intended, add the file to ALLOWED_ABOVE `
      + `with the reason; otherwise it will cover the shutter button.`,
  );
});
