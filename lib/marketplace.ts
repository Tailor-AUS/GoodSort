// The Good Sort — Runner Marketplace Types
// Dynamic pricing + gamification for collection runners

import type { MaterialBreakdown } from "./store";

// ── Runner Profile ──

export type VehicleType = "car" | "bike" | "walk";
export type RunnerLevel = "bronze" | "silver" | "gold" | "platinum";

export interface RunnerProfile {
  id: string;
  profileId: string;
  vehicleType: VehicleType;
  capacityBags: number;
  serviceRadiusKm: number;
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

export interface RunStopDetail {
  id: string;
  runId: string;
  binId: string;
  pickupInstruction: string | null;
  lat: number;
  lng: number;
  estimatedContainers: number;
  actualContainers: number | null;
  materials: MaterialBreakdown | null;
  status: RunStopStatus;
  arrivedAt: string | null;
  pickedUpAt: string | null;
  photoUrl: string | null;
  sequence: number;
}

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
