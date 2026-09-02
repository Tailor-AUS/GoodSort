import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every control a member can press says what it does.
 *
 * Found by driving production on a phone with the camera blocked. The scan
 * screen renders three controls and not one of them had an accessible name: the
 * green gallery button (a <label> wrapping a hidden file input), the white
 * capture button (a self-closing <button /> with no children at all), and the
 * close button. The status text says "tap the green button", which is exactly
 * as useful as it sounds to someone who cannot see it.
 *
 * That is the primary action of the whole product. Scanning is the growth loop.
 *
 * Nothing catches this: the JSX is valid, the icons render, the buttons work
 * for anyone looking at them, and the build is green. It is invisible unless
 * you either read the accessibility tree or try it without sight.
 *
 * The detector deliberately handles self-closing controls too. The first
 * version of this audit missed the capture button precisely because it looked
 * for `<button ...>text</button>` and that button has no children — the most
 * important control on the page was the one the check could not see.
 */

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** lucide-react icon components used across the app. */
const ICON = "(?:Camera|ImagePlus|X|Check|CheckCircle|ChevronLeft|ChevronRight|ChevronDown|ChevronUp|ArrowLeft|ArrowRight|Menu|Plus|Minus|Trash|Trash2|Settings|Share|Share2|Copy|Search|MapPin|Zap|Info|RefreshCw|Loader|Loader2|Bell|User|LogOut|Pencil|Edit|Download|Upload|QrCode|Scan)";

/**
 * Controls that are deliberately unnamed, with the reason. Empty for now — if
 * something genuinely needs no name, say why rather than widening the detector.
 */
const INTENTIONALLY_UNNAMED: Record<string, string> = {};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx$/.test(entry) && !entry.includes(".test.")) out.push(rel);
  }
  return out;
}

type Offender = { where: string; tag: string; snippet: string };

function unnamedControls(): Offender[] {
  const found: Offender[] = [];

  for (const rel of sourceFiles("app")) {
    const src = readFileSync(join(ROOT, rel), "utf8");

    for (const tag of ["button", "label"]) {
      // Self-closing first: <button ... />  — no children, so no text by
      // construction. This is the case the original audit missed.
      const selfClosing = new RegExp(`<${tag}\\b([^>]*?)/>`, "g");
      for (const m of src.matchAll(selfClosing)) {
        const attrs = m[1];
        if (/aria-label|aria-labelledby|title=/.test(attrs)) continue;
        const line = src.slice(0, m.index).split("\n").length;
        found.push({ where: `${rel.replace(/\\/g, "/")}:${line}`, tag, snippet: m[0].replace(/\s+/g, " ").slice(0, 90) });
      }

      // Then paired controls whose only content is an icon.
      const paired = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "g");
      for (const m of src.matchAll(paired)) {
        const [attrs, body] = [m[1], m[2]];
        if (/aria-label|aria-labelledby|title=/.test(attrs)) continue;
        if (!new RegExp(`<${ICON}\\b`).test(body)) continue;

        // Visible text left once tags are removed. A JSX expression counts as
        // text when it contains a string literal — `{open ? "Hide" : "Show"}`
        // renders a label just as much as bare text does. Stripping every
        // {...} wholesale was the first version of this, and it reported the
        // install button as unnamed when its label is a ternary. A detector
        // that cries wolf gets an allowlist entry and then gets ignored.
        const expressionsWithLiterals = [...body.matchAll(/\{[^{}]*\}/g)]
          .some((e) => /["'`][^"'`]+["'`]/.test(e[0]));
        if (expressionsWithLiterals) continue;

        const text = body
          .replace(/\{[^{}]*\}/g, "")
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (text) continue;

        const line = src.slice(0, m.index).split("\n").length;
        found.push({ where: `${rel.replace(/\\/g, "/")}:${line}`, tag, snippet: m[0].replace(/\s+/g, " ").slice(0, 90) });
      }
    }
  }
  return found.filter((f) => !(f.where in INTENTIONALLY_UNNAMED));
}

test("the detector finds controls at all, so it cannot pass by finding nothing", () => {
  // Every icon-only control is named now, so prove the scan actually runs
  // rather than silently matching zero files.
  const files = sourceFiles("app");
  assert.ok(files.length > 15, `Only walked ${files.length} tsx files — the extraction is broken, not the app.`);

  const anyControl = files.some((rel) => /<button\b/.test(readFileSync(join(ROOT, rel), "utf8")));
  assert.ok(anyControl, "Found no <button> anywhere — the detector is broken.");
});

test("every icon-only control has an accessible name", () => {
  const offenders = unnamedControls();

  assert.equal(
    offenders.length,
    0,
    "These controls show only an icon and have no accessible name, so a screen reader "
      + "announces them as an unlabelled button:\n  "
      + offenders.map((o) => `${o.where}  ${o.snippet}`).join("\n  ")
      + "\n\nAdd aria-label describing the ACTION (\"Close scanner\"), not the icon (\"X\").",
  );
});

test("the scan loop's own controls are named", () => {
  // Named explicitly because this is the product's primary action, and because
  // the status copy tells the member to "tap the green button" — which is only
  // meaningful if you can see it.
  const scan = readFileSync(join(ROOT, "app", "scan", "page.tsx"), "utf8");
  const scanner = readFileSync(join(ROOT, "app", "components", "shared", "scanner.tsx"), "utf8");

  assert.match(scan, /aria-label=\{cameraReady \?/, "the gallery/camera label needs a name that reflects its two states");
  assert.match(scan, /aria-label="Capture photo"/, "the capture button is the primary action and had no name at all");
  assert.match(scan, /aria-label="Close scanner"/);
  assert.ok(
    (scanner.match(/aria-label="Close scanner"/g) ?? []).length >= 2,
    "both close buttons in the shared scanner need names",
  );
});
