// The Good Sort — Household + Route-Optimized Collection Model
// localStorage-based state management for MVP

// ── Material Types (MVP: aluminium only) ──

export type MaterialType = "aluminium";

export interface MaterialBreakdown {
  aluminium: number;
}

// ── Core Interfaces ──

export interface User {
  id: string;
  name: string;
  householdId: string;
  role: "sorter" | "driver" | "both";
  pendingCents: number;
  clearedCents: number;
  totalContainers: number;
  totalCO2SavedKg: number;
  scans: ScanRecord[];
  collections: CollectionRecord[];
  badges: string[];
  createdAt: string;
}

export interface ScanRecord {
  id: string;
  barcode: string;
  containerName: string;
  material: string;
  refundCents: number;
  status: "pending" | "in_route" | "settled";
  householdId: string;
  routeId: string | null;
  timestamp: string;
}

export interface Household {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  pendingContainers: number;
  pendingValueCents: number;
  materials: MaterialBreakdown;
  estimatedWeightKg: number;
  estimatedBags: number;
  lastScanAt: string | null;
  createdAt: string;
}

export type RouteStatus = "pending" | "claimed" | "in_progress" | "at_depot" | "settled" | "cancelled";

export interface Route {
  id: string;
  status: RouteStatus;
  stops: RouteStop[];
  driverId: string | null;
  claimedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  settledAt: string | null;
  totalContainers: number;
  totalWeightKg: number;
  totalValueCents: number;
  driverPayoutCents: number;
  estimatedDurationMin: number;
  estimatedDistanceKm: number;
  depotId: string;
  createdAt: string;
}

export interface RouteStop {
  id: string;
  householdId: string;
  householdName: string;
  address: string;
  lat: number;
  lng: number;
  containerCount: number;
  estimatedBags: number;
  materials: MaterialBreakdown;
  status: "pending" | "picked_up" | "skipped";
  pickedUpAt: string | null;
  actualContainerCount: number | null;
  sequence: number;
}

export interface CollectionRecord {
  id: string;
  routeId: string;
  stopCount: number;
  totalContainers: number;
  earnedCents: number;
  depotName: string;
  timestamp: string;
}

export interface Depot {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

// ── Constants ──

const CONTAINERS_PER_BAG = 150;
export const SORTER_PAYOUT_CENTS = 10;
export const DRIVER_BASE_PAYOUT_CENTS = 2000; // $20 base
export const DRIVER_PER_CONTAINER_CENTS = 2;
const CO2_PER_CONTAINER_KG = 0.035;

export { CONTAINERS_PER_BAG };

const DATA_VERSION = "v4";

const STORAGE_KEYS = {
  user: "goodsort_user",
  households: `goodsort_households_${DATA_VERSION}`,
  routes: `goodsort_routes_${DATA_VERSION}`,
  depots: `goodsort_depots_${DATA_VERSION}`,
};

// ── Material Constants (MVP: aluminium only) ──

export const CAN_WEIGHT_G = 14; // grams per 375ml aluminium can
export const ALUMINIUM_VALUE_CENTS_PER_KG = 250; // ~$2.50/kg recycler value

export const MATERIAL_LABELS: Record<MaterialType, string> = {
  aluminium: "Aluminium Cans",
};

// ── Material Helpers ──

export function emptyMaterials(): MaterialBreakdown {
  return { aluminium: 0 };
}

export function calcWeightKg(containers: number): number {
  return Math.round((containers * CAN_WEIGHT_G) / 100) / 10;
}

export function calcRecyclerValueCents(containers: number): number {
  const weightKg = (containers * CAN_WEIGHT_G) / 1000;
  return Math.round(weightKg * ALUMINIUM_VALUE_CENTS_PER_KG);
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function getVolumeColor(containers: number): string {
  if (containers >= 150) return "bg-red-500";
  if (containers >= 50) return "bg-amber-500";
  return "bg-green-500";
}

export function getVolumeTextColor(containers: number): string {
  if (containers >= 150) return "text-red-500";
  if (containers >= 50) return "text-amber-500";
  return "text-green-500";
}

// ── User Management ──

export function getUser(): User | null {
  if (typeof window === "undefined") return null;
  const data = localStorage.getItem(STORAGE_KEYS.user);
  return data ? JSON.parse(data) : null;
}

export function createUser(name: string, householdId: string): User {
  const user: User = {
    id: crypto.randomUUID(),
    name,
    householdId,
    role: "sorter",
    pendingCents: 0,
    clearedCents: 0,
    totalContainers: 0,
    totalCO2SavedKg: 0,
    scans: [],
    collections: [],
    badges: [],
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
  return user;
}

export function getOrCreateDefaultUser(): User {
  const existing = getUser();
  if (existing) return existing;
  const households = getHouseholds();
  return createUser("You", households[0]?.id || "h1");
}

function saveUser(user: User) {
  localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
}

// ── Household Management ──

export function getHouseholds(): Household[] {
  if (typeof window === "undefined") return [];
  const data = localStorage.getItem(STORAGE_KEYS.households);
  if (data) return JSON.parse(data);

  // Demo seed: 18 households in South Brisbane / West End area
  const demo: Household[] = [
    makeHousehold("h1", "The Hartleys", "45 Boundary St, South Brisbane", -27.4820, 153.0210, 320),
    makeHousehold("h2", "Unit 4/12 Grey St", "12 Grey St, South Bank", -27.4780, 153.0180, 180),
    makeHousehold("h3", "Sarah's Place", "88 Melbourne St, South Brisbane", -27.4750, 153.0250, 240),
    makeHousehold("h4", "The Nguyens", "21 Vulture St, West End", -27.4850, 153.0130, 290),
    makeHousehold("h5", "Unit 7 River View", "150 Montague Rd, West End", -27.4790, 153.0080, 160),
    makeHousehold("h6", "Casa Martinez", "33 Hardgrave Rd, West End", -27.4830, 153.0050, 210),
    makeHousehold("h7", "The Johnsons", "5 Sidon St, South Brisbane", -27.4760, 153.0220, 130),
    makeHousehold("h8", "Apt 2B Riverside", "77 Ernest St, South Brisbane", -27.4740, 153.0190, 95),
    makeHousehold("h9", "The Patels", "44 Fish Lane, South Brisbane", -27.4810, 153.0240, 270),
    makeHousehold("h10", "Brook House", "19 Browning St, West End", -27.4870, 153.0100, 185),
    makeHousehold("h11", "Unit 12 SkyTower", "100 Manning St, South Brisbane", -27.4800, 153.0160, 110),
    makeHousehold("h12", "The O'Briens", "8 Jane St, West End", -27.4860, 153.0070, 340),
    makeHousehold("h13", "Li Family", "62 Merivale St, South Brisbane", -27.4770, 153.0200, 75),
    makeHousehold("h14", "The Wilsons", "28 Russell St, South Brisbane", -27.4790, 153.0270, 200),
    makeHousehold("h15", "Flat 3 The Terrace", "15 Cordelia St, South Brisbane", -27.4815, 153.0175, 155),
    makeHousehold("h16", "Sunny Side", "41 Tribune St, South Brisbane", -27.4835, 153.0205, 88),
    makeHousehold("h17", "The Cooks", "7 Dock St, West End", -27.4880, 153.0120, 225),
    makeHousehold("h18", "River's Edge", "55 Kurilpa St, West End", -27.4845, 153.0145, 190),
  ];

  localStorage.setItem(STORAGE_KEYS.households, JSON.stringify(demo));
  return demo;
}

function makeHousehold(id: string, name: string, address: string, lat: number, lng: number, containers: number): Household {
  return {
    id,
    name,
    address,
    lat,
    lng,
    pendingContainers: containers,
    pendingValueCents: containers * SORTER_PAYOUT_CENTS,
    materials: { aluminium: containers },
    estimatedWeightKg: calcWeightKg(containers),
    estimatedBags: Math.ceil(containers / CONTAINERS_PER_BAG),
    lastScanAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function saveHouseholds(households: Household[]) {
  localStorage.setItem(STORAGE_KEYS.households, JSON.stringify(households));
}

export function getHouseholdById(id: string): Household | null {
  return getHouseholds().find((h) => h.id === id) || null;
}

// ── Scanning ──

export function addScan(barcode: string, containerName: string, material: string): User {
  const user = getUser();
  if (!user) throw new Error("No user found");

  const scan: ScanRecord = {
    id: crypto.randomUUID(),
    barcode,
    containerName,
    material,
    refundCents: SORTER_PAYOUT_CENTS,
    status: "pending",
    householdId: user.householdId,
    routeId: null,
    timestamp: new Date().toISOString(),
  };

  user.scans.unshift(scan);
  user.pendingCents += SORTER_PAYOUT_CENTS;
  user.totalContainers += 1;
  user.totalCO2SavedKg += CO2_PER_CONTAINER_KG;
  saveUser(user);

  // Update household
  const households = getHouseholds();
  const household = households.find((h) => h.id === user.householdId);
  if (household) {
    household.pendingContainers += 1;
    household.pendingValueCents += SORTER_PAYOUT_CENTS;
    if (!household.materials) household.materials = emptyMaterials();
    household.materials.aluminium += 1;
    household.estimatedWeightKg = calcWeightKg(household.pendingContainers);
    household.estimatedBags = Math.ceil(household.pendingContainers / CONTAINERS_PER_BAG);
    household.lastScanAt = new Date().toISOString();
    saveHouseholds(households);
  }

  return user;
}

// ── Depots ──

export function getDepots(): Depot[] {
  if (typeof window === "undefined") return [];
  const data = localStorage.getItem(STORAGE_KEYS.depots);
  if (data) return JSON.parse(data);

  const demo: Depot[] = [
    { id: "depot-1", name: "Tomra South Brisbane", address: "201 Montague Rd, West End", lat: -27.4790, lng: 153.0080 },
  ];
  localStorage.setItem(STORAGE_KEYS.depots, JSON.stringify(demo));
  return demo;
}

// ── Routes ──

export function getRoutes(): Route[] {
  if (typeof window === "undefined") return [];
  const data = localStorage.getItem(STORAGE_KEYS.routes);
  if (data) return JSON.parse(data);
  return [];
}

export function saveRoutes(routes: Route[]) {
  localStorage.setItem(STORAGE_KEYS.routes, JSON.stringify(routes));
}

export function getRouteById(id: string): Route | null {
  return getRoutes().find((r) => r.id === id) || null;
}

export function getPendingRoutes(): Route[] {
  return getRoutes().filter((r) => r.status === "pending");
}

export function getActiveRoute(): Route | null {
  return getRoutes().find((r) => r.status === "claimed" || r.status === "in_progress" || r.status === "at_depot") || null;
}

export function calcDriverPayout(containers: number): number {
  return DRIVER_BASE_PAYOUT_CENTS + containers * DRIVER_PER_CONTAINER_CENTS;
}

// ── Badges ──

export const BADGE_INFO: Record<string, { name: string; description: string; icon: string }> = {
  first_scan: { name: "First Scan", description: "Scanned your first container", icon: "📱" },
  hundred_club: { name: "100 Club", description: "Scanned 100 containers", icon: "💯" },
  first_collection: { name: "First Collection", description: "Completed your first route", icon: "🚛" },
  eco_warrior: { name: "Eco Warrior", description: "Saved 10kg of CO2", icon: "🌍" },
};
