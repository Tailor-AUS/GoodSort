import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

describe("TGS mailbox cutover (tg#612)", () => {
  it("points /admin, /privacy, and /terms to hello@thegoodsort.org with no dead or Tailor addresses", () => {
    const admin = fs.readFileSync(path.join(ROOT, "app/admin/page.tsx"), "utf8");
    const privacy = fs.readFileSync(path.join(ROOT, "app/privacy/page.tsx"), "utf8");
    const terms = fs.readFileSync(path.join(ROOT, "app/terms/page.tsx"), "utf8");

    assert.doesNotMatch(admin, /knox@tailor\.au/i);
    assert.doesNotMatch(admin, /admin@thegoodsort\.org/i);
    assert.match(admin, /hello@thegoodsort\.org/);
    assert.match(admin, /stats\?\.nonAdminUsers/);

    assert.doesNotMatch(privacy, /privacy@thegoodsort\.org/i);
    assert.match(privacy, /mailto:hello@thegoodsort\.org/);

    assert.doesNotMatch(terms, /legal@thegoodsort\.org/i);
    assert.match(terms, /mailto:hello@thegoodsort\.org/);
  });
});
