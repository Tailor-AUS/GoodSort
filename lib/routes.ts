// Route lifecycle: claim → start → pickup stops → depot → settle
import {
  type Route,
  type User,
  type CollectionRecord,
  getRoutes,
  saveRoutes,
  getUser,
  getHouseholds,
  saveHouseholds,
  getDepots,
  SORTER_PAYOUT_CENTS,
  DRIVER_BASE_PAYOUT_CENTS,
  DRIVER_PER_CONTAINER_CENTS,
  emptyMaterials,
} from "./store";

function saveUser(user: User) {
  localStorage.setItem("goodsort_user", JSON.stringify(user));
}

// ── Route Lifecycle ──

export function claimRoute(routeId: string): Route | null {
  const user = getUser();
  if (!user) return null;
  const routes = getRoutes();
  const route = routes.find((r) => r.id === routeId);
  if (!route || route.status !== "pending") return null;

  route.status = "claimed";
  route.driverId = user.id;
  route.claimedAt = new Date().toISOString();
  saveRoutes(routes);

  user.role = "both";
  saveUser(user);

  return route;
}

export function startRoute(routeId: string): Route | null {
  const routes = getRoutes();
  const route = routes.find((r) => r.id === routeId);
  if (!route || route.status !== "claimed") return null;

  route.status = "in_progress";
  route.startedAt = new Date().toISOString();
  saveRoutes(routes);
  return route;
}

export function markStopPickedUp(routeId: string, stopId: string, actualCount: number): Route | null {
  const routes = getRoutes();
  const route = routes.find((r) => r.id === routeId);
  if (!route || route.status !== "in_progress") return null;

  const stop = route.stops.find((s) => s.id === stopId);
  if (!stop || stop.status !== "pending") return null;

  stop.status = "picked_up";
  stop.pickedUpAt = new Date().toISOString();
  stop.actualContainerCount = actualCount;

  // Check if all stops are done
  const allDone = route.stops.every((s) => s.status !== "pending");
  if (allDone) {
    route.status = "at_depot";
  }

  saveRoutes(routes);
  return route;
}

export function skipStop(routeId: string, stopId: string): Route | null {
  const routes = getRoutes();
  const route = routes.find((r) => r.id === routeId);
  if (!route || route.status !== "in_progress") return null;

  const stop = route.stops.find((s) => s.id === stopId);
  if (!stop || stop.status !== "pending") return null;

  stop.status = "skipped";

  const allDone = route.stops.every((s) => s.status !== "pending");
  if (allDone) {
    route.status = "at_depot";
  }

  saveRoutes(routes);
  return route;
}

export function completeRouteAtDepot(routeId: string): Route | null {
  const routes = getRoutes();
  const route = routes.find((r) => r.id === routeId);
  if (!route) return null;

  // Allow completing from in_progress too (if driver goes to depot early)
  if (route.status !== "at_depot" && route.status !== "in_progress") return null;

  route.status = "at_depot";
  route.completedAt = new Date().toISOString();
  saveRoutes(routes);
  return route;
}

export interface HouseholdPayout {
  householdId: string;
  householdName: string;
  containerCount: number;
  payoutCents: number;
}

export function settleRoute(routeId: string): {
  route: Route;
  driverEarned: number;
  householdPayouts: HouseholdPayout[];
} | null {
  const user = getUser();
  if (!user) return null;

  const routes = getRoutes();
  const route = routes.find((r) => r.id === routeId);
  if (!route || route.status !== "at_depot") return null;

  // Calculate totals from picked-up stops
  const pickedUpStops = route.stops.filter((s) => s.status === "picked_up");
  const totalCollected = pickedUpStops.reduce((s, st) => s + (st.actualContainerCount || st.containerCount), 0);

  // Driver payout
  const driverEarned = DRIVER_BASE_PAYOUT_CENTS + totalCollected * DRIVER_PER_CONTAINER_CENTS;
  route.driverPayoutCents = driverEarned;

  // Household payouts (pro-rata based on actual pickup)
  const householdPayouts: HouseholdPayout[] = pickedUpStops.map((stop) => {
    const count = stop.actualContainerCount || stop.containerCount;
    return {
      householdId: stop.householdId,
      householdName: stop.householdName,
      containerCount: count,
      payoutCents: count * SORTER_PAYOUT_CENTS,
    };
  });

  // Reset household pending counts
  const households = getHouseholds();
  for (const payout of householdPayouts) {
    const household = households.find((h) => h.id === payout.householdId);
    if (household) {
      household.pendingContainers = Math.max(0, household.pendingContainers - payout.containerCount);
      household.pendingValueCents = household.pendingContainers * SORTER_PAYOUT_CENTS;
      household.estimatedBags = Math.ceil(household.pendingContainers / 150);
      // Reset materials proportionally
      if (household.pendingContainers === 0) {
        household.materials = emptyMaterials();
      }
    }
  }
  saveHouseholds(households);

  // Settle user's scans if they're a sorter in this route
  const userPayout = householdPayouts.find((p) => p.householdId === user.householdId);
  if (userPayout) {
    let settled = 0;
    for (const scan of user.scans) {
      if (scan.householdId === user.householdId && scan.status === "pending" && settled < userPayout.containerCount) {
        scan.status = "settled";
        user.pendingCents -= scan.refundCents;
        user.clearedCents += scan.refundCents;
        settled++;
      }
    }
  }

  // Add driver earnings
  user.clearedCents += driverEarned;

  // Add collection record
  const depots = getDepots();
  const depot = depots.find((d) => d.id === route.depotId);
  const collection: CollectionRecord = {
    id: crypto.randomUUID(),
    routeId: route.id,
    stopCount: pickedUpStops.length,
    totalContainers: totalCollected,
    earnedCents: driverEarned,
    depotName: depot?.name || "Depot",
    timestamp: new Date().toISOString(),
  };
  user.collections.unshift(collection);

  // Badges
  if (user.collections.length === 1 && !user.badges.includes("first_collection")) {
    user.badges.push("first_collection");
  }
  if (user.totalContainers >= 100 && !user.badges.includes("hundred_club")) {
    user.badges.push("hundred_club");
  }

  saveUser(user);

  // Finalize route
  route.status = "settled";
  route.settledAt = new Date().toISOString();
  saveRoutes(routes);

  return { route, driverEarned, householdPayouts };
}
