import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TRACKED_EVENTS } from "./analytics.ts";
import { isStoredAdmin } from "./config.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function makeFakeJwt(payload: Record<string, unknown>): string {
  const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const b = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${h}.${b}.sig`;
}

test("TRACKED_EVENTS covers points_swap_voted, cash_payout_selected, and top-of-funnel / bag / flyer events", () => {
  for (const name of [
    "landing_viewed",
    "suburb_page_viewed",
    "map_viewed",
    "bag_tagged",
    "flyer_printed",
    "points_swap_voted",
    "cash_payout_selected",
  ] as const) {
    assert.ok(TRACKED_EVENTS.includes(name), `Missing ${name} in TRACKED_EVENTS`);
  }
});

test("isStoredAdmin detects admin via stored profile flag or JWT role array and rejects non-admin / expired tokens", () => {
  const prevWindow = (globalThis as Record<string, unknown>).window;
  const prevStorage = (globalThis as Record<string, unknown>).localStorage;
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };

  try {
    (globalThis as Record<string, unknown>).window = {};
    (globalThis as Record<string, unknown>).localStorage = mockStorage;

    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    store.set("goodsort_token", makeFakeJwt({ sub: "11111111-1111-1111-1111-111111111111", role: ["sorter", "admin"], exp: futureExp }));
    assert.equal(isStoredAdmin(), true);

    store.set("goodsort_token", makeFakeJwt({ sub: "11111111-1111-1111-1111-111111111111", role: "sorter", exp: futureExp }));
    assert.equal(isStoredAdmin(), false);

    store.set("goodsort_profile", JSON.stringify({ id: "11111111-1111-1111-1111-111111111111", isAdmin: true }));
    assert.equal(isStoredAdmin(), true);

    // Expired JWT must return false even if profile says isAdmin
    store.set("goodsort_token", makeFakeJwt({ sub: "11111111-1111-1111-1111-111111111111", role: "admin", exp: Math.floor(Date.now() / 1000) - 10 }));
    assert.equal(isStoredAdmin(), false);
  } finally {
    if (prevWindow === undefined) delete (globalThis as Record<string, unknown>).window;
    else (globalThis as Record<string, unknown>).window = prevWindow;
    if (prevStorage === undefined) delete (globalThis as Record<string, unknown>).localStorage;
    else (globalThis as Record<string, unknown>).localStorage = prevStorage;
  }
});

test("Admin command centre wires ordered funnel, live activity stream, CRM drill-down drawer, CSV export, and /sort admin shortcut", () => {
  const adminPage = read("app/admin/page.tsx");
  assert.match(adminPage, /\/api\/admin\/activity\?limit=25/);
  assert.match(adminPage, /orderedStages/);
  assert.match(adminPage, /points_swap_voted/);

  const usersPage = read("app/admin/users/page.tsx");
  assert.match(usersPage, /\/api\/admin\/users\/\$\{selectedUserId\}/);
  assert.match(usersPage, /Export CSV/);
  assert.match(usersPage, /URL\.revokeObjectURL/);

  const waitlist = read("app/sort/components/waitlist-home.tsx");
  assert.match(waitlist, /isStoredAdmin\(\)/);
  assert.match(waitlist, /Admin Command Centre/);
});
