import { BRISBANE_SUBURBS } from "../lib/brisbane-suburbs.ts";

const host = "thegoodsort.org";
const key = "goodsort2026indexnowkeye82a91b4";
const keyLocation = `https://${host}/${key}.txt`;

const urlList = [
  `https://${host}/`,
  `https://${host}/brisbane`,
  `https://${host}/scan`,
  `https://${host}/start`,
  ...BRISBANE_SUBURBS.map((s) => `https://${host}/brisbane/${s.slug}`),
];

console.log(`Preparing to submit ${urlList.length} URLs to IndexNow...`);

const body = {
  host,
  key,
  keyLocation,
  urlList,
};

async function submit() {
  const endpoints = [
    "https://api.indexnow.org/indexnow",
    "https://www.bing.com/indexnow",
  ];

  for (const endpoint of endpoints) {
    console.log(`Submitting to ${endpoint}...`);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(body),
      });

      console.log(`Endpoint ${endpoint} response: HTTP ${res.status} ${res.statusText}`);
      if (!res.ok) {
        const text = await res.text();
        console.error(`Error response: ${text}`);
      } else {
        console.log(`Successfully submitted ${urlList.length} URLs to ${endpoint}!`);
      }
    } catch (err) {
      console.error(`Failed to submit to ${endpoint}:`, err);
    }
  }
}

submit().catch(console.error);
