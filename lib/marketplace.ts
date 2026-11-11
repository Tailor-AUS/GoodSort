// The Good Sort — Runner Marketplace Types
// Dynamic pricing + gamification for collection runners

import type { MaterialBreakdown } from "./store.ts";

// ── Runner Profile ──

export type VehicleType = "car" | "bike" | "walk";
export type RunnerLevel = "bronze" | "silver" | "gold" | "platinum";

export interface RunnerProfile {
  id: string;
  profileId: string;
  vehicleType: VehicleType;
  capacityBags: number;
  serviceRadiusKm: number;
  coexSchemeId?: string | null;
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
    label: "Aluminium Cans",
    shortLabel: "Aluminium",
    rule: "Uncrushed 150mL–3L drink cans, empty, barcodes readable.",
    badgeBg: "bg-sky-100",
    badgeText: "text-sky-800",
    accentHex: "#0369a1",
  },
  pet_clear: {
    codePrefix: "CLR",
    label: "Clear PET Plastic",
    shortLabel: "Clear PET",
    rule: "Clear water & soft-drink PET bottles, lids off, uncrushed.",
    badgeBg: "bg-emerald-100",
    badgeText: "text-emerald-800",
    accentHex: "#047857",
  },
  pet_coloured: {
    codePrefix: "COL",
    label: "Coloured PET / HDPE / LPB",
    shortLabel: "Coloured / Other",
    rule: "Sprite/juice/flavoured milk HDPE & poppers, empty, lids off.",
    badgeBg: "bg-amber-100",
    badgeText: "text-amber-800",
    accentHex: "#b45309",
  },
  glass: {
    codePrefix: "GLS",
    label: "Glass Bottles",
    shortLabel: "Glass",
    rule: "Intact beer/cider/drink bottles (no wine/spirits, no broken glass).",
    badgeBg: "bg-purple-100",
    badgeText: "text-purple-800",
    accentHex: "#7e22ce",
  },
};

export const DISCREPANCY_OPTIONS: Array<{ value: DiscrepancyCode; label: string }> = [
  { value: "none", label: "Clean Secondary-Sorted Bag (No Issues)" },
  { value: "short_count", label: "Short Count (fewer containers than declared)" },
  { value: "extra_untagged", label: "Extra Untagged Containers at Kerb" },
  { value: "mixed_streams", label: "Mixed Streams in Same Bag" },
  { value: "crushed_or_ineligible", label: "Crushed / Wine / Milk Ineligible Items" },
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
