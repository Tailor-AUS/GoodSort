import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function listTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsx(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

test("consumer mobile inputs and selects use >=16px font size to prevent iOS Safari auto-zoom", () => {
  const files = listTsx(path.join(ROOT, "app")).filter(
    (f) => !f.replace(/\\/g, "/").includes("/app/admin/"),
  );
  const offenders: string[] = [];

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    // Match JSX input/select/textarea tags cleanly by scanning line windows around className
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!/<(input|select|textarea)\b/.test(lines[i])) continue;
      let block = lines[i];
      let j = i;
      while (!block.includes("/>") && !/<select[^>]*>/.test(block) && j + 1 < lines.length && j - i < 16) {
        j++;
        block += " " + lines[j];
      }
      if (/type=["'](checkbox|file|hidden)["']/.test(block) || /className=["']hidden["']/.test(block)) {
        continue;
      }
      const clsMatch = block.match(/className=(?:"([^"]+)"|'([^']+)'|\{`([^`]+)`\})/);
      const cls = clsMatch ? (clsMatch[1] ?? clsMatch[2] ?? clsMatch[3] ?? "") : "";
      if (/\btext-(xs|sm|\[1[0-5]px\])\b/.test(cls)) {
        offenders.push(`${rel}:${i + 1} (${cls})`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Found <16px consumer inputs that trigger iOS Safari auto-zoom:\n${offenders.join("\n")}`,
  );
});

test("AccountPanel uses opaque white drawer surface, AddressAutocomplete status sits outside input, and InstallPrompt clears /sort bottom tab bar", () => {
  const panel = read("app/components/shared/account-panel.tsx");
  assert.match(panel, /role="dialog"[\s\S]*?bg-white/, "AccountPanel drawer should be opaque bg-white to prevent bleed-through");
  assert.doesNotMatch(panel, /role="dialog"[\s\S]*?glass-strong/, "AccountPanel drawer must not use translucent glass-strong");

  const auto = read("app/components/shared/address-autocomplete.tsx");
  assert.doesNotMatch(auto, /absolute right-3 top-1\/2.*Searching/, "AddressAutocomplete Searching indicator must not overlap typed input text");

  const install = read("app/components/shared/install-prompt.tsx");
  assert.match(install, /pathname === "\/sort" \? "bottom-\[86px\]" : "bottom-0"/, "InstallPrompt must float above /sort bottom tab bar");
});

test("/sort Pickups segmented pills fit 4 columns without overflow, /marketplace attribution clears Recentre FAB, and /scan barcode hint is mode-aware", () => {
  const waitlist = read("app/sort/components/waitlist-home.tsx");
  assert.match(waitlist, /grid grid-cols-4 gap-1 rounded-2xl bg-white/, "Pickups tabs should use a 4-column segmented track with zero horizontal scroll");

  const css = read("app/globals.css");
  assert.match(css, /\.tgs-fullscreen-map \.maplibregl-ctrl-bottom-right\s*\{[\s\S]*?left:\s*10px;[\s\S]*?right:\s*auto;/, "MapLibre attribution should sit bottom-left away from Recentre FAB");

  const scan = read("app/scan/page.tsx");
  assert.match(scan, /scanMode === "barcode"\s*\?/, "Bottom status hint on /scan must adapt when Barcode mode is active");

  const bags = read("app/bags/page.tsx");
  assert.match(bags, /whitespace-nowrap[\s\S]*?\+\s*Scan/, "/bags + Scan header CTA must stay single-line");

  const login = read("app/(auth)/login/page.tsx");
  const terms = read("app/terms/page.tsx");
  assert.match(login, /href="\/"/, "/login should include Back navigation");
  assert.match(terms, /href="\/"/, "/terms should include Back navigation");
});
