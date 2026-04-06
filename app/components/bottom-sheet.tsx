"use client";

import { useState } from "react";
import { ScanBarcode, Package, X, CheckCircle, Truck, RefreshCw, ArrowRight } from "lucide-react";
import type { AppMode } from "./map-view";
import {
  type Bin,
  type User,
  formatCents,
  getFillBgColor,
  MATERIAL_LABELS,
  type MaterialType,
  RUNNER_PAYOUT_CENTS,
  claimBin,
  completeBinRun,
  unclaimBin,
  getBinForBuilding,
} from "@/lib/store";

interface BottomSheetProps {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  user: User;
  bins: Bin[];
  selectedBin: Bin | null;
  onScanPress: () => void;
  onBinUpdate: () => void;
  onDeselectBin: () => void;
}

export function BottomSheet({
  mode,
  onModeChange,
  user,
  bins,
  selectedBin,
  onScanPress,
  onBinUpdate,
  onDeselectBin,
}: BottomSheetProps) {
  const [deliveryChecks, setDeliveryChecks] = useState([false, false, false]);
  const [showSuccess, setShowSuccess] = useState<{ earned: number; count: number; building: string; settled: number } | null>(null);

  const userBin = getBinForBuilding(user.buildingId);
  const fullBins = bins.filter((b) => b.fillPercent >= 80 && b.status !== "claimed" && b.status !== "collected");
  const totalAvailableEarnings = fullBins.reduce((sum, b) => sum + b.containerCount * RUNNER_PAYOUT_CENTS, 0);
  const isClaimed = selectedBin?.status === "claimed";

  function handleClaim() {
    if (!selectedBin) return;
    claimBin(selectedBin.id);
    onBinUpdate();
  }

  function handleUnclaim() {
    if (!selectedBin) return;
    unclaimBin(selectedBin.id);
    onBinUpdate();
    onDeselectBin();
  }

  function handleConfirmDelivery() {
    if (!selectedBin) return;
    const result = completeBinRun(selectedBin.id);
    if (result) {
      setShowSuccess({
        earned: result.user.runs[0].earnedCents,
        count: result.user.runs[0].containerCount,
        building: result.user.runs[0].buildingName,
        settled: result.settledScans,
      });
      setDeliveryChecks([false, false, false]);
      setTimeout(() => {
        setShowSuccess(null);
        onBinUpdate();
        onDeselectBin();
      }, 3500);
    }
  }

  function toggleCheck(i: number) {
    const next = [...deliveryChecks];
    next[i] = !next[i];
    setDeliveryChecks(next);
  }

  // ── Success overlay ──
  if (showSuccess) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center">
        <div className="absolute inset-0 bg-black/80" />
        <div className="relative w-full bg-gradient-to-t from-[#0a0a0a] to-[#141414] rounded-t-[2rem] p-8 pb-12 text-center animate-slide-up">
          <div className="w-14 h-14 bg-green-500/15 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle className="w-7 h-7 text-green-400" />
          </div>
          <p className="text-4xl font-display font-extrabold text-white mb-1 animate-ka-ching tracking-tight">
            +{formatCents(showSuccess.earned)}
          </p>
          <p className="text-neutral-400 text-sm mt-3">
            {showSuccess.count} containers from {showSuccess.building}
          </p>
          {showSuccess.settled > 0 && (
            <p className="text-green-400/50 text-xs mt-2">
              {showSuccess.settled} pending scan{showSuccess.settled !== 1 ? "s" : ""} verified
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bottom-sheet pointer-events-none">
      <div className="pointer-events-auto bg-[#141414] rounded-t-[1.75rem] shadow-[0_-2px_40px_rgba(0,0,0,0.8)] max-h-[75vh] overflow-y-auto border-t border-[#222]">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 sticky top-0 bg-[#141414] rounded-t-[1.75rem] z-10">
          <div className="w-8 h-[3px] bg-neutral-700 rounded-full" />
        </div>

        <div className="px-5 pb-8 pt-2">
          {/* ── Mode toggle ── */}
          {!selectedBin && (
            <div className="flex bg-[#0a0a0a] rounded-2xl p-1 mb-6 border border-[#1e1e1e]">
              <button
                onClick={() => onModeChange("sort")}
                className={`flex-1 py-3 rounded-xl text-[13px] font-bold transition-all duration-200 ${
                  mode === "sort"
                    ? "bg-green-500 text-black shadow-lg shadow-green-500/25"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                Sort
              </button>
              <button
                onClick={() => onModeChange("run")}
                className={`flex-1 py-3 rounded-xl text-[13px] font-bold transition-all duration-200 ${
                  mode === "run"
                    ? "bg-green-500 text-black shadow-lg shadow-green-500/25"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                Run
              </button>
            </div>
          )}

          {/* ══════════ SORT MODE: Idle ══════════ */}
          {mode === "sort" && !selectedBin && (
            <>
              <div className="mb-6">
                <p className="text-[11px] text-neutral-500 font-semibold uppercase tracking-[0.15em] mb-1">Balance</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-[2.75rem] font-display font-extrabold text-white leading-none tracking-tight">
                    {formatCents(user.clearedCents)}
                  </p>
                  {user.pendingCents > 0 && (
                    <span className="text-green-400/50 text-sm font-medium">
                      +{formatCents(user.pendingCents)}
                    </span>
                  )}
                </div>
              </div>

              {/* Scan CTA */}
              <button
                onClick={onScanPress}
                className="w-full bg-green-500 hover:bg-green-400 active:bg-green-600 text-black font-extrabold py-4 rounded-2xl transition-all duration-200 text-[15px] mb-6 flex items-center justify-center gap-2.5 shadow-lg shadow-green-500/25"
              >
                <ScanBarcode className="w-5 h-5" />
                Scan Container
              </button>

              {/* User's bin */}
              {userBin && (
                <div className="bg-[#1e1e1e] rounded-2xl p-4 border border-[#2a2a2a]">
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-2 h-2 rounded-full ${getFillBgColor(userBin.fillPercent)}`} />
                      <p className="text-[13px] text-neutral-400 font-medium">Your bin</p>
                    </div>
                    <p className="text-[13px] text-white font-semibold">{userBin.buildingName}</p>
                  </div>
                  <div className="flex justify-between text-[11px] text-neutral-600 mb-1.5">
                    <span>{userBin.containerCount} containers</span>
                    <span>{userBin.fillPercent}%</span>
                  </div>
                  <div className="h-1.5 bg-[#2a2a2a] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${getFillBgColor(userBin.fillPercent)}`}
                      style={{ width: `${userBin.fillPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Recent scans */}
              {user.scans.length > 0 && (
                <div className="mt-5">
                  <p className="text-[11px] text-neutral-500 font-semibold uppercase tracking-[0.15em] mb-3">Recent</p>
                  {user.scans.slice(0, 3).map((scan) => (
                    <div key={scan.id} className="flex justify-between items-center py-3 border-b border-[#1e1e1e] last:border-0">
                      <div>
                        <p className="text-[13px] text-neutral-200 font-medium">{scan.containerName}</p>
                        <p className="text-[11px] text-neutral-600 mt-0.5">
                          {new Date(scan.timestamp).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <StatusBadge status={scan.status} cents={scan.refundCents} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ══════════ RUN MODE: Idle ══════════ */}
          {mode === "run" && !selectedBin && (
            <>
              <div className="mb-6">
                <p className="text-[2.5rem] font-display font-extrabold text-white leading-none tracking-tight">
                  {fullBins.length} bag{fullBins.length !== 1 ? "s" : ""}
                </p>
                <p className="text-neutral-500 text-[13px] mt-1.5 font-medium">
                  {fullBins.length > 0 ? `~${formatCents(totalAvailableEarnings)} available nearby` : "No bags ready for collection"}
                </p>
              </div>

              {fullBins.length > 0 && (
                <div className="space-y-2">
                  {fullBins.map((bin) => (
                    <div
                      key={bin.id}
                      className="bg-[#1e1e1e] rounded-2xl p-4 border border-[#2a2a2a] hover:border-[#333] transition-all duration-200 cursor-pointer group"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className="text-[15px] text-white font-semibold">{bin.buildingName}</p>
                          <p className="text-[11px] text-neutral-600 mt-0.5">{bin.address}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <Package className="w-3 h-3 text-neutral-600" />
                            <span className="text-[11px] text-neutral-500">{bin.containerCount} containers</span>
                          </div>
                        </div>
                        <div className="text-right flex flex-col items-end gap-1.5">
                          <p className="text-green-400 font-display font-extrabold text-[17px]">
                            {formatCents(bin.containerCount * RUNNER_PAYOUT_CENTS)}
                          </p>
                          <ArrowRight className="w-4 h-4 text-neutral-600 group-hover:text-neutral-400 transition-colors" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ══════════ BIN SELECTED (Sort) ══════════ */}
          {mode === "sort" && selectedBin && (
            <>
              <SheetHeader bin={selectedBin} onClose={onDeselectBin} />
              <FillBar bin={selectedBin} />
              <MaterialBar bin={selectedBin} />
              <div className="bg-green-500/8 border border-green-500/15 rounded-2xl p-4 mt-5 text-center">
                <p className="text-green-400 text-[13px] font-semibold">Drop your containers here</p>
                <p className="text-green-400/40 text-[11px] mt-0.5">10c pending per container</p>
              </div>
            </>
          )}

          {/* ══════════ BIN SELECTED (Run, unclaimed) ══════════ */}
          {mode === "run" && selectedBin && !isClaimed && (
            <>
              <SheetHeader bin={selectedBin} onClose={onDeselectBin} />
              <FillBar bin={selectedBin} />
              <div className="bg-[#1e1e1e] rounded-2xl p-4 mt-5 mb-5 border border-[#2a2a2a]">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-neutral-500 font-semibold uppercase tracking-[0.15em]">Payout</span>
                  <span className="text-green-400 text-2xl font-display font-extrabold">
                    {formatCents(selectedBin.containerCount * RUNNER_PAYOUT_CENTS)}
                  </span>
                </div>
                <p className="text-neutral-600 text-[11px] mt-1">{selectedBin.containerCount} containers &middot; ~{selectedBin.estimatedWeightKg}kg</p>
              </div>
              <button
                onClick={handleClaim}
                className="w-full bg-green-500 hover:bg-green-400 active:bg-green-600 text-black font-extrabold py-4 rounded-2xl transition-all duration-200 text-[15px] shadow-lg shadow-green-500/25"
              >
                Claim This Bag
              </button>
            </>
          )}

          {/* ══════════ BAG CLAIMED (delivery) ══════════ */}
          {mode === "run" && selectedBin && isClaimed && (
            <>
              <div className="mb-5">
                <p className="text-[11px] text-neutral-500 font-semibold uppercase tracking-[0.15em]">Picking up from</p>
                <p className="text-xl font-display font-extrabold text-white mt-1">{selectedBin.buildingName}</p>
                <p className="text-[13px] text-neutral-500">{selectedBin.address}</p>
              </div>

              <div className="space-y-0 mb-5">
                {[
                  { text: "Took the full bag", icon: Package },
                  { text: "Replaced with a fresh bag", icon: RefreshCw },
                  { text: "Delivered bag to depot", icon: Truck },
                ].map(({ text, icon: Icon }, i) => (
                  <label key={i} className="flex items-center gap-3.5 py-4 cursor-pointer border-b border-[#1e1e1e] last:border-0">
                    <button
                      onClick={() => toggleCheck(i)}
                      className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                        deliveryChecks[i]
                          ? "bg-green-500 border-green-500 shadow-lg shadow-green-500/25"
                          : "border-neutral-700 hover:border-neutral-500"
                      }`}
                    >
                      {deliveryChecks[i] && (
                        <CheckCircle className="w-4 h-4 text-black" />
                      )}
                    </button>
                    <Icon className={`w-4 h-4 flex-shrink-0 ${deliveryChecks[i] ? "text-green-400" : "text-neutral-600"}`} />
                    <span className={`text-[14px] font-medium ${deliveryChecks[i] ? "text-green-400" : "text-neutral-300"}`}>
                      {text}
                    </span>
                  </label>
                ))}
              </div>

              <button
                onClick={handleConfirmDelivery}
                className="w-full bg-green-500 hover:bg-green-400 active:bg-green-600 text-black font-extrabold py-4 rounded-2xl transition-all duration-200 text-[15px] mb-3 shadow-lg shadow-green-500/25"
              >
                Confirm &middot; {formatCents(selectedBin.containerCount * RUNNER_PAYOUT_CENTS)}
              </button>
              <button
                onClick={handleUnclaim}
                className="w-full text-neutral-600 font-medium py-2 text-[13px] hover:text-neutral-400 transition-colors duration-200"
              >
                Cancel
              </button>
            </>
          )}
        </div>

        {/* Powered by Tailor */}
        <div className="px-5 pb-5 pt-2">
          <PoweredByTailor />
        </div>
      </div>
    </div>
  );
}

// ── Subcomponents ──

function StatusBadge({ status, cents }: { status: string; cents: number }) {
  const colors = status === "cleared"
    ? "bg-green-500/15 text-green-400 border-green-500/20"
    : "bg-amber-500/15 text-amber-400 border-amber-500/20";
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${colors}`}>
      {status === "pending" ? "\u23f3 " : ""}{cents}c
    </span>
  );
}

function SheetHeader({ bin, onClose }: { bin: Bin; onClose: () => void }) {
  return (
    <div className="flex justify-between items-start mb-5">
      <div>
        <p className="text-[17px] font-display font-extrabold text-white">{bin.buildingName}</p>
        <p className="text-[12px] text-neutral-500 mt-0.5">{bin.address}</p>
      </div>
      <button onClick={onClose} className="p-1.5 text-neutral-600 hover:text-neutral-300 transition-colors duration-200 -mr-1">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function FillBar({ bin }: { bin: Bin }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] text-neutral-600 mb-1.5">
        <span>{bin.containerCount} containers</span>
        <span>{bin.fillPercent}%</span>
      </div>
      <div className="h-1.5 bg-[#2a2a2a] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${getFillBgColor(bin.fillPercent)}`}
          style={{ width: `${bin.fillPercent}%` }}
        />
      </div>
    </div>
  );
}

function MaterialBar({ bin }: { bin: Bin }) {
  if (!bin.materials || bin.containerCount === 0) return null;
  const mats = Object.entries(bin.materials) as [MaterialType, number][];
  const active = mats.filter(([, c]) => c > 0);
  if (active.length === 0) return null;

  const colors: Record<string, string> = {
    aluminium: "bg-blue-400", pet: "bg-cyan-400", glass: "bg-amber-400",
    hdpe: "bg-purple-400", liquid_paperboard: "bg-orange-400",
  };

  return (
    <div className="mt-4">
      <div className="flex h-1 rounded-full overflow-hidden bg-[#2a2a2a] mb-2.5">
        {active.map(([mat, count]) => (
          <div key={mat} className={`${colors[mat]} h-full`} style={{ width: `${(count / bin.containerCount) * 100}%` }} />
        ))}
      </div>
      <div className="flex gap-3 flex-wrap">
        {active.map(([mat, count]) => (
          <span key={mat} className="text-[11px] text-neutral-600">{MATERIAL_LABELS[mat]} {count}</span>
        ))}
      </div>
    </div>
  );
}

function PoweredByTailor() {
  return (
    <div className="flex justify-center">
      <a
        href="https://tailor.au"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-[10px] tracking-wide text-neutral-600 hover:text-neutral-400 border border-[#2a2a2a] rounded-full pl-2.5 pr-3 py-1 transition-all duration-200"
      >
        <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
          <path d="M5 0L9.33 3v6L5 12 .67 9V3L5 0z" />
        </svg>
        <span>Powered by <span className="font-bold text-neutral-500">Tailor</span></span>
      </a>
    </div>
  );
}
