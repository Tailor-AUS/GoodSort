// The Good Sort — Runner Marketplace Types
// Dynamic pricing + gamification for collection runners

import type { MaterialBreakdown } from "./store.ts";

// ── Runner Profile ──

export type VehicleType = "car" | "ute" | "bike" | "walk";
export type RunnerLevel = "bronze" | "silver" | "gold" | "platinum";

export interface RunnerProfile {
  id: string;
  profileId: string;
  vehicleType: VehicleType;
  capacityBags: number;
  serviceRadiusKm: number;
  coexSchemeId?: string | null;
  approvalStatus?: "approved" | "pending" | "suspended";
  isOnline: boolean;
  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: string | null;
  rating: number;
  totalRatings: number;
  level: RunnerLevel;
  totalRuns: number;
  totalContainersCollected: number;
  currentStreakDays: number;
  longestStreakDays: number;
  lastRunCompletedAt: string | null;
  efficiencyScore: number;
  badges: string[];
  lifetimeEarningsCents: number;
  createdAt: string;
}

// ── Run (marketplace listing) ──

export type RunStatus = "available" | "claimed" | "in_progress" | "delivering" | "completed" | "settled" | "expired";

export interface MarketplaceRun {
  id: string;
  status: RunStatus;
  areaName: string;
  centroidLat: number;
  centroidLng: number;
  estimatedContainers: number;
  perContainerCents: number;
  estimatedPayoutCents: number;
  pricingTier: number; // 1-5 surge level
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  stopCount: number;
  distanceKm: number; // distance from runner
  expiresAt: string;
  materials: MaterialBreakdown;
}

export interface RunDetail {
  id: string;
  status: RunStatus;
  runnerId: string | null;
  dropPointId: string;
  dropPoint: { id: string; name: string; address: string; lat: number; lng: number } | null;
  centroidLat: number;
  centroidLng: number;
  areaName: string;
  estimatedContainers: number;
  actualContainers: number;
  perContainerCents: number;
  estimatedPayoutCents: number;
  actualPayoutCents: number;
  pricingTier: number;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  materials: MaterialBreakdown;
  depotVerifiedContainers?: number | null;
  coexDocketRef?: string | null;
  expiresAt: string;
  claimedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  deliveredAt: string | null;
  settledAt: string | null;
  createdAt: string;
  stops: RunStopDetail[];
}

// ── Run Stop ──

export type RunStopStatus = "pending" | "arrived" | "picked_up" | "skipped" | "issue_reported";

export type DiscrepancyCode =
  | "none"
  | "short_count"
  | "extra_untagged"
  | "mixed_streams"
  | "crushed_or_ineligible"
  | "bag_missing";

export interface RunStopDetail {
  id: string;
  runId: string;
  binId: string;
  pickupInstruction: string | null;
  lat: number;
  lng: number;
  estimatedContainers: number;
  actualContainers: number | null;
  scannedBagCount?: number;
  contaminationFlag?: boolean;
  discrepancyCode?: DiscrepancyCode | string | null;
  discrepancyNote?: string | null;
  materials: MaterialBreakdown | null;
  status: RunStopStatus;
  arrivedAt: string | null;
  pickedUpAt: string | null;
  photoUrl: string | null;
  sequence: number;
}

// ── 4-Stream Secondary-Sorted QR Bag Tags ──

export type BagStream = "aluminium" | "pet_clear" | "pet_coloured" | "glass";
export type BagStatus = "sealed" | "on_kerb" | "picked_up" | "verified" | "cancelled";

export interface SortedBagDto {
  id: string;
  code: string;
  stream: BagStream;
  declaredContainers: number;
  linkedScanCount: number;
  verifiedContainers?: number | null;
  contaminationFlag?: boolean;
  discrepancyCode?: string | null;
  discrepancyNote?: string | null;
  status: BagStatus;
  createdAt?: string;
  kerbAt?: string | null;
  pickedUpAt?: string | null;
  verifiedAt?: string | null;
}

export interface MyBagsResponse {
  hasHousehold: boolean;
  unbaggedByStream: {
    aluminium: number;
    pet_clear: number;
    pet_coloured: number;
    glass: number;
  };
  bags: SortedBagDto[];
}

export interface StopManifestResponse {
  stopId: string;
  scannedBagCount: number;
  bags: SortedBagDto[];
}

export interface MarketplaceSuburbPool {
  suburb: string;
  centroidLat: number;
  centroidLng: number;
  sortersCount: number;
  pendingContainers: number;
  targetContainers: number;
  progressPct: number;
  bagsSealed: number;
  bagsOnKerb: number;
  readyForRun: boolean;
  estimatedRunnerBountyCents: number;
  estimatedSorterPoolCents: number;
}

export interface MarketplaceOverview {
  crpActive: boolean;
  rateCard: {
    coexGrossCents: number;
    coexRefundCents: number;
    coexHandlingFeeCents: number;
    fullScaleSorterCents: number;
    currentSorterCents: number;
    launchBonusCents: number;
    launchBonusCap: number;
    containerMafiaCents: number;
    runnerTargetCents: number;
  };
  stats: {
    activeSorters: number;
    registeredRunners: number;
    runnersOnline: number;
    totalContainersSorted: number;
    bagsOnKerb: number;
    availableRunsCount: number;
    formingSuburbsCount: number;
  };
  availableRuns: Array<{
    id: string;
    areaName: string;
    centroidLat: number;
    centroidLng: number;
    materialFocus: string;
    estimatedContainers: number;
    estimatedWeightKg: number;
    perContainerCents: number;
    estimatedPayoutCents: number;
    pricingTier: number;
    estimatedDistanceKm: number;
    estimatedDurationMin: number;
    stopCount: number;
    expiresAt: string;
    materials: MaterialBreakdown;
  }>;
  suburbPools: MarketplaceSuburbPool[];
}

export interface RunSettlementResult {
  id: string;
  actualPayoutCents: number;
  actualContainers: number;
  rating: number;
  householdsCredited: number;
  settlementMode: string;
  bagsVerified: number;
  householdPayoutCents: number;
  containerMafiaCents: number;
  grossRevenueDollars: number;
  proFormaCoexGrossDollars: number;
  netMarginDollars: number;
}

export const BAG_STREAMS: Record<
  BagStream,
  {
    codePrefix: string;
    bagName: string;
    label: string;
    shortLabel: string;
    rule: string;
    badgeBg: string;
    badgeText: string;
    accentHex: string;
  }
> = {
  aluminium: {
    codePrefix: "ALU",
    bagName: "Blue Bag",
    label: "Aluminium Cans",
    shortLabel: "Aluminium",
    rule: "Empty drink cans (150mL–3L), uncrushed so barcodes stay readable.",
    badgeBg: "bg-blue-100",
    badgeText: "text-blue-800",
    accentHex: "#1d4ed8",
  },
  pet_clear: {
    codePrefix: "CLR",
    bagName: "Teal Bag",
    label: "Clear Plastic Bottles",
    shortLabel: "Clear Plastic",
    rule: "Clear water and soft-drink plastic bottles (150mL–3L), empty, lids off.",
    badgeBg: "bg-teal-100",
    badgeText: "text-teal-800",
    accentHex: "#0f766e",
  },
  pet_coloured: {
    codePrefix: "COL",
    bagName: "Amber Bag",
    label: "Coloured Plastic & Poppers",
    shortLabel: "Coloured / Poppers",
    rule: "Coloured plastic drink bottles, flavoured milk & juice poppers (150mL–3L), empty, lids off.",
    badgeBg: "bg-amber-100",
    badgeText: "text-amber-800",
    accentHex: "#b45309",
  },
  glass: {
    codePrefix: "GLS",
    bagName: "Green Bag",
    label: "Glass Bottles",
    shortLabel: "Glass",
    rule: "Unbroken beer, cider, wine, spirit & soft-drink glass bottles (150mL–3L, lids off).",
    badgeBg: "bg-emerald-100",
    badgeText: "text-emerald-800",
    accentHex: "#047857",
  },
};

export function streamKeyForMaterial(material: string | undefined | null, itemName?: string | null): BagStream {
  const mat = (material ?? "").trim().toLowerCase();
  const desc = (itemName ?? "").trim().toLowerCase();
  if (mat === "aluminium" || mat === "aluminum" || mat === "alu" || mat === "can" || mat === "cans") {
    return "aluminium";
  }
  if (mat.startsWith("glass")) {
    return "glass";
  }
  if (mat === "pet_coloured" || mat === "pet_colored" || mat === "coloured_pet") {
    return "pet_coloured";
  }
  if (mat === "pet" || mat === "pet_clear" || mat === "clear_pet" || mat === "plastic") {
    if (
      desc.includes("coloured") ||
      desc.includes("colored") ||
      desc.includes("tinted") ||
      desc.includes("sprite") ||
      desc.includes("mountain dew")
    ) {
      return "pet_coloured";
    }
    return "pet_clear";
  }
  return "pet_coloured";
}

export function streamGuideForMaterial(material: string | undefined | null, itemName?: string | null) {
  const stream = streamKeyForMaterial(material, itemName);
  return { stream, ...BAG_STREAMS[stream] };
}

/**
 * Privacy-safe approximate container volume label for suburb map bubbles.
 * Communicates neighbourhood momentum without exposing exact single-home counts.
 */
export function formatVagueContainerBand(count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (n === 0) return "Starting";
  if (n < 10) return "< 10 cans";
  if (n < 25) return "~10+ cans";
  if (n < 50) return "~25+ cans";
  if (n < 100) return "~50+ cans";
  if (n < 250) return "~100+ cans";
  if (n < 500) return "~250+ cans";
  if (n < 750) return "~500+ cans";
  if (n < 1000) return "~750+ cans";
  return "1,000+ ready";
}

export const DISCREPANCY_OPTIONS: Array<{ value: DiscrepancyCode; label: string }> = [
  { value: "none", label: "Clean sorted bag (no issues)" },
  { value: "short_count", label: "Short Count (fewer containers than declared)" },
  { value: "extra_untagged", label: "Extra Untagged Containers at Kerb" },
  { value: "mixed_streams", label: "Mixed Streams in Same Bag" },
  { value: "crushed_or_ineligible", label: "Crushed / Plain Milk / Ineligible Items" },
  { value: "bag_missing", label: "Tagged Bag Missing at Kerb" },
];

// ── Gamification ──

export interface RunnerEarnings {
  lifetimeEarningsCents: number;
  todayEarnings: number;
  weekEarnings: number;
  totalRuns: number;
  totalContainersCollected: number;
  rating: number;
  level: RunnerLevel;
  currentStreakDays: number;
  longestStreakDays: number;
  efficiencyScore: number;
  badges: string[];
}

export interface LeaderboardEntry {
  rank: number;
  runnerId: string;
  name: string;
  level: RunnerLevel;
  totalContainers: number;
  totalRuns: number;
  rating: number;
  efficiencyScore: number;
}

// ── Pricing ──

export interface PricingResult {
  perContainerCents: number;
  pricingTier: number;
  estimatedPayoutCents: number;
  factors: {
    distanceEfficiency: number;
    binDensity: number;
    supplyDemand: number;
    timeOfDay: number;
    materialMix: number;
    scrapPrice: number;
    weightedMultiplier: number;
    levelBonus: number;
  };
}

// ── Badge Definitions ──

export const BADGE_INFO: Record<string, { label: string; icon: string; description: string }> = {
  first_run: { label: "First Run", icon: "🎉", description: "Completed your first collection run" },
  ten_runs: { label: "10 Runs", icon: "🔟", description: "Completed 10 collection runs" },
  fifty_runs: { label: "50 Runs", icon: "⭐", description: "Completed 50 collection runs" },
  century_runner: { label: "Century", icon: "💯", description: "Completed 100 collection runs" },
  "1k_containers": { label: "1K Collected", icon: "📦", description: "Collected 1,000 containers" },
  "5k_containers": { label: "5K Collected", icon: "🏆", description: "Collected 5,000 containers" },
  week_streak: { label: "Week Streak", icon: "🔥", description: "7-day collection streak" },
  month_streak: { label: "Month Streak", icon: "💪", description: "30-day collection streak" },
  speed_demon: { label: "Speed Demon", icon: "⚡", description: "Completed a run 25% faster than estimated" },
  early_bird: { label: "Early Bird", icon: "🌅", description: "Started a run before 7am" },
  perfect_run: { label: "Perfect Run", icon: "✨", description: "5-star rating on a run" },
};

// ── Level Thresholds ──

export const LEVEL_INFO: Record<RunnerLevel, { label: string; color: string; bgColor: string; minRuns: number; minRating: number; bonus: number }> = {
  bronze: { label: "Bronze", color: "text-amber-700", bgColor: "bg-amber-100", minRuns: 0, minRating: 0, bonus: 0 },
  silver: { label: "Silver", color: "text-slate-500", bgColor: "bg-slate-100", minRuns: 20, minRating: 4.0, bonus: 0 },
  gold: { label: "Gold", color: "text-yellow-600", bgColor: "bg-yellow-100", minRuns: 100, minRating: 4.3, bonus: 1 },
  platinum: { label: "Platinum", color: "text-purple-600", bgColor: "bg-purple-100", minRuns: 500, minRating: 4.6, bonus: 2 },
};

// ── Pricing Tier Labels ──

export const PRICING_TIER_INFO: Record<number, { label: string; color: string }> = {
  1: { label: "Standard", color: "text-slate-600" },
  2: { label: "Fair", color: "text-blue-600" },
  3: { label: "Good", color: "text-green-600" },
  4: { label: "High", color: "text-amber-600" },
  5: { label: "Surge", color: "text-red-600" },
};
