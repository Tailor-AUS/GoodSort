"use client";

import { useState } from "react";
import { ScanBarcode, Package, X, CheckCircle, Truck, MapPin, Clock, SkipForward } from "lucide-react";
import type { AppMode } from "./map-view";
import {
  type Household,
  type Route,
  type User,
  type Depot,
  formatCents,
  SORTER_PAYOUT_CENTS,
  BAGS,
} from "@/lib/store";
import { claimRoute, startRoute, markStopPickedUp, skipStop, settleRoute, type HouseholdPayout } from "@/lib/routes";

interface BottomSheetProps {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  user: User;
  households: Household[];
  selectedHousehold: Household | null;
  pendingRoutes: Route[];
  activeRoute: Route | null;
  depot: Depot | null;
  onScanPress: () => void;
  onDataUpdate: () => void;
  onDeselectHousehold: () => void;
}

export function BottomSheet({
  mode, onModeChange, user, households, selectedHousehold,
  pendingRoutes, activeRoute, depot,
  onScanPress, onDataUpdate, onDeselectHousehold,
}: BottomSheetProps) {
  const [deliveryChecks, setDeliveryChecks] = useState([false, false, false]);
  const [showSuccess, setShowSuccess] = useState<{ earned: number; stops: number; payouts: HouseholdPayout[] } | null>(null);

  const userHousehold = households.find((h) => h.id === user.householdId);
  const fullBins = pendingRoutes;
  const totalHouseholdsWithContainers = households.filter((h) => h.pendingContainers > 0).length;

  function handleClaimRoute(routeId: string) { claimRoute(routeId); onDataUpdate(); }
  function handleStartRoute(routeId: string) { startRoute(routeId); onDataUpdate(); }
  function handlePickup(routeId: string, stopId: string, count: number) { markStopPickedUp(routeId, stopId, count); onDataUpdate(); }
  function handleSkip(routeId: string, stopId: string) { skipStop(routeId, stopId); onDataUpdate(); }

  function handleSettle(routeId: string) {
    const result = settleRoute(routeId);
    if (result) {
      setShowSuccess({ earned: result.driverEarned, stops: result.householdPayouts.length, payouts: result.householdPayouts });
      setDeliveryChecks([false, false, false]);
      setTimeout(() => { setShowSuccess(null); onDataUpdate(); }, 4000);
    }
  }

  function toggleCheck(i: number) { const next = [...deliveryChecks]; next[i] = !next[i]; setDeliveryChecks(next); }

  // Current stop for active route
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
          <p className="text-slate-500 text-[13px] mt-3">
            {showSuccess.stops} households collected
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bottom-sheet pointer-events-none">
      <div className="pointer-events-auto glass-strong rounded-t-[2rem] shadow-[0_-4px_40px_rgba(0,0,0,0.06)] max-h-[75dvh] overflow-y-auto sheet-inner border-t border-white/40">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1.5 sticky top-0 glass-strong rounded-t-[2rem] z-10">
          <div className="w-9 h-[4px] bg-slate-300/60 rounded-full" />
        </div>

        <div className="px-5 pt-2" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>

          {/* ── Mode toggle ── */}
          {!selectedHousehold && !activeRoute && (
            <div className="flex bg-slate-100/80 rounded-2xl p-1 mb-6 border border-slate-200/50">
              <button onClick={() => onModeChange("sort")}
                className={`flex-1 py-3 rounded-xl text-[13px] font-bold transition-all duration-200 ${mode === "sort" ? "bg-white text-green-700 shadow-md shadow-green-600/10 border border-white/80" : "text-slate-400 hover:text-slate-600"}`}>
                Sort
              </button>
              <button onClick={() => onModeChange("collect")}
                className={`flex-1 py-3 rounded-xl text-[13px] font-bold transition-all duration-200 ${mode === "collect" ? "bg-white text-green-700 shadow-md shadow-green-600/10 border border-white/80" : "text-slate-400 hover:text-slate-600"}`}>
                Collect
              </button>
            </div>
          )}

          {/* ═══════ SORT IDLE ═══════ */}
          {mode === "sort" && !selectedHousehold && !activeRoute && (
            <>
              <div className="mb-6">
                <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em] mb-1">Balance</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-[2.75rem] font-display font-extrabold text-slate-900 leading-none tracking-tight">
                    {formatCents(user.clearedCents)}
                  </p>
                  {user.pendingCents > 0 && (
                    <span className="text-green-600/50 text-[13px] font-semibold">+{formatCents(user.pendingCents)}</span>
                  )}
                </div>
              </div>

              <button onClick={onScanPress}
                className="w-full bg-gradient-to-b from-green-500 to-green-600 hover:from-green-400 hover:to-green-500 active:from-green-600 active:to-green-700 text-white font-extrabold py-4 rounded-2xl transition-all duration-200 text-[15px] mb-6 flex items-center justify-center gap-2.5 shadow-lg shadow-green-600/20">
                <ScanBarcode className="w-5 h-5" />
                Scan Container
              </button>

              {userHousehold && (
                <div className="glass rounded-2xl p-4 border border-white/40 shadow-sm mb-4">
                  <div className="flex justify-between items-center mb-3">
                    <p className="text-[13px] text-slate-500 font-medium">Your bags</p>
                    <p className="text-[13px] text-slate-900 font-bold">{userHousehold.pendingContainers} total</p>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {BAGS.map((bag) => {
                      const count = userHousehold.materials[bag.material] || 0;
                      return (
                        <div key={bag.id} className="flex flex-col items-center gap-1">
                          <div className={`w-7 h-7 ${bag.color} rounded-lg shadow-sm`} />
                          <span className="text-[12px] text-slate-700 font-bold">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="glass rounded-2xl p-4 border border-white/40 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Nearby</p>
                </div>
                <p className="text-[13px] text-slate-600">{totalHouseholdsWithContainers} household{totalHouseholdsWithContainers !== 1 ? "s" : ""} scanning</p>
              </div>

              {user.scans.length > 0 && (
                <div className="mt-5">
                  <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em] mb-3">Recent</p>
                  {user.scans.slice(0, 3).map((scan) => (
                    <div key={scan.id} className="flex justify-between items-center py-3 border-b border-slate-100/60 last:border-0">
                      <div>
                        <p className="text-[13px] text-slate-700 font-medium">{scan.containerName}</p>
                        <p className="text-[12px] text-slate-400 mt-0.5">{new Date(scan.timestamp).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                      </div>
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold border ${scan.status === "settled" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                        {scan.refundCents}c
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ═══════ SORT — HOUSEHOLD SELECTED ═══════ */}
          {mode === "sort" && selectedHousehold && (
            <>
              <div className="flex justify-between items-start mb-5">
                <div>
                  <p className="text-[17px] font-display font-extrabold text-slate-900">{selectedHousehold.name}</p>
                  <p className="text-[13px] text-slate-400 mt-0.5">{selectedHousehold.address}</p>
                </div>
                <button onClick={onDeselectHousehold} className="p-2.5 -mr-1 text-slate-400 hover:text-slate-600 transition-colors duration-200 min-w-[44px] min-h-[44px] flex items-center justify-center">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-4">
                <MiniStat label="Containers" value={selectedHousehold.pendingContainers.toString()} />
                <MiniStat label="Bags" value={selectedHousehold.estimatedBags.toString()} />
                <MiniStat label="Weight" value={`${selectedHousehold.estimatedWeightKg}kg`} />
              </div>

              <div className="grid grid-cols-4 gap-2 mb-4">
                {BAGS.map((bag) => {
                  const count = selectedHousehold.materials[bag.material] || 0;
                  return (
                    <div key={bag.id} className={`glass rounded-xl p-2.5 text-center border ${bag.borderColor}`}>
                      <div className={`w-6 h-6 ${bag.color} rounded-lg mx-auto mb-1.5 shadow-sm`} />
                      <p className="text-[15px] font-display font-extrabold text-slate-900">{count}</p>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider">{bag.label.split(" ")[0]}</p>
                    </div>
                  );
                })}
              </div>

              <div className="bg-green-50/80 border border-green-200/60 rounded-2xl p-4 text-center">
                <p className="text-green-700 text-[13px] font-semibold">{formatCents(selectedHousehold.pendingValueCents)} pending</p>
                <p className="text-green-600/40 text-[12px] mt-0.5">Clears when collected and verified</p>
              </div>
            </>
          )}

          {/* ═══════ COLLECT IDLE ═══════ */}
          {mode === "collect" && !selectedHousehold && !activeRoute && (
            <>
              <div className="mb-6">
                <p className="text-[2.5rem] font-display font-extrabold text-slate-900 leading-none tracking-tight">
                  {pendingRoutes.length} route{pendingRoutes.length !== 1 ? "s" : ""}
                </p>
                <p className="text-slate-400 text-[13px] mt-1.5 font-medium">
                  {pendingRoutes.length > 0
                    ? `${pendingRoutes.reduce((s, r) => s + r.stops.length, 0)} households ready`
                    : "Households are still scanning"}
                </p>
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
                        className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-bold py-3 rounded-xl text-[13px] shadow-lg shadow-green-600/20">
                        Claim Route
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="glass rounded-2xl p-6 border border-white/40 shadow-sm text-center">
                  <Package className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-slate-400 text-[13px]">Routes generate when nearby households reach 2,000+ containers</p>
                </div>
              )}
            </>
          )}

          {/* ═══════ ROUTE CLAIMED ═══════ */}
          {activeRoute && activeRoute.status === "claimed" && (
            <>
              <div className="mb-5">
                <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Route claimed</p>
                <p className="text-xl font-display font-extrabold text-slate-900 mt-1">
                  {activeRoute.stops.length} stops &middot; {formatCents(activeRoute.driverPayoutCents)}
                </p>
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
                className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-4 rounded-2xl text-[15px] shadow-lg shadow-green-600/20">
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
                <p className="text-[12px] text-slate-500 mt-1.5">{currentStop.containerCount} containers &middot; {currentStop.estimatedBags} bag{currentStop.estimatedBags !== 1 ? "s" : ""}</p>
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

          {/* Fallback: in_progress but all stops done */}
          {activeRoute && activeRoute.status === "in_progress" && !currentStop && (
            <div className="text-center py-6">
              <p className="text-slate-500 text-[13px]">All stops completed</p>
              <button onClick={() => { import("@/lib/routes").then((m) => { m.completeRouteAtDepot(activeRoute.id); onDataUpdate(); }); }}
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

        {/* Powered by */}
        <div className="px-5 pb-4 pt-1" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          <PoweredByTailor />
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-xl p-3 text-center border border-white/40 shadow-sm">
      <p className="text-[15px] font-display font-extrabold text-slate-900">{value}</p>
      <p className="text-[10px] text-slate-400 uppercase tracking-[0.12em] mt-0.5">{label}</p>
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
