import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { formatVagueContainerBand } from "./marketplace.ts";

const ROOT = process.cwd();

test("formatVagueContainerBand returns privacy-safe approximate bands", () => {
  assert.equal(formatVagueContainerBand(0), "Starting");
  assert.equal(formatVagueContainerBand(2), "< 10 cans");
  assert.equal(formatVagueContainerBand(9), "< 10 cans");
  assert.equal(formatVagueContainerBand(15), "~10+ cans");
  assert.equal(formatVagueContainerBand(35), "~25+ cans");
  assert.equal(formatVagueContainerBand(80), "~50+ cans");
  assert.equal(formatVagueContainerBand(160), "~100+ cans");
  assert.equal(formatVagueContainerBand(320), "~250+ cans");
  assert.equal(formatVagueContainerBand(640), "~500+ cans");
  assert.equal(formatVagueContainerBand(900), "~750+ cans");
  assert.equal(formatVagueContainerBand(1050), "1,000+ ready");
});

test("MapView pins inline absolute 100% sizing to defeat Tailwind v4 .maplibregl-map cascade collapse and fits suburb centroids", () => {
  const mapSrc = fs.readFileSync(path.join(ROOT, "app", "components", "shared", "map-view.tsx"), "utf8");
  assert.match(mapSrc, /style=\{\{\s*position:\s*"absolute",\s*inset:\s*0,\s*width:\s*"100%",\s*height:\s*"100%"\s*\}\}/);
  assert.match(mapSrc, /\.fitBounds\(bounds/);
  assert.match(mapSrc, /formatVagueContainerBand/);

  const marketSrc = fs.readFileSync(path.join(ROOT, "app", "marketplace", "page.tsx"), "utf8");
  assert.match(marketSrc, /id="suburb-map"/);
  assert.match(marketSrc, /h-dvh w-full/);
  assert.match(marketSrc, /disableAutoLocate/);
  assert.match(marketSrc, /formatVagueContainerBand/);
  // Full-screen Google Maps layout: no marketing hero, no suburb filter dropdown or chip list
  assert.doesNotMatch(marketSrc, /SuburbFinder|DensityBoard/);

  const homeSrc = fs.readFileSync(path.join(ROOT, "app", "sort", "components", "waitlist-home.tsx"), "utf8");
  assert.match(homeSrc, /href="\/marketplace#suburb-map"/);
});

test("/bags links bag creation strictly to actual scanned inventory instead of defaulting empty streams to 150", () => {
  const bagsSrc = fs.readFileSync(path.join(ROOT, "app", "bags", "page.tsx"), "utf8");
  assert.doesNotMatch(bagsSrc, /useState<number>\(150\)/);
  assert.doesNotMatch(bagsSrc, /unbagged > 0 \? unbagged : 150/);
  assert.match(bagsSrc, /selectedUnbagged <= 0/);
  assert.match(bagsSrc, /max=\{Math\.max\(1, maxBagCount\)\}/);
  assert.match(bagsSrc, /Bag tags link directly to your scanned inventory/);
});
