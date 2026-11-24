"use client";

import { useEffect, useState } from "react";
import { Award, CheckCircle2, Flame, Leaf, Plane, Sparkles, Users, Wallet } from "lucide-react";
import { formatCents, type User } from "@/lib/store";
import { formatCredit } from "@/lib/credit";
import { track } from "@/lib/analytics";
import { buildSorterLoyaltySummary } from "@/lib/sorter-loyalty";

const POINTS_INTEREST_KEY = "goodsort_points_swap_interest";

interface MemberStatusCardProps {
  user: User;
  suburbLabel: string | null;
  network: { sortersCount: number; referredContainers: number; totalNetworkCents: number } | null;
}

function memberDisplayName(user: User): string {
  const raw = (user.name || "").trim();
  if (raw && raw !== "New User" && raw !== "You") return raw;
  if (typeof window !== "undefined") {
    try {
      const p = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
      if (typeof p.name === "string" && p.name.trim() && p.name !== "New User" && p.name !== "You") {
        return p.name.trim();
      }
      if (typeof p.email === "string" && p.email.includes("@")) {
        return p.email.split("@")[0];
      }
    } catch {
      /* ignore */
    }
  }
  return "Frequent Sorter";
}

export function MemberStatusCard({ user, suburbLabel, network }: MemberStatusCardProps) {
  const summary = buildSorterLoyaltySummary(user, network);
  const [displayName, setDisplayName] = useState("Frequent Sorter");
  const [pointsSwapVoted, setPointsSwapVoted] = useState(false);

  useEffect(() => {
    setDisplayName(memberDisplayName(user));
    try {
      setPointsSwapVoted(localStorage.getItem(POINTS_INTEREST_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, [user]);

  function togglePointsInterest(wantPoints: boolean) {
    setPointsSwapVoted(wantPoints);
    try {
      localStorage.setItem(POINTS_INTEREST_KEY, wantPoints ? "1" : "0");
    } catch {
      /* ignore */
    }
    track(wantPoints ? "points_swap_voted" : "cash_payout_selected", { suburb: suburbLabel });
  }

  // Circular status gauge geometry (Frequent Sorter status ring)
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference * (1 - summary.progressPct / 100);
  const gradId = `tgs-tier-ring-${summary.tier.id}`;

  return (
    <div className="space-y-3 mb-5">
      {/* Dark Metallic / Liquid Glass Frequent Sorter Card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.28)] border border-white/15">
        {/* Subtle luminous specular sheen */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full opacity-25 blur-3xl"
          style={{ background: summary.tier.accentHex }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -left-16 h-44 w-44 rounded-full bg-emerald-500/20 blur-3xl"
        />

        {/* Card Header: Frequent Sorter + Status Tier Pill + Liquid Glass Mark */}
        <div className="relative flex items-center justify-between gap-2 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                Frequent Sorter
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${summary.tier.badgeClass}`}
              >
                <Sparkles className="w-2.5 h-2.5" />
                {summary.tier.label}
              </span>
            </div>
            <p className="text-[16px] font-display font-extrabold text-white truncate mt-1">
              {displayName}
            </p>
            {suburbLabel && (
              <p className="text-[11px] font-medium text-slate-400 truncate">
                {suburbLabel} · Brisbane
              </p>
            )}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/tgs-glass-icon.webp"
            alt=""
            aria-hidden="true"
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 select-none drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
          />
        </div>

        {/* Hero Dual-Metric Row: Points & Cash Credit (left) + Circular Status Ring (right) */}
        <div className="relative flex items-center justify-between gap-4 py-1">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              Good Sort Points
            </p>
            <p className="text-[34px] leading-none font-display font-extrabold tracking-tight text-white tabular-nums mt-1">
              {summary.goodSortPoints.toLocaleString()}
              <span className="text-[13px] font-bold text-slate-400 ml-1">pts</span>
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px]">
              <span className="inline-flex items-center gap-1 font-bold text-emerald-300">
                <Wallet className="w-3.5 h-3.5" />
                {formatCents(summary.totalCreditCents)}
              </span>
              <span className="text-slate-400 text-[11px]">
                {summary.clearedCents > 0
                  ? `${formatCents(summary.clearedCents)} cleared · ${formatCents(summary.pendingCents)} pending`
                  : "10¢ / can · pending pickup"}
              </span>
            </div>
          </div>

          {/* Circular Status Gauge */}
          <div className="relative flex flex-col items-center shrink-0">
            <div className="relative h-[88px] w-[88px]">
              <svg viewBox="0 0 88 88" className="h-full w-full -rotate-90" aria-hidden="true">
                <defs>
                  <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor={summary.tier.ringFrom} />
                    <stop offset="100%" stopColor={summary.tier.ringTo} />
                  </linearGradient>
                </defs>
                <circle
                  cx="44"
                  cy="44"
                  r={radius}
                  fill="none"
                  stroke="rgba(255,255,255,0.12)"
                  strokeWidth="7"
                />
                <circle
                  cx="44"
                  cy="44"
                  r={radius}
                  fill="none"
                  stroke={`url(#${gradId})`}
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeOffset}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-[20px] leading-none font-display font-extrabold text-white tabular-nums">
                  {summary.totalContainers.toLocaleString()}
                </span>
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">
                  Cans
                </span>
              </div>
            </div>
            <p className="text-[10px] font-semibold text-slate-300 mt-1 text-center leading-tight">
              {summary.tier.nextTierLabel
                ? `${summary.containersToNextTier.toLocaleString()} to ${summary.tier.nextTierLabel}`
                : "Top Tier"}
            </p>
          </div>
        </div>

        {/* Bottom 3-Cell Telemetry Strip */}
        <div className="relative mt-4 grid grid-cols-3 gap-2 pt-3 border-t border-white/10">
          <div className="rounded-xl bg-white/[0.06] px-2.5 py-2 border border-white/10">
            <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              <Flame className="w-3 h-3 text-amber-400" />
              Streak
            </div>
            <p className="text-[14px] font-display font-extrabold text-white mt-0.5 tabular-nums">
              {summary.currentStreakDays} {summary.currentStreakDays === 1 ? "day" : "days"}
            </p>
          </div>
          <div className="rounded-xl bg-white/[0.06] px-2.5 py-2 border border-white/10">
            <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              <Leaf className="w-3 h-3 text-emerald-400" />
              CO₂ Saved
            </div>
            <p className="text-[14px] font-display font-extrabold text-white mt-0.5 tabular-nums">
              {summary.co2SavedKg.toFixed(1)} kg
            </p>
          </div>
          <div className="rounded-xl bg-white/[0.06] px-2.5 py-2 border border-white/10">
            <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              <Users className="w-3 h-3 text-sky-400" />
              Network
            </div>
            <p className="text-[14px] font-display font-extrabold text-white mt-0.5 tabular-nums">
              {network && network.totalNetworkCents > 0
                ? `+${formatCredit(network.totalNetworkCents)}`
                : `${network?.sortersCount ?? 0} ${network?.sortersCount === 1 ? "mate" : "mates"}`}
            </p>
          </div>
        </div>
      </div>

      {/* Reward Choice Rail: PayID Cash (Live) vs Airline Frequent Flyer Points Swap (Coming Soon Demand Vote) */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            Reward Preference
          </p>
          <span className="text-[10px] font-semibold text-slate-400">
            Choose cash or vote for points
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => togglePointsInterest(false)}
            className={`rounded-xl px-3 py-2.5 text-left border transition-all ${
              !pointsSwapVoted
                ? "bg-white border-emerald-500 shadow-sm ring-1 ring-emerald-500/20"
                : "bg-white/60 border-slate-200 hover:bg-white"
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-[12px] font-extrabold text-slate-900">10¢ Cash</span>
              <span className="rounded-full bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[9px] font-bold uppercase">
                Live
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">Direct to PayID / bank</p>
          </button>

          <button
            type="button"
            onClick={() => togglePointsInterest(true)}
            className={`rounded-xl px-3 py-2.5 text-left border transition-all ${
              pointsSwapVoted
                ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                : "bg-white/60 border-slate-200 hover:bg-white text-slate-900"
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="inline-flex items-center gap-1 text-[12px] font-extrabold">
                <Plane className="w-3 h-3 text-rose-500" />
                Points Swap
              </span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                  pointsSwapVoted ? "bg-rose-500/25 text-rose-200" : "bg-slate-200 text-slate-600"
                }`}
              >
                {pointsSwapVoted ? "Voted" : "Soon"}
              </span>
            </div>
            <p className={`text-[10px] mt-0.5 ${pointsSwapVoted ? "text-slate-300" : "text-slate-500"}`}>
              Airline points · 10 pts/can
            </p>
          </button>
        </div>
        {pointsSwapVoted && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-slate-600 leading-snug">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              Vote saved — we&apos;re using member demand to unlock Australian frequent flyer points swaps. Your 10¢ cash payouts remain active in the meantime.
            </span>
          </p>
        )}
      </div>

      {/* Milestone Badges Strip */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            <Award className="w-3.5 h-3.5 text-amber-500" />
            Milestones
          </span>
          <span className="text-[11px] font-bold text-slate-700">
            {summary.milestones.filter((m) => m.earned).length}/{summary.milestones.length} unlocked
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {summary.milestones.map((m) => (
            <div
              key={m.id}
              className={`rounded-xl px-2 py-2 text-center border ${
                m.earned
                  ? "bg-amber-50/80 border-amber-200 text-slate-900"
                  : "bg-slate-50 border-slate-100 text-slate-400"
              }`}
            >
              <p className="text-[11px] font-extrabold leading-tight truncate">
                {m.earned ? "★ " : ""}
                {m.label}
              </p>
              <p className="text-[9px] font-semibold mt-0.5 opacity-80">{m.targetText}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
