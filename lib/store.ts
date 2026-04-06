// Local storage based state management for The Good Sort MVP
// In production, this would be backed by a database

export interface User {
  id: string;
  name: string;
  unit: string;
  buildingId: string;
  role: "sorter" | "runner" | "both";
  pendingCents: number;
  clearedCents: number;
  totalContainers: number;
  totalCO2SavedKg: number;
  scans: ScanRecord[];
  runs: RunRecord[];
  streak: number;
  lastRunDate: string | null;
  badges: string[];
  createdAt: string;
}

export interface ScanRecord {
  id: string;
  barcode: string;
  containerName: string;
  material: string;
  refundCents: number;
  status: "pending" | "cleared";
  binCycleId: string;
  timestamp: string;
}

export interface RunRecord {
  id: string;
  binId: string;
  buildingName: string;
  containerCount: number;
  earnedCents: number;
  weightKg: number;
  timestamp: string;
}

export interface Building {
  id: string;
  name: string;
  address: string;
  totalContainers: number;
  totalResidents: number;
  lat: number;
  lng: number;
  rank?: number;
}

export type BinStatus = "empty" | "filling" | "full" | "claimed" | "collected";

export type MaterialType = "aluminium" | "pet" | "glass" | "hdpe" | "liquid_paperboard";

export interface MaterialBreakdown {
  aluminium: number;
  pet: number;
  glass: number;
  hdpe: number;
  liquid_paperboard: number;
}

export interface Bin {
  id: string;
  buildingId: string;
  buildingName: string;
  address: string;
  lat: number;
  lng: number;
  status: BinStatus;
  containerCount: number;
  materials: MaterialBreakdown;
  estimatedWeightKg: number;
  capacityContainers: number; // max containers (uncrushed)
  capacityLitres: number;
  fillPercent: number; // 0-100
  estimatedValueCents: number; // recycler value based on composition
  cycleId: string; // unique per fill cycle, regenerated on collection
  claimedBy: string | null;
  claimedAt: string | null;
  lastCollectedAt: string | null;
}

// ── Capacity Constants ──
// Based on 240L wheelie bin with uncrushed containers
// Depots reject crushed containers (barcode + shape verification required)

const BIN_CAPACITY_LITRES = 240;

// Uncrushed containers per 240L bin (mixed materials)
const BIN_CAPACITY_CONTAINERS = 350;

// Weight per container by material type (grams)
const MATERIAL_WEIGHT_G: Record<MaterialType, number> = {
  aluminium: 14,
  pet: 25,
  glass: 200,
  hdpe: 30,
  liquid_paperboard: 10,
};

// Recycler commodity value per kg by material type (cents)
const MATERIAL_VALUE_CENTS_PER_KG: Record<MaterialType, number> = {
  aluminium: 250,  // ~$2.50/kg - best value
  pet: 60,         // ~$0.60/kg
  glass: 8,        // ~$0.08/kg - barely worth it by weight
  hdpe: 70,        // ~$0.70/kg
  liquid_paperboard: 15, // ~$0.15/kg
};

// VFM tier labels for UI
export const MATERIAL_VFM: Record<MaterialType, { tier: string; color: string }> = {
  aluminium: { tier: "Elite", color: "text-green-600" },
  pet: { tier: "Good", color: "text-blue-600" },
  hdpe: { tier: "Good", color: "text-blue-600" },
  liquid_paperboard: { tier: "Great", color: "text-green-500" },
  glass: { tier: "Low", color: "text-red-500" },
};

export const MATERIAL_LABELS: Record<MaterialType, string> = {
  aluminium: "Aluminium",
  pet: "PET Plastic",
  glass: "Glass",
  hdpe: "HDPE Plastic",
  liquid_paperboard: "Carton/Popper",
};

// Average weight per container (grams, blended across material types)
const AVG_CONTAINER_WEIGHT_G = 25;

// Bin becomes "full" on the map at this fill %
const FULL_THRESHOLD_PERCENT = 80;

// Runner economics: minimum containers to make a run worthwhile
const MIN_WORTHWHILE_RUN = 200;

export {
  BIN_CAPACITY_LITRES,
  BIN_CAPACITY_CONTAINERS,
  FULL_THRESHOLD_PERCENT,
  MIN_WORTHWHILE_RUN,
};

const STORAGE_KEYS = {
  user: "goodsort_user",
  buildings: "goodsort_buildings",
  bins: "goodsort_bins",
  runnerLeaderboard: "goodsort_runner_leaderboard",
};

// CO2 saved per container (avg across material types, kg)
const CO2_PER_CONTAINER_KG = 0.035;

// Payout split
const SORTER_PAYOUT_CENTS = 10;
const RUNNER_PAYOUT_CENTS = 5;

export { SORTER_PAYOUT_CENTS, RUNNER_PAYOUT_CENTS };

// ── Balance Helpers ──

export function totalBalanceCents(user: User): number {
  return user.pendingCents + user.clearedCents;
}

// ── Capacity Helpers ──

export function calcFillPercent(containerCount: number): number {
  return Math.min(100, Math.round((containerCount / BIN_CAPACITY_CONTAINERS) * 100));
}

export function calcEstimatedWeightKg(containerCount: number): number {
  return Math.round((containerCount * AVG_CONTAINER_WEIGHT_G) / 1000 * 10) / 10;
}

export function calcWeightFromMaterials(materials: MaterialBreakdown): number {
  let totalG = 0;
  for (const mat of Object.keys(materials) as MaterialType[]) {
    totalG += materials[mat] * MATERIAL_WEIGHT_G[mat];
  }
  return Math.round(totalG / 100) / 10; // round to 1 decimal kg
}

export function calcRecyclerValueCents(materials: MaterialBreakdown): number {
  let totalCents = 0;
  for (const mat of Object.keys(materials) as MaterialType[]) {
    const weightKg = (materials[mat] * MATERIAL_WEIGHT_G[mat]) / 1000;
    totalCents += weightKg * MATERIAL_VALUE_CENTS_PER_KG[mat];
  }
  return Math.round(totalCents);
}

export function emptyMaterials(): MaterialBreakdown {
  return { aluminium: 0, pet: 0, glass: 0, hdpe: 0, liquid_paperboard: 0 };
}

export function topMaterial(materials: MaterialBreakdown): MaterialType {
  let top: MaterialType = "aluminium";
  let max = 0;
  for (const mat of Object.keys(materials) as MaterialType[]) {
    if (materials[mat] > max) {
      max = materials[mat];
      top = mat;
    }
  }
  return top;
}

export function calcRunnerPayout(containerCount: number): number {
  return containerCount * RUNNER_PAYOUT_CENTS;
}

export function isRunWorthwhile(containerCount: number): boolean {
  return containerCount >= MIN_WORTHWHILE_RUN;
}

export function getFillColor(percent: number): string {
  if (percent >= 80) return "text-red-500";
  if (percent >= 50) return "text-amber-500";
  return "text-green-500";
}

export function getFillBgColor(percent: number): string {
  if (percent >= 80) return "bg-red-500";
  if (percent >= 50) return "bg-amber-500";
  return "bg-green-500";
}

// ── User Management ──

export function getUser(): User | null {
  if (typeof window === "undefined") return null;
  const data = localStorage.getItem(STORAGE_KEYS.user);
  return data ? JSON.parse(data) : null;
}

export function getOrCreateDefaultUser(): User {
  const existing = getUser();
  if (existing) return existing;
  const buildings = getBuildings();
  return createUser("Sorter", "—", buildings[0]?.id || "b1");
}

export function createUser(name: string, unit: string, buildingId: string): User {
  const user: User = {
    id: crypto.randomUUID(),
    name,
    unit,
    buildingId,
    role: "sorter",
    pendingCents: 0,
    clearedCents: 0,
    totalContainers: 0,
    totalCO2SavedKg: 0,
    scans: [],
    runs: [],
    streak: 0,
    lastRunDate: null,
    badges: [],
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
  return user;
}

export function updateUserRole(role: "sorter" | "runner" | "both"): User {
  const user = getUser();
  if (!user) throw new Error("No user found");
  user.role = role;
  localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
  return user;
}

function saveUser(user: User) {
  localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
}

// ── Sorter: Scan ──

export function addScan(
  barcode: string,
  containerName: string,
  material: string,
): User {
  const user = getUser();
  if (!user) throw new Error("No user found");

  // Get current bin cycle ID
  const bin = getBinForBuilding(user.buildingId);
  const cycleId = bin?.cycleId || crypto.randomUUID();

  const scan: ScanRecord = {
    id: crypto.randomUUID(),
    barcode,
    containerName,
    material,
    refundCents: SORTER_PAYOUT_CENTS,
    status: "pending",
    binCycleId: cycleId,
    timestamp: new Date().toISOString(),
  };

  user.scans.unshift(scan);
  user.pendingCents += SORTER_PAYOUT_CENTS;
  user.totalContainers += 1;
  user.totalCO2SavedKg += CO2_PER_CONTAINER_KG;
  saveUser(user);

  // Update building + bin
  updateBuildingCount(user.buildingId, 1);
  addContainerToBin(user.buildingId, material as MaterialType);

  return user;
}

function updateBuildingCount(buildingId: string, count: number) {
  const buildings = getBuildings();
  const building = buildings.find((b) => b.id === buildingId);
  if (building) {
    building.totalContainers += count;
    localStorage.setItem(STORAGE_KEYS.buildings, JSON.stringify(buildings));
  }
}

// ── Bins ──

function makeBin(b: Building, containerCount: number, status: BinStatus, materials?: MaterialBreakdown): Bin {
  const mats = materials || generateDemoMaterials(containerCount);
  return {
    id: `bin-${b.id}`,
    buildingId: b.id,
    buildingName: b.name,
    address: b.address,
    lat: b.lat,
    lng: b.lng,
    status,
    containerCount,
    materials: mats,
    estimatedWeightKg: calcWeightFromMaterials(mats),
    capacityContainers: BIN_CAPACITY_CONTAINERS,
    capacityLitres: BIN_CAPACITY_LITRES,
    fillPercent: calcFillPercent(containerCount),
    estimatedValueCents: calcRecyclerValueCents(mats),
    cycleId: crypto.randomUUID(),
    claimedBy: null,
    claimedAt: null,
    lastCollectedAt: null,
  };
}

// Generate a realistic material split for demo data
function generateDemoMaterials(total: number): MaterialBreakdown {
  // Typical apartment block: 45% aluminium, 30% PET, 10% glass, 5% HDPE, 10% cartons
  const al = Math.round(total * 0.45);
  const pet = Math.round(total * 0.30);
  const glass = Math.round(total * 0.10);
  const hdpe = Math.round(total * 0.05);
  const lp = total - al - pet - glass - hdpe;
  return { aluminium: al, pet, glass, hdpe, liquid_paperboard: lp };
}

export function getBins(): Bin[] {
  if (typeof window === "undefined") return [];
  const data = localStorage.getItem(STORAGE_KEYS.bins);
  if (data) return JSON.parse(data);

  // Seed with demo bins matching buildings
  const buildings = getBuildings();
  const bins: Bin[] = [
    makeBin(buildings[0], 310, "full"),    // Harbour Towers: 89% full
    makeBin(buildings[1], 140, "filling"), // Pacific Breeze: 40%
    makeBin(buildings[2], 330, "full"),    // The Pinnacle: 94% full
    makeBin(buildings[3], 60, "filling"),  // Coral Gardens: 17%
    makeBin(buildings[4], 290, "full"),    // Skyline: 83% full
  ];

  localStorage.setItem(STORAGE_KEYS.bins, JSON.stringify(bins));
  return bins;
}

function saveBins(bins: Bin[]) {
  localStorage.setItem(STORAGE_KEYS.bins, JSON.stringify(bins));
}

function addContainerToBin(buildingId: string, material: MaterialType) {
  const bins = getBins();
  const bin = bins.find((b) => b.buildingId === buildingId);
  if (!bin) return;

  bin.containerCount += 1;
  if (!bin.materials) bin.materials = emptyMaterials();
  bin.materials[material] = (bin.materials[material] || 0) + 1;
  bin.estimatedWeightKg = calcWeightFromMaterials(bin.materials);
  bin.fillPercent = calcFillPercent(bin.containerCount);
  bin.estimatedValueCents = calcRecyclerValueCents(bin.materials);

  if (bin.fillPercent >= FULL_THRESHOLD_PERCENT && (bin.status === "filling" || bin.status === "empty")) {
    bin.status = "full";
  }
  saveBins(bins);
}

export function getBinForBuilding(buildingId: string): Bin | null {
  const bins = getBins();
  return bins.find((b) => b.buildingId === buildingId) || null;
}

export function getFullBins(): Bin[] {
  return getBins().filter((b) => b.status === "full");
}

export function claimBin(binId: string): Bin | null {
  const user = getUser();
  if (!user) return null;

  const bins = getBins();
  const bin = bins.find((b) => b.id === binId);
  if (!bin || bin.status !== "full") return null;

  bin.status = "claimed";
  bin.claimedBy = user.id;
  bin.claimedAt = new Date().toISOString();
  saveBins(bins);
  return bin;
}

export function completeBinRun(binId: string): { user: User; bin: Bin; settledScans: number } | null {
  const user = getUser();
  if (!user) return null;

  const bins = getBins();
  const bin = bins.find((b) => b.id === binId);
  if (!bin || bin.status !== "claimed" || bin.claimedBy !== user.id) return null;

  const earned = bin.containerCount * RUNNER_PAYOUT_CENTS;

  const run: RunRecord = {
    id: crypto.randomUUID(),
    binId,
    buildingName: bin.buildingName,
    containerCount: bin.containerCount,
    earnedCents: earned,
    weightKg: bin.estimatedWeightKg,
    timestamp: new Date().toISOString(),
  };

  user.runs.unshift(run);
  // Runner payout goes straight to cleared (they did the physical delivery)
  user.clearedCents += earned;
  user.totalContainers += bin.containerCount;
  user.totalCO2SavedKg += bin.containerCount * CO2_PER_CONTAINER_KG;

  // Settlement: clear all pending scans for this bin cycle
  const cycleId = bin.cycleId;
  let settledScans = 0;
  for (const scan of user.scans) {
    if (scan.binCycleId === cycleId && scan.status === "pending") {
      scan.status = "cleared";
      user.pendingCents -= scan.refundCents;
      user.clearedCents += scan.refundCents;
      settledScans++;
    }
  }

  // Update streak
  const today = new Date().toISOString().split("T")[0];
  if (user.lastRunDate) {
    const lastDate = new Date(user.lastRunDate);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (lastDate.toISOString().split("T")[0] === yesterday.toISOString().split("T")[0]) {
      user.streak += 1;
    } else if (user.lastRunDate !== today) {
      user.streak = 1;
    }
  } else {
    user.streak = 1;
  }
  user.lastRunDate = today;

  // Award badges
  if (user.runs.length === 1 && !user.badges.includes("first_run")) {
    user.badges.push("first_run");
  }
  if (user.streak >= 7 && !user.badges.includes("week_warrior")) {
    user.badges.push("week_warrior");
  }
  if (user.runs.length >= 10 && !user.badges.includes("ten_runs")) {
    user.badges.push("ten_runs");
  }
  if (user.runs.length >= 50 && !user.badges.includes("fifty_runs")) {
    user.badges.push("fifty_runs");
  }

  saveUser(user);

  // Reset the bin with a new cycle ID
  bin.status = "empty";
  bin.containerCount = 0;
  bin.materials = emptyMaterials();
  bin.estimatedWeightKg = 0;
  bin.estimatedValueCents = 0;
  bin.fillPercent = 0;
  bin.cycleId = crypto.randomUUID();
  bin.claimedBy = null;
  bin.claimedAt = null;
  bin.lastCollectedAt = new Date().toISOString();
  saveBins(bins);

  updateRunnerLeaderboard(user.id, user.name, run.containerCount, earned);

  return { user, bin, settledScans };
}

export function unclaimBin(binId: string): void {
  const bins = getBins();
  const bin = bins.find((b) => b.id === binId);
  if (!bin || bin.status !== "claimed") return;
  bin.status = "full";
  bin.claimedBy = null;
  bin.claimedAt = null;
  saveBins(bins);
}

// ── Runner Leaderboard ──

export interface RunnerRank {
  userId: string;
  name: string;
  totalRuns: number;
  totalContainers: number;
  totalEarnedCents: number;
  rank: number;
}

function updateRunnerLeaderboard(userId: string, name: string, containers: number, earned: number) {
  const lb = getRunnerLeaderboard();
  const existing = lb.find((r) => r.userId === userId);
  if (existing) {
    existing.totalRuns += 1;
    existing.totalContainers += containers;
    existing.totalEarnedCents += earned;
  } else {
    lb.push({ userId, name, totalRuns: 1, totalContainers: containers, totalEarnedCents: earned, rank: 0 });
  }
  localStorage.setItem(STORAGE_KEYS.runnerLeaderboard, JSON.stringify(lb));
}

export function getRunnerLeaderboard(): RunnerRank[] {
  if (typeof window === "undefined") return [];
  const data = localStorage.getItem(STORAGE_KEYS.runnerLeaderboard);
  if (data) {
    const lb: RunnerRank[] = JSON.parse(data);
    return lb
      .sort((a, b) => b.totalContainers - a.totalContainers)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }

  const demo: RunnerRank[] = [
    { userId: "demo-1", name: "Jake M", totalRuns: 34, totalContainers: 8420, totalEarnedCents: 42100, rank: 1 },
    { userId: "demo-2", name: "Lisa K", totalRuns: 28, totalContainers: 6840, totalEarnedCents: 34200, rank: 2 },
    { userId: "demo-3", name: "Marcus T", totalRuns: 21, totalContainers: 5230, totalEarnedCents: 26150, rank: 3 },
    { userId: "demo-4", name: "Priya S", totalRuns: 15, totalContainers: 3600, totalEarnedCents: 18000, rank: 4 },
  ];
  localStorage.setItem(STORAGE_KEYS.runnerLeaderboard, JSON.stringify(demo));
  return demo;
}

// ── Building Leaderboard ──

export function getBuildings(): Building[] {
  if (typeof window === "undefined") return [];
  const data = localStorage.getItem(STORAGE_KEYS.buildings);
  if (data) return JSON.parse(data);

  const demo: Building[] = [
    { id: "b1", name: "Harbour Towers", address: "12 Marine Pde, Southport", totalContainers: 1847, totalResidents: 48, lat: -27.9670, lng: 153.4000 },
    { id: "b2", name: "Pacific Breeze", address: "88 Surf Parade, Broadbeach", totalContainers: 1523, totalResidents: 36, lat: -28.0268, lng: 153.4315 },
    { id: "b3", name: "The Pinnacle", address: "5 River Dr, Surfers Paradise", totalContainers: 2104, totalResidents: 72, lat: -27.9986, lng: 153.4311 },
    { id: "b4", name: "Coral Gardens", address: "21 Palm Ave, Southport", totalContainers: 892, totalResidents: 24, lat: -27.9730, lng: 153.4100 },
    { id: "b5", name: "Skyline Residences", address: "150 High St, Southport", totalContainers: 1205, totalResidents: 42, lat: -27.9650, lng: 153.3950 },
  ];
  localStorage.setItem(STORAGE_KEYS.buildings, JSON.stringify(demo));
  return demo;
}

export function getLeaderboard(): (Building & { rank: number; perResident: number })[] {
  const buildings = getBuildings();
  return buildings
    .map((b) => ({
      ...b,
      perResident: b.totalResidents > 0 ? Math.round(b.totalContainers / b.totalResidents) : 0,
      rank: 0,
    }))
    .sort((a, b) => b.perResident - a.perResident)
    .map((b, i) => ({ ...b, rank: i + 1 }));
}

// ── Badges ──

export const BADGE_INFO: Record<string, { name: string; description: string; icon: string }> = {
  first_run: { name: "First Run", description: "Completed your first bin pickup", icon: "🏃" },
  week_warrior: { name: "Week Warrior", description: "7-day pickup streak", icon: "🔥" },
  ten_runs: { name: "Ten Timer", description: "Completed 10 bin pickups", icon: "⭐" },
  fifty_runs: { name: "Legend", description: "Completed 50 bin pickups", icon: "👑" },
};

// ── Utilities ──

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
