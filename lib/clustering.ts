// Household clustering for route generation
import type { Household, Route, RouteStop, Depot } from "./store";
import { calcDriverPayout, CONTAINERS_PER_BAG, SORTER_PAYOUT_CENTS } from "./store";

export const CLUSTER_THRESHOLD_CONTAINERS = 2000;
export const CLUSTER_RADIUS_KM = 3;
const MAX_STOPS_PER_ROUTE = 25;

interface LatLng {
  lat: number;
  lng: number;
}

export interface HouseholdCluster {
  id: string;
  centroid: LatLng;
  households: Household[];
  totalContainers: number;
  totalWeightKg: number;
  totalValueCents: number;
  meetsThreshold: boolean;
  estimatedBags: number;
}

// ── Haversine Distance ──

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ── DBSCAN-like Greedy Clustering ──

export function clusterHouseholds(
  households: Household[],
  radiusKm: number = CLUSTER_RADIUS_KM,
): HouseholdCluster[] {
  const active = households.filter((h) => h.pendingContainers > 0);
  const sorted = [...active].sort((a, b) => b.pendingContainers - a.pendingContainers);
  const visited = new Set<string>();
  const clusters: HouseholdCluster[] = [];

  for (const seed of sorted) {
    if (visited.has(seed.id)) continue;

    // Find all unvisited neighbors within radius
    const neighbors = sorted.filter(
      (h) => !visited.has(h.id) && haversineKm(seed, h) <= radiusKm
    );

    if (neighbors.length === 0) continue;

    // Cap at max stops
    const clusterHouseholds = neighbors.slice(0, MAX_STOPS_PER_ROUTE);
    for (const h of clusterHouseholds) visited.add(h.id);

    const totalContainers = clusterHouseholds.reduce((s, h) => s + h.pendingContainers, 0);
    const totalWeightKg = clusterHouseholds.reduce((s, h) => s + h.estimatedWeightKg, 0);
    const totalValueCents = totalContainers * SORTER_PAYOUT_CENTS;

    const centroid = {
      lat: clusterHouseholds.reduce((s, h) => s + h.lat, 0) / clusterHouseholds.length,
      lng: clusterHouseholds.reduce((s, h) => s + h.lng, 0) / clusterHouseholds.length,
    };

    clusters.push({
      id: `cluster-${clusters.length}`,
      centroid,
      households: clusterHouseholds,
      totalContainers,
      totalWeightKg: Math.round(totalWeightKg * 10) / 10,
      totalValueCents,
      meetsThreshold: totalContainers >= CLUSTER_THRESHOLD_CONTAINERS,
      estimatedBags: Math.ceil(totalContainers / CONTAINERS_PER_BAG),
    });
  }

  return clusters;
}

// ── Route Generation ──

export function getRouteReadyClusters(clusters: HouseholdCluster[]): HouseholdCluster[] {
  return clusters.filter((c) => c.meetsThreshold);
}

export function createRouteFromCluster(cluster: HouseholdCluster, depot: Depot): Route {
  const stops: RouteStop[] = cluster.households.map((h, i) => ({
    id: crypto.randomUUID(),
    householdId: h.id,
    householdName: h.name,
    address: h.address,
    lat: h.lat,
    lng: h.lng,
    containerCount: h.pendingContainers,
    estimatedBags: h.estimatedBags,
    materials: { ...h.materials },
    status: "pending" as const,
    pickedUpAt: null,
    actualContainerCount: null,
    sequence: i,
  }));

  const totalContainers = stops.reduce((s, st) => s + st.containerCount, 0);

  return {
    id: crypto.randomUUID(),
    status: "pending",
    stops,
    driverId: null,
    claimedAt: null,
    startedAt: null,
    completedAt: null,
    settledAt: null,
    totalContainers,
    totalWeightKg: cluster.totalWeightKg,
    totalValueCents: cluster.totalValueCents,
    driverPayoutCents: calcDriverPayout(totalContainers),
    estimatedDurationMin: Math.round(stops.length * 3 + 15), // ~3min/stop + 15min depot
    estimatedDistanceKm: Math.round(cluster.households.length * 0.5 * 10) / 10,
    depotId: depot.id,
    createdAt: new Date().toISOString(),
  };
}
