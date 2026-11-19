import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { extractLeadingStreetNumber, formatPhotonAddress, hasStreetNumber } from "./photon.ts";
import { BAG_STREAMS, DISCREPANCY_OPTIONS, streamGuideForMaterial } from "./marketplace.ts";
import { sanitizeNextPath } from "./config.ts";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("Revision R1 — TGS Breaker Hardening (F-01..F-16)", () => {
  it("F-03: formatPhotonAddress preserves user-typed house/unit numbers even when Photon strips or rewrites them", () => {
    // 1. Photon returns wrong house number 35 when user typed 12 Hamilton Road
    const wrongHouse = formatPhotonAddress(
      { housenumber: "35", street: "Hamilton Road", district: "Moorooka", state: "Queensland", postcode: "4105", countrycode: "AU" },
      "12 Hamilton Road Moorooka"
    );
    assert.equal(wrongHouse, "12 Hamilton Road, Moorooka QLD 4105");

    // 2. Photon strips housenumber completely (34 Vendale Ave, 18 Cracknell Rd, 45 Ekibin Rd East)
    const stripped = formatPhotonAddress(
      { street: "Cracknell Road", district: "Tarragindi", state: "Queensland", postcode: "4121", countrycode: "AU" },
      "18 Cracknell Road Tarragindi"
    );
    assert.equal(stripped, "18 Cracknell Road, Tarragindi QLD 4121");

    // 3. Unit/duplex prefix preserved ("Unit 2, 14 Windmill St" -> "2/14")
    assert.equal(extractLeadingStreetNumber("Unit 2, 14 Windmill St"), "2/14");
    assert.equal(hasStreetNumber("18A Cracknell Rd, Tarragindi"), true);
    assert.equal(hasStreetNumber("Cracknell Road, Tarragindi QLD 4121"), false);
  });

  it("F-04 & F-08: /scan mounts barcode + offline scan mode and 4-stream bag guidance with unified QLD wine/spirit rules", () => {
    const scanSrc = read("app/scan/page.tsx");
    assert.match(scanSrc, /lookupContainerAsync/);
    assert.match(scanSrc, /addScanApi/);
    assert.match(scanSrc, /flushUnsyncedScans/);
    assert.match(scanSrc, /streamGuideForMaterial/);
    assert.match(scanSrc, /BarcodeDetector/);
    assert.match(scanSrc, /@zxing\/browser/);

    assert.equal(streamGuideForMaterial("aluminium").bagName, "Blue Bag");
    assert.equal(streamGuideForMaterial("pet_clear").bagName, "Teal Bag");
    assert.equal(streamGuideForMaterial("pet_coloured").bagName, "Amber Bag");
    assert.equal(streamGuideForMaterial("glass").bagName, "Green Bag");
    assert.match(BAG_STREAMS.glass.rule, /wine, spirit/i);
    assert.doesNotMatch(BAG_STREAMS.glass.rule, /no wine/i);
    assert.ok(DISCREPANCY_OPTIONS.every((o) => !/wine/i.test(o.label)));
  });

  it("F-07 & F-11: sw-init.js never reloads first-visit sessions and staticwebapp.config.json serves image/png for OpenGraph routes", () => {
    const swInit = read("public/sw-init.js");
    assert.match(swInit, /var hadController = Boolean\(navigator\.serviceWorker\.controller\)/);
    assert.match(swInit, /if \(!hadController \|\| refreshing\) return;/);

    const swa = JSON.parse(read("public/staticwebapp.config.json")) as {
      routes: Array<{ route: string; headers?: Record<string, string> }>;
    };
    for (const expectedRoute of ["/opengraph-image", "/twitter-image", "/brisbane/*/opengraph-image"]) {
      const match = swa.routes.find((r) => r.route === expectedRoute);
      assert.ok(match, `Missing SWA route header for ${expectedRoute}`);
      assert.equal(match.headers?.["Content-Type"], "image/png");
    }
  });

  it("F-12, F-13, F-14, F-16: no non-HttpOnly JWT cookie writes, DOM-safe MapLibre popups, honest /privacy, safe ?next=, and standalone Runner AccountPanel", () => {
    for (const rel of [
      "app/(auth)/verify/page.tsx",
      "app/(auth)/onboard/page.tsx",
      "app/(runner)/runner/signup/page.tsx",
      "app/components/marketing/marketing-home.tsx",
      "app/scan/page.tsx",
    ]) {
      assert.doesNotMatch(read(rel), /document\.cookie\s*=\s*`goodsort_token=/);
    }

    const adminUsers = read("app/admin/users/page.tsx");
    assert.doesNotMatch(adminUsers, /\.setHTML\(/);
    assert.match(adminUsers, /\.setDOMContent\(/);

    const privacy = read("app/privacy/page.tsx");
    assert.match(privacy, /Tailor Vision/);
    assert.match(privacy, /East Asia/);
    assert.match(privacy, /fonts\.googleapis\.com/);

    assert.equal(sanitizeNextPath("/admin/waitlist"), "/admin/waitlist");
    assert.equal(sanitizeNextPath("//evil.example"), undefined);
    assert.equal(sanitizeNextPath("https://evil.example"), undefined);

    const accountPanel = read("app/components/shared/account-panel.tsx");
    assert.match(accountPanel, /isStandaloneRunner/);
  });
});
