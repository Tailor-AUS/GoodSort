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


/** One directive's token list, e.g. worker-src -> ["'self'", "blob:"]. */
function directive(name: string): string[] {
  const cfg = JSON.parse(readFileSync(join(ROOT, "public", "staticwebapp.config.json"), "utf8"));
  const csp: string = cfg?.globalHeaders?.["Content-Security-Policy"] ?? "";
  const found = csp.split(";").map((d) => d.trim()).find((d) => d === name || d.startsWith(name + " "));
  return found ? found.slice(name.length).trim().split(/\s+/).filter(Boolean) : [];
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

/**
 * The other eight directives.
 *
 * Everything above this point reads connect-src and nothing else, which left
 * nine directives unguarded — including the ones the map and the scanner
 * actually depend on. Deleting `blob:` from worker-src would leave the whole
 * suite green while breaking MapLibre on every screen that renders a map,
 * because MapLibre builds its workers from blob URLs.
 *
 * That mattered more than usual after the config went live: every one of these
 * tokens went from decorative to enforced on the same deploy, and I verified
 * the load-bearing ones against production by hand at the time. A test is the
 * only reason that stays verified.
 *
 * Each entry says what the token is for and what a member would see without it,
 * because "why is this here" is exactly what gets lost when someone tightens a
 * policy later.
 */
const REQUIRED_TOKENS: [string, string, string][] = [
  ["worker-src", "blob:",
    "MapLibre compiles its workers from blob URLs. Without it the map fails to initialise on every screen that renders one."],
  ["worker-src", "'self'",
    "Same-origin workers."],
  ["img-src", "blob:",
    "The scanner draws camera frames to a canvas and reads them back as blob URLs. Without it the photo scan preview is blank."],
  ["img-src", "data:",
    "Inline data-URI images, including generated QR codes on the bin label."],
  ["media-src", "blob:",
    "The <video> element the camera stream is attached to."],
  ["font-src", "https://fonts.gstatic.com",
    "Where Google Fonts serves the actual font files. The stylesheet host is not enough — a different directive governs each."],
  ["style-src", "https://fonts.googleapis.com",
    "The Google Fonts stylesheet itself."],
  ["script-src", "'unsafe-eval'",
    "WebAssembly instantiation, which the barcode decoder needs. Verified working against the live policy."],
  ["frame-ancestors", "'none'",
    "Clickjacking protection. Losing this is a security regression, not a broken feature, so nothing would visibly fail."],
];

test("every directive the app depends on still exists", () => {
  // A missing directive is not the same as an empty one: with no `media-src`,
  // `default-src 'self'` applies and blob: is refused just the same.
  for (const name of ["default-src", "script-src", "style-src", "font-src", "img-src", "media-src", "worker-src", "frame-ancestors"]) {
    assert.ok(directive(name).length > 0, `${name} is missing from the CSP — default-src takes over and is stricter.`);
  }
});

test("the tokens the map and the scanner depend on are still allowed", () => {
  for (const [name, token, why] of REQUIRED_TOKENS) {
    assert.ok(
      directive(name).includes(token),
      `${name} no longer allows ${token}. ${why}`,
    );
  }
});

test("the policy has not been loosened where it was deliberately tight", () => {
  // The other direction. These are worth failing on because a wildcard added to
  // silence one broken resource undoes the whole point of having a policy.
  assert.deepEqual(directive("default-src"), ["'self'"], "default-src should stay 'self' alone.");
  assert.deepEqual(directive("frame-ancestors"), ["'none'"], "frame-ancestors must stay 'none'.");

  for (const name of ["script-src", "connect-src", "worker-src", "media-src", "font-src"]) {
    assert.ok(!directive(name).includes("*"), `${name} contains a bare wildcard.`);
    assert.ok(!directive(name).includes("https:"), `${name} allows any https origin, which is barely a policy.`);
  }

  // img-src is the deliberate exception: it carries https: because container
  // photos and map tiles come from hosts we do not enumerate. Stated here so it
  // reads as a decision rather than an oversight.
  assert.ok(directive("img-src").includes("https:"), "img-src is intentionally broad — if that changed, this note should too.");
});
