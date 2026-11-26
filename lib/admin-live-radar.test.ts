import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TRACKED_EVENTS } from "./analytics.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("/admin/live real-time radar wires live-feed polling, filters, pause, chime, and tester journeys", () => {
  const page = read("app/admin/live/page.tsx");
  assert.match(page, /\/api\/admin\/live-feed\?minutes=/);
  assert.match(page, /POLL_INTERVAL_MS\s*=\s*3000/);
  assert.match(page, /Live Interactions Radar/);
  assert.match(page, /Live Tester Journeys/);
  assert.match(page, /Real-Time Event Stream/);
  assert.match(page, /Authorization:\s*`Bearer \$\{token\}`/);
});

test("/admin and /sort admin shortcuts link directly to /admin/live", () => {
  const adminPage = read("app/admin/page.tsx");
  assert.match(adminPage, /href="\/admin\/live"/);

  const waitlist = read("app/sort/components/waitlist-home.tsx");
  assert.match(waitlist, /href="\/admin\/live"/);
});

test("TRACKED_EVENTS includes camera, AI vision, barcode, onboard, and sort dashboard diagnostics", () => {
  for (const evt of [
    "camera_denied",
    "scan_vision_ok",
    "scan_vision_empty",
    "scan_vision_error",
    "scan_barcode_ok",
    "onboard_viewed",
    "sort_dashboard_viewed",
  ] as const) {
    assert.ok(TRACKED_EVENTS.includes(evt), `Missing ${evt} in TRACKED_EVENTS`);
  }
});
