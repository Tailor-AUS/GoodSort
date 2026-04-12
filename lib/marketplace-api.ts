// The Good Sort — Marketplace API Client
// All runner marketplace, gamification, and pricing API calls

import { apiUrl } from "./config";
import type {
  RunnerProfile,
  MarketplaceRun,
  RunDetail,
  RunnerEarnings,
  LeaderboardEntry,
  PricingResult,
} from "./marketplace";

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
    const raw = localStorage.getItem("goodsort_user");
    if (!raw) return null;
    return JSON.parse(raw)?.id ?? null;
  } catch {
    return null;
  }
}

// ── Runner Profile ──

export async function registerAsRunner(
  profileId: string,
  vehicleType?: string,
  capacityBags?: number,
  serviceRadiusKm?: number
): Promise<RunnerProfile | null> {
  return apiFetch<RunnerProfile>("/api/runner/register", {
    method: "POST",
    body: JSON.stringify({ profileId, vehicleType, capacityBags, serviceRadiusKm }),
  });
}

export async function getRunnerProfile(profileId?: string): Promise<RunnerProfile | null> {
  const id = profileId ?? getStoredUserId();
  if (!id) return null;
  return apiFetch<RunnerProfile>(`/api/runner/profile/${id}`);
}

export async function updateRunnerProfile(
  profileId: string,
  updates: { vehicleType?: string; capacityBags?: number; serviceRadiusKm?: number }
): Promise<RunnerProfile | null> {
  return apiFetch<RunnerProfile>(`/api/runner/profile/${profileId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

// ── Location Heartbeat ──

export async function sendHeartbeat(lat: number, lng: number, isOnline: boolean): Promise<boolean> {
  const profileId = getStoredUserId();
  if (!profileId) return false;
  const result = await apiFetch<{ online: boolean }>("/api/runner/heartbeat", {
    method: "POST",
    body: JSON.stringify({ profileId, lat, lng, isOnline }),
  });
  return result !== null;
}

// ── Marketplace ──

export async function getAvailableRuns(lat: number, lng: number, radiusKm?: number): Promise<MarketplaceRun[]> {
  const params = new URLSearchParams({ lat: lat.toString(), lng: lng.toString() });
  if (radiusKm) params.set("radiusKm", radiusKm.toString());
  return (await apiFetch<MarketplaceRun[]>(`/api/marketplace/runs?${params}`)) ?? [];
}

export async function claimRun(runId: string): Promise<RunDetail | null> {
  const profileId = getStoredUserId();
  if (!profileId) return null;
  return apiFetch<RunDetail>(`/api/marketplace/runs/${runId}/claim`, {
    method: "POST",
    body: JSON.stringify({ profileId }),
  });
}

export async function startRun(runId: string): Promise<RunDetail | null> {
  return apiFetch<RunDetail>(`/api/marketplace/runs/${runId}/start`, {
    method: "POST",
  });
}

export async function arriveAtStop(runId: string, stopId: string): Promise<unknown> {
  return apiFetch(`/api/marketplace/runs/${runId}/stops/${stopId}/arrive`, {
    method: "POST",
  });
}

export async function pickupStop(
  runId: string,
  stopId: string,
  actualContainers: number,
  photoUrl?: string
): Promise<RunDetail | null> {
  return apiFetch<RunDetail>(`/api/marketplace/runs/${runId}/stops/${stopId}/pickup`, {
    method: "POST",
    body: JSON.stringify({ actualContainers, photoUrl }),
  });
}

export async function skipStop(runId: string, stopId: string): Promise<RunDetail | null> {
  return apiFetch<RunDetail>(`/api/marketplace/runs/${runId}/stops/${stopId}/skip`, {
    method: "POST",
  });
}

export async function deliverRun(runId: string): Promise<RunDetail | null> {
  return apiFetch<RunDetail>(`/api/marketplace/runs/${runId}/deliver`, {
    method: "POST",
  });
}

export async function completeRun(runId: string): Promise<RunDetail | null> {
  return apiFetch<RunDetail>(`/api/marketplace/runs/${runId}/complete`, {
    method: "POST",
  });
}

// ── Runner's Runs ──

export async function getMyRuns(status?: string): Promise<RunDetail[]> {
  const profileId = getStoredUserId();
  if (!profileId) return [];
  const params = status ? `?status=${status}` : "";
  return (await apiFetch<RunDetail[]>(`/api/runner/runs/${profileId}${params}`)) ?? [];
}

export async function getActiveRun(): Promise<RunDetail | null> {
  const profileId = getStoredUserId();
  if (!profileId) return null;
  return apiFetch<RunDetail>(`/api/runner/active/${profileId}`);
}

// ── Gamification ──

export async function getRunnerEarnings(): Promise<RunnerEarnings | null> {
  const profileId = getStoredUserId();
  if (!profileId) return null;
  return apiFetch<RunnerEarnings>(`/api/runner/earnings/${profileId}`);
}

export async function getLeaderboard(period?: string, limit?: number): Promise<LeaderboardEntry[]> {
  const params = new URLSearchParams();
  if (period) params.set("period", period);
  if (limit) params.set("limit", limit.toString());
  return (await apiFetch<LeaderboardEntry[]>(`/api/runner/leaderboard?${params}`)) ?? [];
}

// ── Admin: Pricing ──

export async function simulatePricing(
  containers: number,
  distanceKm: number,
  stopCount: number
): Promise<PricingResult | null> {
  return apiFetch<PricingResult>("/api/admin/pricing/simulate", {
    method: "POST",
    body: JSON.stringify({ containers, distanceKm, stopCount }),
  });
}
