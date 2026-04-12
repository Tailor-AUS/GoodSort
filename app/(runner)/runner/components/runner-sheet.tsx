"use client";

import { useState } from "react";
import { Truck, CheckCircle, BarChart3, Trophy as TrophyIcon } from "lucide-react";
import { formatCents, type User } from "@/lib/store";
import type { MarketplaceRun, RunDetail, RunnerEarnings, LeaderboardEntry } from "@/lib/marketplace";
import { RunMarketplace } from "./run-marketplace";
import { RunActive } from "./run-active";
import { RunnerStats } from "./runner-stats";
import { Leaderboard } from "./leaderboard";
import { PoweredByTailor } from "@/app/components/shared/powered-by-tailor";
import Link from "next/link";

type Tab = "runs" | "stats" | "leaderboard";

interface RunnerSheetProps {
  user: User;
  availableRuns: MarketplaceRun[];
  activeRun: RunDetail | null;
  earnings: RunnerEarnings | null;
  leaderboard: LeaderboardEntry[];
  runnerId?: string;
  loading: boolean;
  onClaim: (runId: string) => void;
  onStart: () => void;
  onArrive: (stopId: string) => void;
  onPickup: (stopId: string, count: number, photoUrl?: string) => void;
  onSkip: (stopId: string) => void;
  onDeliver: () => void;
  onComplete: () => void;
  onDataUpdate: () => void;
}

export function RunnerSheet({
  user, availableRuns, activeRun, earnings, leaderboard, runnerId, loading,
  onClaim, onStart, onArrive, onPickup, onSkip, onDeliver, onComplete, onDataUpdate,
}: RunnerSheetProps) {
  const [showSuccess, setShowSuccess] = useState<{ earned: number; containers: number } | null>(null);
  const [tab, setTab] = useState<Tab>("runs");

  // ── Success Overlay ──
  if (showSuccess) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center">
        <div className="absolute inset-0 glass-dark" />
        <div className="relative w-full glass-strong rounded-t-[2rem] p-8 text-center animate-slide-up shadow-2xl border-t border-white/20" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
          <div className="w-16 h-16 bg-green-500/15 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <p className="text-4xl font-display font-extrabold text-slate-900 mb-1 animate-ka-ching tracking-tight">
            +{formatCents(showSuccess.earned)}
          </p>
          <p className="text-slate-500 text-[13px] mt-3">{showSuccess.containers} containers collected</p>
        </div>
      </div>
    );
  }

  const handleComplete = () => {
    onComplete();
    // Show success after completion
    if (activeRun) {
      const containers = activeRun.stops
        .filter((s) => s.status === "picked_up")
        .reduce((sum, s) => sum + (s.actualContainers ?? s.estimatedContainers), 0);
      setShowSuccess({ earned: containers * activeRun.perContainerCents, containers });
      setTimeout(() => { setShowSuccess(null); onDataUpdate(); }, 4000);
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bottom-sheet pointer-events-none">
      <div className="pointer-events-auto glass-strong rounded-t-[2rem] shadow-[0_-4px_40px_rgba(0,0,0,0.06)] max-h-[75dvh] overflow-y-auto sheet-inner border-t border-white/40">
        <div className="flex justify-center pt-3 pb-1.5 sticky top-0 glass-strong rounded-t-[2rem] z-10">
          <div className="w-9 h-[4px] bg-slate-300/60 rounded-full" />
        </div>

        <div className="px-5 pt-2" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>

          {/* ═══════ ACTIVE RUN — Full workflow ═══════ */}
          {activeRun && (
            <RunActive
              run={activeRun}
              onStart={onStart}
              onArrive={onArrive}
              onPickup={onPickup}
              onSkip={onSkip}
              onDeliver={onDeliver}
              onComplete={handleComplete}
            />
          )}

          {/* ═══════ IDLE — Marketplace + Stats + Leaderboard ═══════ */}
          {!activeRun && (
            <>
              {/* Header */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <Truck className="w-5 h-5 text-green-600" />
                  <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Runner</p>
                </div>
                <p className="text-[2.5rem] font-display font-extrabold text-slate-900 leading-none tracking-tight">
                  {availableRuns.length} run{availableRuns.length !== 1 ? "s" : ""}
                </p>
                <p className="text-slate-400 text-[13px] mt-1.5 font-medium">
                  {availableRuns.length > 0
                    ? `${availableRuns.reduce((s, r) => s + r.estimatedContainers, 0).toLocaleString()} containers available`
                    : "Waiting for bins to fill"}
                </p>
              </div>

              {/* Tab bar */}
              <div className="flex gap-1 mb-4 glass rounded-xl p-1 border border-white/40">
                {[
                  { key: "runs" as Tab, label: "Runs", icon: Truck },
                  { key: "stats" as Tab, label: "Stats", icon: BarChart3 },
                  { key: "leaderboard" as Tab, label: "Board", icon: TrophyIcon },
                ].map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-bold transition-all ${
                      tab === key
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-400 hover:text-slate-600"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              {tab === "runs" && (
                <RunMarketplace runs={availableRuns} onClaim={onClaim} loading={loading} />
              )}

              {tab === "stats" && (
                <RunnerStats earnings={earnings} loading={loading} />
              )}

              {tab === "leaderboard" && (
                <Leaderboard entries={leaderboard} currentRunnerId={runnerId} loading={loading} />
              )}

              {/* Switch to Sort */}
              <Link href="/"
                className="block text-center text-[13px] text-slate-400 hover:text-green-600 font-medium py-3 mt-3 transition-colors duration-200">
                ← Switch to Sorter mode
              </Link>
            </>
          )}
        </div>

        <div className="px-5 pb-4 pt-1" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          <PoweredByTailor />
        </div>
      </div>
    </div>
  );
}

