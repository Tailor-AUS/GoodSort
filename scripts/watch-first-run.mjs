const API_BASE = "https://api.livelyfield-64227152.eastasia.azurecontainerapps.io";

export async function checkStatus() {
  console.log(`[${new Date().toISOString()}] Checking GoodSort status...`);

  // 1. Check growth board
  const growthRes = await fetch(`${API_BASE}/api/growth/brisbane`);
  if (!growthRes.ok) {
    console.error(`Failed to fetch growth stats: HTTP ${growthRes.status}`);
    return null;
  }

  const growth = await growthRes.json();
  console.log(`Total Households: ${growth.totalHouseholds}`);
  console.log(`Total Containers Scanned: ${growth.totalContainers}`);
  console.log(`Incomplete Households: ${growth.incompleteHouseholds}`);

  if (growth.suburbs && growth.suburbs.length > 0) {
    console.log("\nActive Suburbs:");
    for (const s of growth.suburbs) {
      console.log(`- ${s.suburb}: ${s.containers}/${s.needed} containers (${s.households} households, live=${s.live})`);
    }
  } else {
    console.log("No suburbs with active containers yet.");
  }

  // 2. Check marketplace runs
  try {
    const runsRes = await fetch(`${API_BASE}/api/marketplace/runs?status=available`);
    if (runsRes.ok) {
      const runs = await runsRes.json();
      if (Array.isArray(runs) && runs.length > 0) {
        console.log(`\n🚨 ALERT: ${runs.length} RUN(S) AVAILABLE FOR COLLECTION! 🚨`);
        for (const r of runs) {
          console.log(`Run ID: ${r.id}`);
          console.log(`Area: ${r.area}`);
          console.log(`Containers: ${r.containerCount}`);
          console.log(`Stops: ${r.stopCount}`);
          console.log(`Est. Payout: $${(r.payoutCents / 100).toFixed(2)}`);
          console.log(`Created At: ${r.createdAt}`);
        }
        return { hasRun: true, runs, growth };
      } else {
        console.log("\nNo available runs posted on the marketplace yet.");
      }
    }
  } catch (err) {
    console.warn("Could not check marketplace runs:", err.message);
  }

  return { hasRun: false, runs: [], growth };
}

if (process.argv[1]?.endsWith("watch-first-run.mjs")) {
  checkStatus().then((res) => {
    if (res?.hasRun) {
      process.exit(10); // special exit code indicating run available
    }
  });
}
