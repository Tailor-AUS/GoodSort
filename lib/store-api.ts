// API-backed store — calls .NET API on Azure Container Apps
// Falls back to localStorage store when API is unavailable

import { apiUrl } from "./config";
import type { User, Household, Route, Depot, ScanRecord, CollectionRecord } from "./store";
import {
  getUser as getLocalUser,
  getOrCreateDefaultUser as getLocalDefault,
  getHouseholds as getLocalHouseholds,
  getRoutes as getLocalRoutes,
  getDepots as getLocalDepots,
  addScan as addLocalScan,
  getPendingRoutes as getLocalPendingRoutes,
  getActiveRoute as getLocalActiveRoute,
  saveUser as saveLocalUser,
} from "./store";

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
      refundCents: s.refundCents || 10,
      status: s.status as "pending" | "in_route" | "settled",
      householdId: s.householdId,
      routeId: s.routeId,
      timestamp: s.timestamp || new Date().toISOString(),
    })),
    collections: [],
    badges: profile.badges || [],
    createdAt: profile.createdAt,
  };

  // Sync to localStorage for offline
  saveLocalUser(user);
  return user;
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
): Promise<User> {
  const userId = getStoredUserId();

  // Always save locally first (offline-first)
  const localUser = addLocalScan(barcode, containerName, material);

  // Then sync to API
  if (userId) {
    await apiFetch("/api/scans", {
      method: "POST",
      body: JSON.stringify({
        userId,
        barcode,
        containerName,
        material,
      }),
    });
  }

  return localUser;
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

// ── Health ──

export async function isApiAvailable(): Promise<boolean> {
  const result = await apiFetch<{ status: string }>("/api/health");
  return result?.status === "healthy";
}
