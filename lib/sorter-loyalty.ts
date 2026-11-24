// Pure loyalty, status-tier, points, streak, and 4-stream calculations for
// the home sorter dashboard. Derived strictly from real scanned containers and
// referral network totals — zero fabricated stats or partner claims.

import type { ScanRecord, User } from "./store.ts";

export type SorterTierId = "bronze" | "silver" | "gold" | "platinum";

export interface SorterTier {
  id: SorterTierId;
  label: string;
  minContainers: number;
  nextTierLabel: string | null;
  nextTierMin: number | null;
  accentHex: string;
  ringFrom: string;
  ringTo: string;
  badgeClass: string;
  headerGradient: string;
  pillClass: string;
  medallionGradient: string;
}

export const SORTER_TIERS: readonly SorterTier[] = [
  {
    id: "bronze",
    label: "Bronze",
    minContainers: 0,
    nextTierLabel: "Silver",
    nextTierMin: 50,
    accentHex: "#b88655",
    ringFrom: "#d9a066",
    ringTo: "#9c6738",
    badgeClass: "bg-amber-500/15 text-amber-800 border-amber-400/35",
    headerGradient: "from-[#c9a27b] via-[#e2ccb4] to-[#f4f5f7]",
    pillClass: "bg-[#b8895a] text-slate-950",
    medallionGradient: "from-[#d4a97d] to-[#9b6c3e]",
  },
  {
    id: "silver",
    label: "Silver",
    minContainers: 50,
    nextTierLabel: "Gold",
    nextTierMin: 250,
    accentHex: "#94a3b8",
    ringFrom: "#e2e8f0",
    ringTo: "#64748b",
    badgeClass: "bg-slate-200/70 text-slate-800 border-slate-300",
    headerGradient: "from-[#b8c2cf] via-[#dce2ea] to-[#f4f5f7]",
    pillClass: "bg-[#aeb8c4] text-slate-950",
    medallionGradient: "from-[#d7dfe9] to-[#8a96a6]",
  },
  {
    id: "gold",
    label: "Gold",
    minContainers: 250,
    nextTierLabel: "Platinum",
    nextTierMin: 1000,
    accentHex: "#c6a866",
    ringFrom: "#e5cb85",
    ringTo: "#a8873c",
    badgeClass: "bg-amber-200/60 text-amber-950 border-amber-400/50",
    headerGradient: "from-[#c7ae72] via-[#e2d3ae] to-[#f4f5f7]",
    pillClass: "bg-[#c5ac72] text-slate-950",
    medallionGradient: "from-[#dec68b] to-[#a78947]",
  },
  {
    id: "platinum",
    label: "Platinum",
    minContainers: 1000,
    nextTierLabel: null,
    nextTierMin: null,
    accentHex: "#475569",
    ringFrom: "#94a3b8",
    ringTo: "#1e293b",
    badgeClass: "bg-slate-800 text-white border-slate-700",
    headerGradient: "from-[#7c8a9e] via-[#c3ccd8] to-[#f4f5f7]",
    pillClass: "bg-[#334155] text-white",
    medallionGradient: "from-[#94a3b8] to-[#334155]",
  },
] as const;

export const POINTS_PER_CONTAINER = 10;

export interface StreamCounts {
  aluminium: number;
  clearPet: number;
  coloured: number;
  glass: number;
}

export interface SorterMilestone {
  id: string;
  label: string;
  targetText: string;
  earned: boolean;
}

export interface SorterLoyaltySummary {
  tier: SorterTier;
  totalContainers: number;
  goodSortPoints: number;
  totalCreditCents: number;
  pendingCents: number;
  clearedCents: number;
  co2SavedKg: number;
  progressPct: number;
  containersToNextTier: number;
  currentStreakDays: number;
  longestStreakDays: number;
  streams: StreamCounts;
  milestones: SorterMilestone[];
}

export function resolveSorterTier(totalContainers: number): SorterTier {
  const n = Math.max(0, Math.floor(totalContainers));
  for (let i = SORTER_TIERS.length - 1; i >= 0; i--) {
    if (n >= SORTER_TIERS[i].minContainers) return SORTER_TIERS[i];
  }
  return SORTER_TIERS[0];
}

/**
 * Maps any scan material string onto the four Brisbane home sorting streams:
 *   aluminium -> Blue Cans (GSB-ALU)
 *   clearPet  -> Teal Clear PET (GSB-CLR)
 *   coloured  -> Amber Coloured PET / HDPE / Poppers / Other (GSB-COL)
 *   glass     -> Green Glass (GSB-GLS)
 */
export function bucketScanMaterial(material: string): keyof StreamCounts {
  const m = (material || "").trim().toLowerCase();
  if (m.includes("alum") || m === "can" || m === "cans" || m === "steel" || m === "metal") {
    return "aluminium";
  }
  if (m === "glass" || m.includes("glass")) {
    return "glass";
  }
  if (m === "pet" || m.includes("clear_pet") || m.includes("clear pet") || m === "plastic") {
    return "clearPet";
  }
  return "coloured";
}

export function countStreamsFromScans(scans: readonly ScanRecord[]): StreamCounts {
  const counts: StreamCounts = { aluminium: 0, clearPet: 0, coloured: 0, glass: 0 };
  for (const s of scans) {
    counts[bucketScanMaterial(s.material)] += 1;
  }
  return counts;
}

/** Convert an ISO timestamp to YYYY-MM-DD in Brisbane local time (UTC+10, no DST). */
export function brisbaneDateKey(isoOrDate: string | Date): string | null {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return null;
  const brisbaneMs = d.getTime() + 10 * 60 * 60 * 1000;
  return new Date(brisbaneMs).toISOString().slice(0, 10);
}

function dayDiff(earlierYmd: string, laterYmd: string): number {
  const a = Date.parse(`${earlierYmd}T00:00:00Z`);
  const b = Date.parse(`${laterYmd}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Computes current and longest consecutive-day scanning streaks in Brisbane time.
 * Current streak stays active if the member scanned today OR yesterday (so a
 * member opening the app in the morning keeps their active streak until midnight).
 */
export function computeScanStreaks(
  scans: readonly ScanRecord[],
  now: Date = new Date(),
): { currentStreakDays: number; longestStreakDays: number } {
  const uniqueDays = new Set<string>();
  for (const s of scans) {
    const key = brisbaneDateKey(s.timestamp);
    if (key) uniqueDays.add(key);
  }
  if (uniqueDays.size === 0) return { currentStreakDays: 0, longestStreakDays: 0 };

  const sorted = Array.from(uniqueDays).sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (dayDiff(sorted[i - 1], sorted[i]) === 1) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }

  const todayKey = brisbaneDateKey(now)!;
  const latest = sorted[sorted.length - 1];
  const gapFromToday = dayDiff(latest, todayKey);
  if (gapFromToday > 1) {
    return { currentStreakDays: 0, longestStreakDays: longest };
  }

  let current = 1;
  for (let i = sorted.length - 1; i > 0; i--) {
    if (dayDiff(sorted[i - 1], sorted[i]) === 1) {
      current += 1;
    } else {
      break;
    }
  }
  return { currentStreakDays: current, longestStreakDays: longest };
}

export function buildSorterLoyaltySummary(
  user: User,
  network?: { sortersCount: number; referredContainers: number; totalNetworkCents: number } | null,
  now: Date = new Date(),
): SorterLoyaltySummary {
  const scans = Array.isArray(user.scans) ? user.scans : [];
  const totalContainers = Math.max(0, user.totalContainers || scans.length);
  const tier = resolveSorterTier(totalContainers);

  const progressPct =
    tier.nextTierMin === null
      ? 100
      : Math.min(
          100,
          Math.max(
            0,
            Math.round(
              ((totalContainers - tier.minContainers) /
                Math.max(1, tier.nextTierMin - tier.minContainers)) *
                100,
            ),
          ),
        );

  const containersToNextTier =
    tier.nextTierMin === null ? 0 : Math.max(0, tier.nextTierMin - totalContainers);

  const pendingCents = Math.max(0, user.pendingCents || 0);
  const clearedCents = Math.max(0, user.clearedCents || 0);
  const referredContainers = Math.max(0, network?.referredContainers || 0);
  const sortersCount = Math.max(0, network?.sortersCount || 0);

  // 10 Good Sort Points per scanned container + 1 bonus point per referred container
  const goodSortPoints = totalContainers * POINTS_PER_CONTAINER + referredContainers;

  const streams = countStreamsFromScans(scans);
  const distinctStreams = Object.values(streams).filter((c) => c > 0).length;
  const { currentStreakDays, longestStreakDays } = computeScanStreaks(scans, now);

  const milestones: SorterMilestone[] = [
    { id: "first_can", label: "First Can", targetText: "1 can", earned: totalContainers >= 1 },
    { id: "ten_club", label: "10 Club", targetText: "10 cans", earned: totalContainers >= 10 },
    { id: "silver_status", label: "Silver Sorter", targetText: "50 cans", earned: totalContainers >= 50 },
    { id: "four_streams", label: "Stream Pro", targetText: "3+ streams", earned: distinctStreams >= 3 },
    { id: "street_captain", label: "Street Captain", targetText: "1 neighbour", earned: sortersCount >= 1 },
    { id: "gold_status", label: "Gold Sorter", targetText: "250 cans", earned: totalContainers >= 250 },
  ];

  return {
    tier,
    totalContainers,
    goodSortPoints,
    totalCreditCents: pendingCents + clearedCents,
    pendingCents,
    clearedCents,
    co2SavedKg: Math.max(0, user.totalCO2SavedKg || 0),
    progressPct,
    containersToNextTier,
    currentStreakDays,
    longestStreakDays,
    streams,
    milestones,
  };
}
