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
