import { readFileSync } from "node:fs";
import { BRISBANE_SUBURBS } from "../lib/brisbane-suburbs.ts";

const host = "thegoodsort.org";
// Bytes, not a trimmed string. IndexNow rejects the host when the file has
// a trailing newline, which is how the first submissions came back 403.
const key = readFileSync(
  new URL("../public/goodsort2026indexnowkeye82a91b4.txt", import.meta.url),
  "utf8",
);
if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) {
  console.error("IndexNow key file must contain the key and nothing else — no newline.");
  process.exit(1);
}

const keyLocation = `https://${host}/${key}.txt`;

// /scan and /start are Disallow in robots.txt. Asking Bing to index them
// fights the file we already published.
const urlList = [
  `https://${host}/`,
  `https://${host}/brisbane`,
  `https://${host}/guides/containers-for-change-brisbane`,
  `https://${host}/privacy`,
  `https://${host}/terms`,
  ...BRISBANE_SUBURBS.map((s) => `https://${host}/brisbane/${s.slug}`),
];

console.log(`Preparing to submit ${urlList.length} URLs to IndexNow...`);

const body = {
  host,
  key,
  keyLocation,
  urlList,
};

const endpoints = [
  "https://api.indexnow.org/indexnow",
  "https://www.bing.com/indexnow",
];

async function submitOnce() {
  let accepted = 0;
  for (const endpoint of endpoints) {
    console.log(`Submitting to ${endpoint}...`);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
      });
      console.log(`Endpoint ${endpoint} response: HTTP ${res.status} ${res.statusText}`);
      if (res.ok) {
        accepted += 1;
        console.log(`Accepted ${urlList.length} URLs at ${endpoint}.`);
      } else {
        console.error(`Error response: ${await res.text()}`);
      }
    } catch (err) {
      console.error(`Failed to submit to ${endpoint}:`, err);
    }
  }
  return accepted;
}

// The key file only matches after the static deploy that publishes it.
// The first attempt often races that upload.
let accepted = 0;
for (let attempt = 1; attempt <= 5; attempt++) {
  accepted = await submitOnce();
  if (accepted > 0) break;
  if (attempt < 5) {
    console.log(`No endpoint accepted the key yet (attempt ${attempt}). Waiting 10s.`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

if (accepted === 0) {
  console.error("IndexNow did not accept the submission.");
  process.exit(1);
}
