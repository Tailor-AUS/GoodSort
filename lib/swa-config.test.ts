import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Static Web Apps config has to be somewhere the deploy can see it.
 *
 * It was not. staticwebapp.config.json sat at the repo root for the whole life
 * of this site; the SWA workflow uploads `out/` with skip_app_build, and a
 * Next.js static export only copies `public/` into `out/`. So the file never
 * reached the artifact, and every header it declares was absent in production:
 * no Content-Security-Policy, no X-Frame-Options, no Referrer-Policy, no
 * Permissions-Policy. Only the two SWA sends by default were there.
 *
 * Nothing about that is visible from the repo. The file exists, the JSON is
 * valid, the CSP reads correctly, the build is green, and the deploy succeeds —
 * it is simply never uploaded. It cost me a wrong diagnosis before it cost
 * anything else: I had blamed CSP for a lookup failure in a policy that was
 * not being enforced.
 *
 * Referrer-Policy is the one to notice. Invite links carry ?r={profileGuid},
 * so without it a member's profile id rides along in the Referer header to
 * whatever they click through to.
 */

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CONFIG = join(ROOT, "public", "staticwebapp.config.json");

test("the config lives where the build will copy it", () => {
  assert.ok(
    existsSync(CONFIG),
    "staticwebapp.config.json must be in public/ — it is the only directory a Next.js " +
      "static export copies into out/, and out/ is what the SWA workflow uploads.",
  );
});

test("no inert copy is left at the repo root", () => {
  // A root copy is worse than none: it reads as configuration, reviews as
  // configuration, and does nothing.
  assert.ok(
    !existsSync(join(ROOT, "staticwebapp.config.json")),
    "There is a staticwebapp.config.json at the repo root. It is not deployed — " +
      "it will silently disagree with the real one in public/.",
  );
});

test("it still declares the headers that were missing in production", () => {
  const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
  const headers = cfg?.globalHeaders ?? {};

  for (const name of [
    "Content-Security-Policy",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
  ]) {
    assert.ok(headers[name], `${name} is missing from globalHeaders.`);
  }

  // Named specifically: invite links carry ?r={profileGuid}, so a permissive
  // referrer policy leaks a member's profile id to any site they click through
  // to. "unsafe-url" would do exactly that.
  assert.notEqual(headers["Referrer-Policy"], "unsafe-url");
});

/**
 * What the routing rules do now that the file is actually deployed.
 *
 * navigationFallback was `{ rewrite: "/index.html" }` with no exclude list, and
 * it went live for the first time today. Measured against production before
 * changing it:
 *
 *   /_next/static/chunks/does-not-exist.js  ->  200, content-type text/html
 *   /brisbane/not-a-suburb-xyz              ->  200, byte-identical to the homepage
 *
 * Both are wrong, in different ways. A missing script answered with HTML and a
 * 200 makes the browser parse a document as JavaScript, so a stale tab across a
 * deploy fails with "Unexpected token '<'" instead of a clean 404. And every
 * mistyped URL returning the homepage at 200 is a soft 404: the visitor gets
 * the wrong page and a search engine is told it is a real one.
 *
 * The fallback was never load-bearing. `output: "export"` pre-renders every
 * route to its own .html — all 21, including the 191 suburb pages from
 * generateStaticParams — and Static Web Apps resolves /scan to /scan.html
 * itself. Verified: /scan and /scan.html came back byte-identical, and neither
 * matched /index.html.
 */

test("a missing file is a 404, whatever it is", () => {
  const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));

  // Two ways to get this right, and the contract is the behaviour, not the
  // mechanism. Either there is no navigation fallback at all — correct here,
  // because output:"export" pre-renders every route and SWA resolves each one
  // itself — or there is one that excludes assets so a missing chunk is not
  // answered with a document.
  const fallback = cfg?.navigationFallback;
  if (fallback) {
    const exclude: string[] = fallback.exclude ?? [];
    assert.ok(exclude.includes("/_next/*"), "/_next/* must be excluded — that is where every hashed chunk lives.");
    for (const ext of ["/*.js", "/*.css", "/*.png"]) {
      assert.ok(exclude.includes(ext), `${ext} should be excluded from the navigation fallback.`);
    }
    assert.notEqual(fallback.rewrite, "/index.html", "Falling back to the homepage for every mistyped URL is a soft 404.");
  }

  // And an unmatched request has to carry a real status. A fallback rewrite
  // answers with 200, which is why the fallback was removed rather than merely
  // repointed: measured on production, `rewrite: "/404.html"` served the right
  // page with the wrong code, and responseOverrides never got a turn.
  assert.equal(cfg?.responseOverrides?.["404"]?.statusCode, 404, "A 404 must actually be a 404.");
  assert.equal(cfg?.responseOverrides?.["404"]?.rewrite, "/404.html");
});
