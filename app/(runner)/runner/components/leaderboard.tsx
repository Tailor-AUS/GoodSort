"use client";

import { Star, Trophy } from "lucide-react";
import type { LeaderboardEntry, RunnerLevel } from "@/lib/marketplace";
import { LEVEL_INFO } from "@/lib/marketplace";

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  currentRunnerId?: string;
  loading?: boolean;
}

export function Leaderboard({ entries, currentRunnerId, loading }: LeaderboardProps) {
  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 glass rounded-xl border border-white/40" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="glass rounded-2xl p-6 border border-white/40 shadow-sm text-center">
        <Trophy className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-slate-500 text-[13px]">No runners on the leaderboard yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {entries.map((entry) => {
        const level = LEVEL_INFO[entry.level as RunnerLevel] || LEVEL_INFO.bronze;
        const isMe = entry.runnerId === currentRunnerId;

        return (
          <div
            key={entry.runnerId}
            className={`flex items-center gap-3 py-2.5 px-3 rounded-xl border ${
              isMe ? "bg-green-50/80 border-green-200" : "glass border-white/40"
            }`}
          >
            {/* Rank */}
            <div className="w-7 h-7 flex items-center justify-center flex-shrink-0">
              {entry.rank <= 3 ? (
                <span className="text-lg">
                  {entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : "🥉"}
                </span>
              ) : (
                <span className="text-[13px] font-bold text-slate-400">#{entry.rank}</span>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className={`text-[13px] font-semibold truncate ${isMe ? "text-green-700" : "text-slate-700"}`}>
                  {entry.name}{isMe ? " (you)" : ""}
                </p>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${level.color} ${level.bgColor}`}>
                  {level.label}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] text-slate-400">{entry.totalRuns} runs</span>
                <span className="text-[11px] text-slate-300">·</span>
                <span className="flex items-center gap-0.5 text-[11px] text-slate-400">
                  <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                  {entry.rating.toFixed(1)}
                </span>
              </div>
            </div>

            {/* Containers */}
            <div className="text-right">
              <p className="text-[13px] font-display font-extrabold text-slate-900">
                {entry.totalContainers.toLocaleString()}
              </p>
              <p className="text-[10px] text-slate-400">containers</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
