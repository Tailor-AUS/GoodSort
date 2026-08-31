import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every external host the client fetches must be listed in the CSP.
 *
 * This is a silent failure by construction, and it had already happened. The
 * container lookup's second tier fetched openfoodfacts.org directly, that host
 * was not in connect-src in staticwebapp.config.json, and CSP refused the
 * request. The call site caught the error and returned null, so the tier read
 * as implemented and returned nothing in production from the day it shipped —
 * no error, no failing build, nothing in a code review to notice.
 *
 * It only bites in production, too: `next dev` serves no CSP, so the same code
 * works locally. That is the worst shape a bug can have.
 */

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry);
    const full = join(ROOT, rel);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(entry) && !entry.includes(".test.")) out.push(rel);
  }
  return out;
}

/** Hosts passed as a literal first argument to fetch(). */
function fetchedHosts(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const rel of [...sourceFiles("lib"), ...sourceFiles("app")]) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    for (const m of text.matchAll(/fetch\(\s*[`"'](https:\/\/[^`"'/\s]+)/g)) {
      const host = m[1];
      found.set(host, [...(found.get(host) ?? []), rel]);
    }
  }
  return found;
}

function connectSrc(): string[] {
  const cfg = JSON.parse(readFileSync(join(ROOT, "staticwebapp.config.json"), "utf8"));
  const csp: string = cfg?.globalHeaders?.["Content-Security-Policy"] ?? "";
  const directive = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src"));
  return [...(directive ?? "").matchAll(/https:\/\/[^\s;]+/g)].map((m) => m[0]);
}

test("the CSP is actually readable, so this test cannot pass by finding nothing", () => {
  // If the config moves or the header is renamed, an empty allowlist would make
  // every check below vacuous rather than failing.
  const allowed = connectSrc();
  assert.ok(allowed.length >= 3, `connect-src parsed as ${allowed.length} hosts — the extraction is broken, not the CSP.`);
  assert.ok(allowed.some((h) => h.includes("azurecontainerapps.io")), "the API's own origin should be in connect-src");
});

test("every host the client fetches is allowed by the CSP", () => {
  const allowed = new Set(connectSrc());
  const offenders: string[] = [];

  for (const [host, files] of fetchedHosts()) {
    if (!allowed.has(host)) offenders.push(`${host}  (fetched from ${files.join(", ")})`);
  }

  assert.deepEqual(
    offenders,
    [],
    "These hosts are fetched by client code but missing from connect-src in " +
      "staticwebapp.config.json. CSP will refuse them in production, and a " +
      "catch around the fetch will make that look like an empty result:\n  " +
      offenders.join("\n  "),
  );
});

test("the scan path does not call a third party directly", () => {
  // Specifically pinned: the container lookup goes through our own API, which
  // can send a User-Agent (a browser cannot — it is a forbidden header name),
  // apply a timeout, and rate-limit an anonymous caller.
  const text = readFileSync(join(ROOT, "lib", "containers.ts"), "utf8");
  assert.ok(
    !/fetch\(\s*[`"']https:\/\//.test(text),
    "lib/containers.ts fetches an external host directly — route it through /api/ instead.",
  );
});
