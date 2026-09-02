// API-backed store — calls .NET API on Azure Container Apps
// Falls back to localStorage store when API is unavailable

import { apiUrl } from "./config.ts";
import type { User, Household, Route, Depot, ScanRecord, CollectionRecord, SortBin } from "./store.ts";
import {
  getUser as getLocalUser,
  getOrCreateDefaultUser as getLocalDefault,
  getHouseholds as getLocalHouseholds,
  getRoutes as getLocalRoutes,
  getDepots as getLocalDepots,
  addScan as addLocalScan,
  removeScan as removeLocalScan,
  getPendingRoutes as getLocalPendingRoutes,
  getActiveRoute as getLocalActiveRoute,
  saveUser as saveLocalUser,
  getUnsyncedScans,
  markScanUnsynced,
  markScanSynced,
} from "./store.ts";

// ── Helpers ──

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T | null> {
  const url = apiUrl(path);
  try {
    const token = typeof window !== "undefined" ? localStorage.getItem("goodsort_token") : null;
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options?.headers,
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Like `apiFetch`, but says why it failed.
 *
 * `apiFetch` collapses "the network is down" and "the server refused" into the
 * same null, which is deliberate for reads. For a write that has already been
 * applied locally the difference decides whether to keep it: a network failure
 * syncs later, a refusal never will.
 */
async function apiSend<T>(path: string, options: RequestInit): Promise<{
  data: T | null;
  /** True when the server answered and rejected it. The write will never land. */
  refused: boolean;
  status: number | null;
}> {
  try {
    const token = typeof window !== "undefined" ? localStorage.getItem("goodsort_token") : null;
    const res = await fetch(apiUrl(path), {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options?.headers,
      },
    });
    if (!res.ok) return { data: null, refused: res.status >= 400 && res.status < 500, status: res.status };
    return { data: (await res.json()) as T, refused: false, status: res.status };
  } catch {
    // No response at all — offline, DNS, CORS. Keep the local write.
    return { data: null, refused: false, status: null };
  }
}

function getStoredUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const profile = localStorage.getItem("goodsort_profile");
    if (profile) return JSON.parse(profile).id;
  } catch { /* ignore */ }
  return null;
}

// ── User ──

export async function getUserApi(): Promise<User | null> {
  const userId = getStoredUserId();
  if (!userId) return getLocalUser();

  // Send anything the server has never seen BEFORE reading the profile back.
  // The response is used to rebuild local state, so a scan that syncs here is
  // already in that response and is not counted twice. Doing it the other way
  // round would either lose the scan or double it.
  await flushUnsyncedScans();

  const profile = await apiFetch<{
    id: string; name: string; householdId: string; role: string;
    pendingCents: number; clearedCents: number;
    totalContainers: number; totalCo2SavedKg: number; badges: string[];
    createdAt: string;
  }>(`/api/profiles/${userId}`);

  if (!profile) return getLocalUser();

  // Get scans from API
  const scans = await apiFetch<ScanRecord[]>(`/api/scans?userId=${userId}&limit=50`) || [];

  // Map API profile to local User shape
  const user: User = {
    id: profile.id,
    name: profile.name,
    householdId: profile.householdId || "",
    role: profile.role as "sorter" | "driver" | "both",
    pendingCents: profile.pendingCents,
    clearedCents: profile.clearedCents,
    totalContainers: profile.totalContainers,
    totalCO2SavedKg: profile.totalCo2SavedKg,
    scans: scans.map((s) => ({
      id: s.id,
      barcode: s.barcode,
      containerName: s.containerName,
      material: s.material,
      refundCents: s.refundCents || 5,
      status: s.status as "pending" | "in_route" | "settled",
      householdId: s.householdId,
      routeId: s.routeId,
      timestamp: s.timestamp || new Date().toISOString(),
    })),
    collections: [],
    badges: profile.badges || [],
    createdAt: profile.createdAt,
  };

  // Anything the server still has not accepted has to survive this write.
  // saveLocalUser replaces `scans` wholesale, so without the merge a single
  // successful profile read deletes every scan made offline.
  const stillUnsynced = getUnsyncedScans().filter(
    (local) => !user.scans.some((fromServer) => fromServer.id === local.id),
  );
  if (stillUnsynced.length > 0) {
    user.scans = [...stillUnsynced, ...user.scans];
  }

  // Sync to localStorage for offline
  saveLocalUser(user);
  return user;
}


/**
 * Re-send scans the server has never accepted.
 *
 * Writes are offline-first: a scan lands in localStorage and is then posted. If
 * that post could not reach the server the local copy stayed — correctly — but
 * nothing ever tried again, and getUserApi later overwrote local storage with
 * the server's version, deleting it. A member scanning forty containers at a
 * kerb with no signal watched their balance climb and then lose every one of
 * them on the walk back inside.
 *
 * Called before a profile read so the server has the scans before its response
 * is used to rebuild local state. Ordering matters: flush, then fetch, then the
 * fetched list already contains anything that just synced, so nothing is
 * counted twice.
 */
export async function flushUnsyncedScans(): Promise<{ sent: number; refused: number; stillPending: number }> {
  const userId = getStoredUserId();
  const pending = getUnsyncedScans();
  if (!userId || pending.length === 0) {
    return { sent: 0, refused: 0, stillPending: pending.length };
  }

  let sent = 0;
  let refused = 0;

  for (const scan of pending) {
    const { data, refused: wasRefused } = await apiSend<{ creditedCents?: number }>("/api/scans", {
      method: "POST",
      body: JSON.stringify({
        userId,
        barcode: scan.barcode,
        containerName: scan.containerName,
        material: scan.material,
      }),
    });

    if (wasRefused) {
      // Final. The scan is never going to be accepted, so the local copy has to
      // go, exactly as it would have on the original attempt.
      removeLocalScan(scan.id);
      refused++;
      continue;
    }
    if (data !== null) {
      markScanSynced(scan.id);
      sent++;
      continue;
    }
    // Still unreachable — leave it marked and try again next time.
    break;
  }

  return { sent, refused, stillPending: getUnsyncedScans().length };
}

// ── Households ──

export async function getHouseholdsApi(): Promise<Household[]> {
  const households = await apiFetch<Household[]>("/api/households");
  return households || getLocalHouseholds();
}

// ── Scans ──

export async function addScanApi(
  barcode: string,
  containerName: string,
  material: string,
  // `refused` is separate from a null credit on purpose. A null credit also
  // happens when nobody is signed in, or when the server simply did not include
  // the field — neither of which means the scan was rejected. Callers that show
  // the member "+5c added" need to know the difference, and inferring it from a
  // null got it wrong.
): Promise<{ user: User; creditedCents: number | null; bonusRemaining: number | null; refused: boolean }> {
  const userId = getStoredUserId();

  // Always save locally first (offline-first)
  const localUser = addLocalScan(barcode, containerName, material);

  // Then sync to API. The server decides the credit (the launch bonus doubles
  // a member's first containers), so report back what it actually granted
  // rather than assuming the standard rate.
  let creditedCents: number | null = null;
  let bonusRemaining: number | null = null;
  if (userId) {
    const { data: res, refused } = await apiSend<{ creditedCents?: number; bonusRemaining?: number }>("/api/scans", {
      method: "POST",
      body: JSON.stringify({
        userId,
        barcode,
        containerName,
        material,
      }),
    });

    // A refusal is final — over the daily cap, past the rate limit, not signed
    // in. The scan will never be accepted, so the local copy has to go back
    // out, or the member is looking at credit and a container count the server
    // does not have. A network failure is the opposite case and keeps its local
    // write: that is the whole point of writing locally first.
    if (refused) {
      const scanId = localUser.scans[0]?.id;
      const corrected = scanId ? removeLocalScan(scanId) : null;
      return { user: corrected ?? localUser, creditedCents: null, bonusRemaining: null, refused: true };
    }

    if (res === null) {
      // Not refused, just unreachable — the local write stays, and this marks
      // it so flushUnsyncedScans re-sends it. Without the mark it survived in
      // storage but was never re-sent, and the next successful profile fetch
      // overwrote it away.
      const scanId = localUser.scans[0]?.id;
      if (scanId) markScanUnsynced(scanId);
    }

    if (res && typeof res.creditedCents === "number") creditedCents = res.creditedCents;
    if (res && typeof res.bonusRemaining === "number") bonusRemaining = res.bonusRemaining;
  }

  return { user: localUser, creditedCents, bonusRemaining, refused: false };
}

// ── Routes ──

export async function getRoutesApi(): Promise<Route[]> {
  const routes = await apiFetch<Route[]>("/api/routes");
  return routes || getLocalRoutes();
}

export async function getPendingRoutesApi(): Promise<Route[]> {
  const routes = await apiFetch<Route[]>("/api/routes?status=pending");
  return routes || getLocalPendingRoutes();
}

export async function getActiveRouteApi(): Promise<Route | null> {
  const routes = await apiFetch<Route[]>("/api/routes?status=claimed") || [];
  if (routes.length > 0) return routes[0];

  const inProgress = await apiFetch<Route[]>("/api/routes?status=in_progress") || [];
  if (inProgress.length > 0) return inProgress[0];

  const atDepot = await apiFetch<Route[]>("/api/routes?status=at_depot") || [];
  if (atDepot.length > 0) return atDepot[0];

  return getLocalActiveRoute();
}

export async function claimRouteApi(routeId: string): Promise<void> {
  const userId = getStoredUserId();
  if (userId) {
    await apiFetch(`/api/routes/${routeId}/claim`, {
      method: "POST",
      body: JSON.stringify({ driverId: userId }),
    });
  }
}

export async function startRouteApi(routeId: string): Promise<void> {
  await apiFetch(`/api/routes/${routeId}/start`, { method: "POST" });
}

export async function pickupStopApi(routeId: string, stopId: string, actualCount: number): Promise<void> {
  await apiFetch(`/api/routes/${routeId}/stops/${stopId}/pickup`, {
    method: "POST",
    body: JSON.stringify({ actualCount }),
  });
}

export async function skipStopApi(routeId: string, stopId: string): Promise<void> {
  await apiFetch(`/api/routes/${routeId}/stops/${stopId}/skip`, { method: "POST" });
}

export async function settleRouteApi(routeId: string): Promise<{ driverPayout: number; totalCollected: number } | null> {
  return apiFetch(`/api/routes/${routeId}/settle`, { method: "POST" });
}

// ── Depots ──

export async function getDepotsApi(): Promise<Depot[]> {
  const depots = await apiFetch<Depot[]>("/api/depots");
  return depots || getLocalDepots();
}

// ── Bins ──

export async function getBinsApi(): Promise<SortBin[]> {
  const bins = await apiFetch<SortBin[]>("/api/bins");
  return bins || [];
}

export async function getBinByCodeApi(code: string): Promise<SortBin | null> {
  return apiFetch<SortBin>(`/api/bins/code/${code}`);
}

// ── Health ──

export async function isApiAvailable(): Promise<boolean> {
  const result = await apiFetch<{ status: string }>("/api/health");
  return result?.status === "healthy";
}
