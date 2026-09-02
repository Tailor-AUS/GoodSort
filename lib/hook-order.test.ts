import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * No component declares a hook after it can already have returned.
 *
 * React identifies hooks by call order, so a component that returns early on
 * one render and reaches a `useState` below that return on another has run a
 * different number of hooks. React throws "Rendered fewer hooks than expected"
 * and the nearest error boundary blanks the screen.
 *
 * CashoutSection did exactly this. `const [showHint] = useState(false)` sat
 * below `if (success) return`, and `success` is set by a SUCCESSFUL cash-out —
 * so the crash landed on the one path where the server had already deducted the
 * member's cleared balance and written the payout row. The money moved and the
 * member got a blank page instead of "Cashout requested". Then, reasonably,
 * they would try again.
 *
 * `react-hooks/rules-of-hooks` is the tool for this, and it was not running:
 * this project has no ESLint config, no eslint dependency, no lint script, and
 * no lint step in CI. Until that changes, this stands in for the rule.
 *
 * Scope, learned by getting it wrong: only returns that end the RENDER count. A
 * `return () => { ... }` inside useEffect is a cleanup function and has nothing
 * to do with hook order — counting those reported address-autocomplete and
 * install-prompt, both of which are correct.
 */

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const HOOK = /\b(useState|useEffect|useMemo|useCallback|useRef|useReducer|useLayoutEffect)\s*[(<]/;
/** Components and custom hooks — the only things with hook-order rules. */
const FUNC = /^(?:export\s+)?function\s+([A-Z]\w*|use[A-Z]\w*)\s*\(/gm;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...tsxFiles(rel));
    else if (/\.tsx$/.test(entry) && !entry.includes(".test.")) out.push(rel);
  }
  return out;
}

/** Source with comments stripped — they quote the very patterns searched for. */
function code(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Offset of the first return that ends this component's render, or -1. */
function earlyReturn(body: string): number {
  const candidates = [...body.matchAll(/^ {2}(?:\} )?(if \([^\n]*\) \{|return\b)/gm)];
  for (const m of candidates) {
    const seg = body.slice(m.index!);

    if (m[1].startsWith("return")) {
      // `return () => ...` is a cleanup, not a render exit.
      if (/^ {2}return \(?\s*\)?\s*=>/.test(seg)) continue;
      return m.index!;
    }

    // An `if` at the component's own indent: does it return before it closes?
    const close = seg.slice(2).search(/^ {2}\}/m);
    const block = close >= 0 ? seg.slice(0, close + 2) : seg;
    const r = block.search(/^ {4}return\b/m);
    if (r >= 0 && !/^ {4}return \(?\s*\)?\s*=>/.test(block.slice(r))) return m.index! + r;
  }
  return -1;
}

function violations(): string[] {
  const found: string[] = [];
  for (const rel of tsxFiles("app")) {
    const src = code(rel);
    const starts = [...src.matchAll(FUNC)].map((m) => ({ at: m.index!, name: m[1] }));

    for (let i = 0; i < starts.length; i++) {
      const body = src.slice(starts[i].at, i + 1 < starts.length ? starts[i + 1].at : undefined);
      const ret = earlyReturn(body);
      if (ret < 0) continue;

      const after = body.slice(ret);
      const hook = after.match(HOOK);
      if (!hook) continue;

      const retLine = src.slice(0, starts[i].at + ret).split("\n").length;
      const hookLine = src.slice(0, starts[i].at + ret + after.indexOf(hook[0])).split("\n").length;
      found.push(
        `${rel.replace(/\\/g, "/")} ${starts[i].name}(): returns at line ${retLine}, `
          + `then calls ${hook[1]} at line ${hookLine}`,
      );
    }
  }
  return found;
}

test("the scan finds components at all", () => {
  // Zero violations and zero files scanned look identical in a pass.
  const files = tsxFiles("app");
  assert.ok(files.length > 15, `Only walked ${files.length} tsx files — the scan is broken, not the app.`);

  const withHooks = files.filter((f) => HOOK.test(code(f)));
  assert.ok(withHooks.length > 5, `Only ${withHooks.length} files appear to use hooks — the scan is broken.`);
});

test("no hook is declared after a component can return", () => {
  assert.deepEqual(
    violations(),
    [],
    "A hook below an early return means the two render paths run different numbers of hooks. "
      + "React throws \"Rendered fewer hooks than expected\" and the error boundary blanks the screen. "
      + "Move the hook up with the others, above every return.",
  );
});

test("a useEffect cleanup return is not mistaken for a render exit", () => {
  // The false-positive case. `return () => {...}` inside useEffect is a
  // cleanup; treating it as a render exit flagged two correct components.
  const cleanupOnly = [
    "app/components/shared/address-autocomplete.tsx",
    "app/components/shared/install-prompt.tsx",
  ];
  const flagged = violations();
  for (const f of cleanupOnly) {
    assert.ok(
      !flagged.some((v) => v.startsWith(f)),
      `${f} was flagged, but its returns are useEffect cleanups — the detector is over-reporting again.`,
    );
  }
});
