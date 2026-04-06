"use client";

import { useState } from "react";
import { Package, CheckCircle, Truck, Clock, SkipForward } from "lucide-react";
import {
  type Route,
  type User,
  type Depot,
  formatCents,
} from "@/lib/store";
import { claimRoute, startRoute, markStopPickedUp, skipStop, settleRoute, completeRouteAtDepot, type HouseholdPayout } from "@/lib/routes";
import Link from "next/link";

interface RunnerSheetProps {
  user: User;
  pendingRoutes: Route[];
  activeRoute: Route | null;
  depot: Depot | null;
  onDataUpdate: () => void;
}

export function RunnerSheet({
  user, pendingRoutes, activeRoute, depot, onDataUpdate,
}: RunnerSheetProps) {
  const [showSuccess, setShowSuccess] = useState<{ earned: number; stops: number } | null>(null);

  function handleClaimRoute(routeId: string) { claimRoute(routeId); onDataUpdate(); }
  function handleStartRoute(routeId: string) { startRoute(routeId); onDataUpdate(); }
  function handlePickup(routeId: string, stopId: string, count: number) { markStopPickedUp(routeId, stopId, count); onDataUpdate(); }
  function handleSkip(routeId: string, stopId: string) { skipStop(routeId, stopId); onDataUpdate(); }

  function handleSettle(routeId: string) {
    const result = settleRoute(routeId);
    if (result) {
      setShowSuccess({ earned: result.driverEarned, stops: result.householdPayouts.length });
      setTimeout(() => { setShowSuccess(null); onDataUpdate(); }, 4000);
    }
  }

  const currentStop = activeRoute?.stops.find((s) => s.status === "pending");
  const completedStops = activeRoute?.stops.filter((s) => s.status === "picked_up").length || 0;
  const totalStops = activeRoute?.stops.length || 0;

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
          <p className="text-slate-500 text-[13px] mt-3">{showSuccess.stops} households collected</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bottom-sheet pointer-events-none">
      <div className="pointer-events-auto glass-strong rounded-t-[2rem] shadow-[0_-4px_40px_rgba(0,0,0,0.06)] max-h-[75dvh] overflow-y-auto sheet-inner border-t border-white/40">
        <div className="flex justify-center pt-3 pb-1.5 sticky top-0 glass-strong rounded-t-[2rem] z-10">
          <div className="w-9 h-[4px] bg-slate-300/60 rounded-full" />
        </div>

        <div className="px-5 pt-2" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>

          {/* ═══════ IDLE — Available Routes ═══════ */}
          {!activeRoute && (
            <>
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <Truck className="w-5 h-5 text-green-600" />
                  <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Runner</p>
                </div>
                <p className="text-[2.5rem] font-display font-extrabold text-slate-900 leading-none tracking-tight">
                  {pendingRoutes.length} route{pendingRoutes.length !== 1 ? "s" : ""}
                </p>
                <p className="text-slate-400 text-[13px] mt-1.5 font-medium">
                  {pendingRoutes.length > 0
                    ? `${pendingRoutes.reduce((s, r) => s + r.stops.length, 0)} households ready`
                    : "Waiting for households to scan"}
                </p>
              </div>

              {/* Earnings summary */}
              <div className="glass rounded-2xl p-4 border border-white/40 shadow-sm mb-4">
                <div className="flex justify-between items-center">
                  <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Total Earned</p>
                  <p className="text-[17px] font-display font-extrabold text-slate-900">{formatCents(user.clearedCents)}</p>
                </div>
                <div className="flex justify-between items-center mt-1">
                  <p className="text-[12px] text-slate-400">Routes completed</p>
                  <p className="text-[13px] text-slate-600 font-bold">{user.collections.length}</p>
                </div>
              </div>

              {pendingRoutes.length > 0 ? (
                <div className="space-y-2">
                  {pendingRoutes.map((route) => (
                    <div key={route.id} className="glass rounded-2xl p-4 border border-white/40 shadow-sm">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="text-[15px] text-slate-900 font-semibold">{route.stops.length} households</p>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="flex items-center gap-1 text-[12px] text-slate-400">
                              <Package className="w-3 h-3" />{route.totalContainers}
                            </span>
                            <span className="flex items-center gap-1 text-[12px] text-slate-400">
                              <Clock className="w-3 h-3" />~{route.estimatedDurationMin}min
                            </span>
                          </div>
                        </div>
                        <p className="text-green-600 font-display font-extrabold text-[17px]">
                          {formatCents(route.driverPayoutCents)}
                        </p>
                      </div>
                      <button onClick={() => handleClaimRoute(route.id)}
                        className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-bold py-3 rounded-xl text-[13px] shadow-lg shadow-green-600/20 min-h-[44px]">
                        Claim Route
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="glass rounded-2xl p-6 border border-white/40 shadow-sm text-center">
                  <Package className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-slate-400 text-[13px]">Routes generate when 2,000+ containers are ready nearby</p>
                </div>
              )}

              {/* Switch to Sort */}
              <Link href="/"
                className="block text-center text-[13px] text-slate-400 hover:text-green-600 font-medium py-3 mt-2 transition-colors duration-200">
                ← Switch to Sorter mode
              </Link>
            </>
          )}

          {/* ═══════ ROUTE CLAIMED ═══════ */}
          {activeRoute && activeRoute.status === "claimed" && (
            <>
              <div className="mb-5">
                <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Route claimed</p>
                <p className="text-xl font-display font-extrabold text-slate-900 mt-1">
                  {activeRoute.stops.length} stops · {formatCents(activeRoute.driverPayoutCents)}
                </p>
                <p className="text-[13px] text-slate-400 mt-0.5">~{activeRoute.estimatedDurationMin} min estimated</p>
              </div>
              <div className="space-y-1.5 mb-5">
                {activeRoute.stops.map((stop, i) => (
                  <div key={stop.id} className="flex items-center gap-3 py-2.5 px-3 glass rounded-xl border border-white/40">
                    <span className="w-6 h-6 rounded-full bg-slate-200 text-[11px] font-bold text-slate-500 flex items-center justify-center flex-shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-slate-700 font-medium truncate">{stop.householdName}</p>
                      <p className="text-[11px] text-slate-400">{stop.containerCount} containers</p>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => handleStartRoute(activeRoute.id)}
                className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-4 rounded-2xl text-[15px] shadow-lg shadow-green-600/20 min-h-[48px]">
                Start Collection
              </button>
            </>
          )}

          {/* ═══════ IN PROGRESS ═══════ */}
          {activeRoute && activeRoute.status === "in_progress" && currentStop && (
            <>
              <div className="flex items-center gap-2 mb-5">
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-green-400 to-green-600 rounded-full transition-all duration-500" style={{ width: `${totalStops > 0 ? (completedStops / totalStops) * 100 : 0}%` }} />
                </div>
                <span className="text-[12px] text-slate-400 font-bold">{completedStops}/{totalStops}</span>
              </div>
              <div className="mb-5">
                <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Next pickup</p>
                <p className="text-xl font-display font-extrabold text-slate-900 mt-1">{currentStop.householdName}</p>
                <p className="text-[13px] text-slate-400">{currentStop.address}</p>
                <p className="text-[12px] text-slate-500 mt-1.5">{currentStop.containerCount} containers · {currentStop.estimatedBags} bag{currentStop.estimatedBags !== 1 ? "s" : ""}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handlePickup(activeRoute.id, currentStop.id, currentStop.containerCount)}
                  className="flex-1 bg-gradient-to-b from-green-500 to-green-600 text-white font-bold py-3.5 rounded-xl text-[13px] flex items-center justify-center gap-2 shadow-lg shadow-green-600/20 min-h-[44px]">
                  <CheckCircle className="w-4 h-4" /> Picked Up
                </button>
                <button onClick={() => handleSkip(activeRoute.id, currentStop.id)}
                  className="px-4 py-3.5 glass border border-white/40 text-slate-500 font-bold rounded-xl text-[13px] flex items-center gap-1.5 min-h-[44px]">
                  <SkipForward className="w-4 h-4" /> Skip
                </button>
              </div>
            </>
          )}

          {/* Fallback: all stops done */}
          {activeRoute && activeRoute.status === "in_progress" && !currentStop && (
            <div className="text-center py-6">
              <p className="text-slate-500 text-[13px]">All stops completed</p>
              <button onClick={() => { completeRouteAtDepot(activeRoute.id); onDataUpdate(); }}
                className="mt-3 bg-gradient-to-b from-green-500 to-green-600 text-white font-bold py-3 px-6 rounded-xl text-[13px] shadow-lg shadow-green-600/20 min-h-[44px]">
                Head to Depot
              </button>
            </div>
          )}

          {/* ═══════ AT DEPOT ═══════ */}
          {activeRoute && activeRoute.status === "at_depot" && (
            <>
              <div className="mb-5">
                <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">All stops complete</p>
                <p className="text-xl font-display font-extrabold text-slate-900 mt-1">{depot?.name || "Depot"}</p>
                <p className="text-[13px] text-slate-400">{depot?.address}</p>
              </div>
              <div className="glass rounded-2xl p-4 border border-white/40 shadow-sm mb-5">
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Collected</span>
                  <span className="text-slate-900 font-bold">{activeRoute.stops.filter((s) => s.status === "picked_up").length} of {activeRoute.stops.length}</span>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Payout</span>
                  <span className="text-green-600 font-display font-extrabold text-xl">{formatCents(activeRoute.driverPayoutCents)}</span>
                </div>
              </div>
              <button onClick={() => handleSettle(activeRoute.id)}
                className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-4 rounded-2xl text-[15px] shadow-lg shadow-green-600/20 flex items-center justify-center gap-2 min-h-[48px]">
                <Truck className="w-5 h-5" /> Confirm Depot Drop-off
              </button>
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

function PoweredByTailor() {
  return (
    <div className="flex justify-center">
      <a href="https://tailor.au" target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-[11px] tracking-wide text-slate-400 hover:text-slate-600 border border-slate-200/50 rounded-full pl-2.5 pr-3 py-1 transition-all duration-200">
        <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><path d="M5 0L9.33 3v6L5 12 .67 9V3L5 0z" /></svg>
        <span>Powered by <span className="font-bold text-slate-500">Tailor</span></span>
      </a>
    </div>
  );
}
