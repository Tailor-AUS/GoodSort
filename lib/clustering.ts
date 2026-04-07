// Bin clustering for route generation
import type { SortBin, Route, RouteStop, Depot } from "./store";
import { calcDriverPayout, CONTAINERS_PER_BAG, SORTER_PAYOUT_CENTS } from "./store";

export const CLUSTER_THRESHOLD_CONTAINERS = 500; // Lower threshold for bins (not households)
export const CLUSTER_RADIUS_KM = 3;
const MAX_STOPS_PER_ROUTE = 25;

interface LatLng { lat: number; lng: number; }

export interface BinCluster {
  id: string;
  centroid: LatLng;
  bins: SortBin[];
  totalContainers: number;
  totalWeightKg: number;
  totalValueCents: number;
  meetsThreshold: boolean;
  estimatedBags: number;
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function clusterBins(bins: SortBin[], radiusKm: number = CLUSTER_RADIUS_KM): BinCluster[] {
  const active = bins.filter((b) => b.pendingContainers > 0 && b.status !== "disabled" && b.status !== "collected");
  const sorted = [...active].sort((a, b) => b.pendingContainers - a.pendingContainers);
  const visited = new Set<string>();
  const clusters: BinCluster[] = [];

  for (const seed of sorted) {
    if (visited.has(seed.id)) continue;

    const neighbors = sorted.filter((b) => !visited.has(b.id) && haversineKm(seed, b) <= radiusKm);
    if (neighbors.length === 0) continue;

    const clusterBins = neighbors.slice(0, MAX_STOPS_PER_ROUTE);
    for (const b of clusterBins) visited.add(b.id);

    const totalContainers = clusterBins.reduce((s, b) => s + b.pendingContainers, 0);
    const totalWeightKg = clusterBins.reduce((s, b) => s + b.estimatedWeightKg, 0);

    clusters.push({
      id: `cluster-${clusters.length}`,
      centroid: {
        lat: clusterBins.reduce((s, b) => s + b.lat, 0) / clusterBins.length,
        lng: clusterBins.reduce((s, b) => s + b.lng, 0) / clusterBins.length,
      },
      bins: clusterBins,
      totalContainers,
      totalWeightKg: Math.round(totalWeightKg * 10) / 10,
      totalValueCents: totalContainers * SORTER_PAYOUT_CENTS,
      meetsThreshold: totalContainers >= CLUSTER_THRESHOLD_CONTAINERS,
      estimatedBags: Math.ceil(totalContainers / CONTAINERS_PER_BAG),
    });
  }

  return clusters;
}

export function getRouteReadyClusters(clusters: BinCluster[]): BinCluster[] {
  return clusters.filter((c) => c.meetsThreshold);
}

export function createRouteFromCluster(cluster: BinCluster, depot: Depot): Route {
  const stops: RouteStop[] = cluster.bins.map((b, i) => ({
    id: crypto.randomUUID(),
    householdId: b.id, // Using householdId field for binId (backward compat)
    householdName: `${b.name} (${b.code})`,
    address: b.address,
    lat: b.lat,
    lng: b.lng,
    containerCount: b.pendingContainers,
    estimatedBags: Math.ceil(b.pendingContainers / CONTAINERS_PER_BAG),
    materials: { ...b.materials },
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
    estimatedDurationMin: Math.round(stops.length * 3 + 15),
    estimatedDistanceKm: Math.round(cluster.bins.length * 0.5 * 10) / 10,
    depotId: depot.id,
    createdAt: new Date().toISOString(),
  };
}
