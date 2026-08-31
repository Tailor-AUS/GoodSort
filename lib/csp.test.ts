import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every external host in client code is either allowed by the CSP or declared
 * here as something we never connect to.
 *
 * Worth keeping honest for a reason found the hard way: for the whole life of
 * this site the CSP was not being served at all. The config lived at the repo
 * root, the SWA workflow uploads `out/` with skip_app_build, and Next only
 * copies `public/` into `out/` — so staticwebapp.config.json never reached
 * production, and with it no CSP, no X-Frame-Options, no Referrer-Policy and no
 * Permissions-Policy. It lives in public/ now, and swa-config.test.ts keeps it
 * there.
 *
 * The first version of this test matched hosts written literally inside a
 * fetch() call. That was the shape of the bug, but not the shape of this
 * codebase: every real fetch here builds its URL in a variable first
 * (PHOTON_URL, MAP_STYLE_URL, apiUrl(...)), so once the openfoodfacts literal
 * was gone the check found nothing and passed vacuously.
 *
 * So it now works the way IntentionallyPublic does in the endpoint posture
 * tests: look at every external host, and make each one a decision someone
 * wrote down. A host that is genuinely never connected to goes in the list
 * below with the reason. That catches `const X = "https://…"; fetch(X)`, which
 * the literal-only version could not.
 */

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/**
 * External hosts that appear in client code but are never fetched, so
 * connect-src is not the directive that governs them.
 */
const NOT_CONNECTED_TO: Record<string, string> = {
  "https://www.google.com": "Maps directions, opened as navigation from the runner screen — not fetched.",
  "https://data.brisbane.qld.gov.au": "Cited as the source of the bin-day dataset. A link and a comment; the data is baked into brisbane-suburbs.ts.",
  "https://schema.org": "JSON-LD vocabulary in the SEO structured data. An identifier, never dereferenced.",
  "https://thegoodsort.org": "Our own public origin — canonical URLs and invite links.",
  "https://tailor.au": "Attribution link in the footer.",
  "https://wa.me": "WhatsApp share link, opened as navigation.",
  "https://fonts.googleapis.com": "Stylesheet, governed by style-src (which does list it), not connect-src.",
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(tsx?|css)$/.test(entry) && !entry.includes(".test.")) out.push(rel);
  }
  return out;
}

/** Every https:// host written anywhere in client source, with where it came from. */
function externalHosts(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const rel of [...sourceFiles("lib"), ...sourceFiles("app")]) {
    for (const m of readFileSync(join(ROOT, rel), "utf8").matchAll(/https:\/\/[a-zA-Z0-9.-]+\.[a-z]{2,}/g)) {
      found.set(m[0], [...new Set([...(found.get(m[0]) ?? []), rel])]);
    }
  }
  return found;
}

function connectSrc(): string[] {
  const cfg = JSON.parse(readFileSync(join(ROOT, "public", "staticwebapp.config.json"), "utf8"));
  const csp: string = cfg?.globalHeaders?.["Content-Security-Policy"] ?? "";
  const directive = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src"));
  return [...(directive ?? "").matchAll(/https:\/\/[^\s;]+/g)].map((m) => m[0]);
}

test("the CSP parses, so nothing below can pass by finding nothing", () => {
  const allowed = connectSrc();
  assert.ok(allowed.length >= 3, `connect-src parsed as ${allowed.length} hosts — the extraction is broken, not the CSP.`);
  assert.ok(allowed.some((h) => h.includes("azurecontainerapps.io")), "the API's own origin should be in connect-src");
});

test("the scan finds the hosts that are actually there", () => {
  // The counterpart guard: if this found nothing, every check below would pass
  // while testing nothing. That is how the first version of this file broke.
  const hosts = externalHosts();
  assert.ok(hosts.size >= 5, `only found ${hosts.size} external hosts in client source — the scan is broken, not the code.`);
  assert.ok([...hosts.keys()].includes("https://photon.komoot.io"), "the geocoder host should have been found");
});

test("every external host is either allowed by the CSP or declared unconnected", () => {
  const allowed = new Set(connectSrc());
  const undeclared: string[] = [];

  for (const [host, files] of externalHosts()) {
    if (allowed.has(host)) continue;
    if (host in NOT_CONNECTED_TO) continue;
    undeclared.push(`${host}  (in ${files.join(", ")})`);
  }

  assert.deepEqual(
    undeclared,
    [],
    "These hosts appear in client code but are neither in connect-src nor declared as never-fetched.\n" +
      "If the client connects to it, add it to connect-src in staticwebapp.config.json — CSP will\n" +
      "refuse it in production and a catch around the fetch will make that look like an empty result.\n" +
      "If it is a link or a citation, add it to NOT_CONNECTED_TO with the reason:\n  " +
      undeclared.join("\n  "),
  );
});

test("the unconnected list does not outlive the hosts it describes", () => {
  // A stale entry silently pre-approves a future host that reuses the name —
  // the same failure the endpoint posture tests guard against.
  const hosts = new Set(externalHosts().keys());
  const stale = Object.keys(NOT_CONNECTED_TO).filter((h) => !hosts.has(h)).sort();
  assert.deepEqual(stale, [], "NOT_CONNECTED_TO names hosts no longer in the source:\n  " + stale.join("\n  "));
});

test("the scan path does not call a third party directly", () => {
  // Pinned specifically: the container lookup goes through our own API, which
  // can send a User-Agent (a browser cannot — forbidden header name), apply a
  // timeout, cache, and rate-limit an anonymous caller.
  const text = readFileSync(join(ROOT, "lib", "containers.ts"), "utf8");
  assert.ok(
    !/fetch\(\s*[`"']https:\/\//.test(text),
    "lib/containers.ts fetches an external host directly — route it through /api/ instead.",
  );
});
