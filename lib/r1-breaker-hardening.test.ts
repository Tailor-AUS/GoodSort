import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  expandRoadAbbreviations,
  extractBareHouseNumber,
  extractLeadingStreetNumber,
  extractTypedBrisbaneSuburb,
  formatPhotonAddress,
  geocodeAddress,
  hasStreetNumber,
  stripLeadingStreetNumber,
} from "./photon.ts";
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

  it("F-07 & F-11: sw-init.js never reloads first-visit sessions and OpenGraph uses a real <300KB .jpg asset (never extensionless octet-stream)", () => {
    const swInit = read("public/sw-init.js");
    assert.match(swInit, /var hadController = Boolean\(navigator\.serviceWorker\.controller\)/);
    assert.match(swInit, /if \(!hadController \|\| refreshing\) return;/);

    const seoSrc = read("app/seo.ts");
    assert.match(seoSrc, /url:\s*"\/images\/og-thegoodsort\.jpg"/);
    assert.match(read("app/brisbane/[suburb]/page.tsx"), /SOCIAL_IMAGE/);

    const ogBytes = fs.readFileSync(path.join(ROOT, "public/images/og-thegoodsort.jpg"));
    assert.equal(ogBytes[0], 0xff);
    assert.equal(ogBytes[1], 0xd8);
    assert.ok(ogBytes.length > 10_000 && ogBytes.length < 300_000, `OG JPEG size ${ogBytes.length} must stay under WhatsApp 300KB cap`);

    const swa = JSON.parse(read("public/staticwebapp.config.json")) as {
      routes: Array<{ route: string; headers?: Record<string, string> }>;
    };
    // Azure SWA rejects mid-path wildcards like /brisbane/*/opengraph-image; wildcards must only trail.
    for (const r of swa.routes) {
      assert.doesNotMatch(r.route, /\*[^.]*\/|\*[^.]+$/);
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

  it("R2 F-03: geocodeAddress resolves unmapped house numbers, unit prefixes, road abbreviations, and ranks typed suburb above wrong-suburb housenumber hits", async () => {
    assert.equal(extractBareHouseNumber("Unit 2, 18 Cracknell Rd Tarragindi"), "18");
    assert.equal(stripLeadingStreetNumber("Unit 2, 18 Cracknell Rd Tarragindi"), "Cracknell Rd Tarragindi");
    assert.equal(expandRoadAbbreviations("Ekibin Rd East Annerley"), "Ekibin Road East Annerley");
    assert.equal(extractTypedBrisbaneSuburb("12 Hamilton Rd Moorooka"), "Moorooka");
    assert.equal(extractTypedBrisbaneSuburb("12 Beaudesert Rd Moorooka"), "Moorooka");

    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (input: string | URL | Request) => {
        const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
        const q = u.searchParams.get("q") ?? "";
        let features: unknown[] = [];

        if (q === "18 Cracknell Rd Tarragindi") {
          features = []; // Photon lacks house node 18
        } else if (q === "Cracknell Road Tarragindi") {
          features = [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [153.0461, -27.5262] },
              properties: { name: "Cracknell Road", district: "Tarragindi", city: "Brisbane", state: "Queensland", postcode: "4121", countrycode: "AU" },
            },
          ];
        } else if (q === "45 Ekibin Rd East Annerley") {
          features = [];
        } else if (q === "Ekibin Road East Annerley") {
          // Simulate Photon returning an unrelated POI on Ipswich Road — must be rejected by street-stem check!
          features = [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [153.0312, -27.5127] },
              properties: { name: "Ekibin News", street: "Ipswich Road", district: "Annerley", city: "Brisbane", state: "Queensland", postcode: "4103", countrycode: "AU" },
            },
          ];
        } else if (q === "Ekibin Road Annerley") {
          features = [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [153.0385, -27.5155] },
              properties: { name: "Ekibin Road East", district: "Annerley", city: "Brisbane", state: "Queensland", postcode: "4103", countrycode: "AU" },
            },
          ];
        } else if (q === "12 Beaudesert Rd Moorooka") {
          features = [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [153.0281, -27.5581] },
              properties: { housenumber: "12", street: "Beaudesert Road", district: "Salisbury", city: "Brisbane", state: "Queensland", postcode: "4107", countrycode: "AU" },
            },
          ];
        } else if (q === "Beaudesert Road Moorooka") {
          features = [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [153.0215, -27.5365] },
              properties: { name: "Beaudesert Road", district: "Moorooka", city: "Brisbane", state: "Queensland", postcode: "4105", countrycode: "AU" },
            },
          ];
        }

        return new Response(JSON.stringify({ features }), { status: 200, headers: { "Content-Type": "application/json" } });
      };

      const unitHit = await geocodeAddress("Unit 2, 18 Cracknell Rd Tarragindi");
      assert.ok(unitHit);
      assert.equal(unitHit.address, "2/18 Cracknell Road, Tarragindi QLD 4121");
      assert.equal(unitHit.suburb, "Tarragindi");

      const ekibinHit = await geocodeAddress("45 Ekibin Rd East Annerley");
      assert.ok(ekibinHit);
      assert.equal(ekibinHit.address, "45 Ekibin Road East, Annerley QLD 4103");
      assert.equal(ekibinHit.suburb, "Annerley");

      const beaudesertHit = await geocodeAddress("12 Beaudesert Rd Moorooka");
      assert.ok(beaudesertHit);
      assert.equal(beaudesertHit.address, "12 Beaudesert Road, Moorooka QLD 4105");
      assert.equal(beaudesertHit.suburb, "Moorooka");
    } finally {
      globalThis.fetch = origFetch;
    }

    const scanSrc = read("app/scan/page.tsx");
    assert.match(scanSrc, /\/api\/scan\/photo\/preview/);
    assert.match(scanSrc, /preScanToken/);
  });
});
