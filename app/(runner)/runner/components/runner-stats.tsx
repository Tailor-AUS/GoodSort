"use client";

import { Star, Flame, Zap, Trophy, TrendingUp } from "lucide-react";
import { formatCents } from "@/lib/store";
import type { RunnerEarnings, RunnerLevel } from "@/lib/marketplace";
import { LEVEL_INFO, BADGE_INFO } from "@/lib/marketplace";

interface RunnerStatsProps {
  earnings: RunnerEarnings | null;
  loading?: boolean;
}

export function RunnerStats({ earnings, loading }: RunnerStatsProps) {
  if (loading || !earnings) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="glass rounded-2xl p-4 border border-white/40 h-24" />
        <div className="glass rounded-2xl p-4 border border-white/40 h-20" />
      </div>
    );
  }

  const level = LEVEL_INFO[earnings.level as RunnerLevel] || LEVEL_INFO.bronze;
  const nextLevel = getNextLevel(earnings.level as RunnerLevel);

  return (
    <div className="space-y-3">
      {/* Level + Rating */}
      <div className="glass rounded-2xl p-4 border border-white/40 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${level.color} ${level.bgColor}`}>
              {level.label}
            </span>
            {level.bonus > 0 && (
              <span className="text-[11px] text-green-600 font-bold">+{level.bonus}c bonus</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
            <span className="text-[15px] font-display font-extrabold text-slate-900">
              {earnings.rating.toFixed(1)}
            </span>
          </div>
        </div>

        {/* Level progress */}
        {nextLevel && (
          <div>
            <div className="flex justify-between text-[11px] text-slate-400 mb-1">
              <span>Next: {nextLevel.label}</span>
              <span>{earnings.totalRuns}/{nextLevel.minRuns} runs</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-400 to-green-600 rounded-full transition-all"
                style={{ width: `${Math.min(100, (earnings.totalRuns / nextLevel.minRuns) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Earnings grid */}
      <div className="grid grid-cols-3 gap-2">
        <div className="glass rounded-xl p-3 border border-white/40 text-center">
          <p className="text-[11px] text-slate-400 font-semibold">Today</p>
          <p className="text-[15px] font-display font-extrabold text-slate-900 mt-0.5">
            {formatCents(earnings.todayEarnings)}
          </p>
        </div>
        <div className="glass rounded-xl p-3 border border-white/40 text-center">
          <p className="text-[11px] text-slate-400 font-semibold">Week</p>
          <p className="text-[15px] font-display font-extrabold text-slate-900 mt-0.5">
            {formatCents(earnings.weekEarnings)}
          </p>
        </div>
        <div className="glass rounded-xl p-3 border border-white/40 text-center">
          <p className="text-[11px] text-slate-400 font-semibold">Lifetime</p>
          <p className="text-[15px] font-display font-extrabold text-slate-900 mt-0.5">
            {formatCents(earnings.lifetimeEarningsCents)}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="glass rounded-2xl p-4 border border-white/40 shadow-sm">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center">
              <Trophy className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Runs</p>
              <p className="text-[13px] font-bold text-slate-900">{earnings.totalRuns}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Collected</p>
              <p className="text-[13px] font-bold text-slate-900">{earnings.totalContainersCollected.toLocaleString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-orange-50 flex items-center justify-center">
              <Flame className="w-4 h-4 text-orange-500" />
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Streak</p>
              <p className="text-[13px] font-bold text-slate-900">{earnings.currentStreakDays} days</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center">
              <Zap className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Efficiency</p>
              <p className="text-[13px] font-bold text-slate-900">{Math.round(earnings.efficiencyScore)}/hr</p>
            </div>
          </div>
        </div>
      </div>

      {/* Badges */}
      {earnings.badges.length > 0 && (
        <div className="glass rounded-2xl p-4 border border-white/40 shadow-sm">
          <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-[0.12em] mb-2">Badges</p>
          <div className="flex flex-wrap gap-1.5">
            {earnings.badges.map((badge) => {
              const info = BADGE_INFO[badge];
              if (!info) return null;
              return (
                <span
                  key={badge}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-slate-50 rounded-full text-[11px] text-slate-600 font-medium"
                  title={info.description}
                >
                  <span>{info.icon}</span>
                  <span>{info.label}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function getNextLevel(current: RunnerLevel) {
  const levels: RunnerLevel[] = ["bronze", "silver", "gold", "platinum"];
  const idx = levels.indexOf(current);
  if (idx >= levels.length - 1) return null;
  return LEVEL_INFO[levels[idx + 1]];
}
