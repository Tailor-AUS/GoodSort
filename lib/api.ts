// API client — calls .NET Aspire backend
// Falls back to localStorage when API is not available (dev without backend)

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T | null> {
  if (!API_URL) return null; // No API configured — fallback to localStorage
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // API unreachable — fallback
  }
}

// ── Households ──

export async function fetchHouseholds() {
  return apiFetch<Array<{
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    pendingContainers: number;
    pendingValueCents: number;
    materials: { aluminium: number; pet: number; glass: number; other: number };
    estimatedWeightKg: number;
    estimatedBags: number;
    lastScanAt: string | null;
  }>>("/api/households");
}

export async function createHousehold(data: {
  name: string;
  address: string;
  lat: number;
  lng: number;
}) {
  return apiFetch<{ id: string }>("/api/households", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ── Profiles ──

export async function fetchProfile(id: string) {
  return apiFetch<{
    id: string;
    name: string;
    householdId: string;
    pendingCents: number;
    clearedCents: number;
    totalContainers: number;
    totalCo2SavedKg: number;
    badges: string[];
  }>(`/api/profiles/${id}`);
}

// ── Scans ──

export async function submitScan(userId: string, barcode: string, containerName: string, material: string) {
  return apiFetch<{
    id: string;
    pendingCents: number;
    totalContainers: number;
  }>("/api/scans", {
    method: "POST",
    body: JSON.stringify({ userId, barcode, containerName, material }),
  });
}

export async function fetchScans(userId: string, limit = 20) {
  return apiFetch<Array<{
    id: string;
    barcode: string;
    containerName: string;
    material: string;
    refundCents: number;
    status: string;
    createdAt: string;
  }>>(`/api/scans?userId=${userId}&limit=${limit}`);
}

// ── Routes ──

export async function fetchRoutes(status?: string) {
  const query = status ? `?status=${status}` : "";
  return apiFetch<Array<{
    id: string;
    status: string;
    stops: Array<{
      id: string;
      householdId: string;
      householdName: string;
      address: string;
      lat: number;
      lng: number;
      containerCount: number;
      estimatedBags: number;
      status: string;
      actualContainerCount: number | null;
      sequence: number;
    }>;
    totalContainers: number;
    driverPayoutCents: number;
    estimatedDurationMin: number;
    estimatedDistanceKm: number;
  }>>(`/api/routes${query}`);
}

export async function claimRouteApi(routeId: string, driverId: string) {
  return apiFetch(`/api/routes/${routeId}/claim`, {
    method: "POST",
    body: JSON.stringify({ driverId }),
  });
}

export async function startRouteApi(routeId: string) {
  return apiFetch(`/api/routes/${routeId}/start`, { method: "POST" });
}

export async function pickupStopApi(routeId: string, stopId: string, actualCount: number) {
  return apiFetch(`/api/routes/${routeId}/stops/${stopId}/pickup`, {
    method: "POST",
    body: JSON.stringify({ actualCount }),
  });
}

export async function skipStopApi(routeId: string, stopId: string) {
  return apiFetch(`/api/routes/${routeId}/stops/${stopId}/skip`, { method: "POST" });
}

export async function settleRouteApi(routeId: string) {
  return apiFetch<{
    id: string;
    driverPayout: number;
    totalCollected: number;
  }>(`/api/routes/${routeId}/settle`, { method: "POST" });
}

// ── Depots ──

export async function fetchDepots() {
  return apiFetch<Array<{
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
  }>>("/api/depots");
}

// ── Health ──

export async function checkApiHealth(): Promise<boolean> {
  if (!API_URL) return false;
  try {
    const res = await fetch(`${API_URL}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}
