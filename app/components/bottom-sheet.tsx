"use client";

import { useState } from "react";
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
  const [showSuccess, setShowSuccess] = useState<{ earned: number; count: number; settled: number } | null>(null);

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
        settled: result.settledScans,
      });
      setDeliveryChecks([false, false, false]);
      setTimeout(() => {
        setShowSuccess(null);
        onBinUpdate();
        onDeselectBin();
      }, 3000);
    }
  }

  function toggleCheck(i: number) {
    const next = [...deliveryChecks];
    next[i] = !next[i];
    setDeliveryChecks(next);
  }

  // Success overlay
  if (showSuccess) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-40">
        <div className="bg-[#1a1a1a] rounded-t-3xl p-8 text-center animate-slide-up">
          <div className="text-5xl font-bold text-green-400 mb-2 animate-ka-ching">
            +{formatCents(showSuccess.earned)}
          </div>
          <p className="text-white font-semibold text-lg">Delivery Complete</p>
          <p className="text-neutral-400 text-sm mt-1">
            {showSuccess.count} containers delivered
          </p>
          {showSuccess.settled > 0 && (
            <p className="text-green-400/70 text-sm mt-1">
              {showSuccess.settled} pending scan{showSuccess.settled !== 1 ? "s" : ""} cleared
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bottom-sheet">
      <div className="bg-[#1a1a1a] rounded-t-3xl shadow-[0_-4px_30px_rgba(0,0,0,0.5)] max-h-[70vh] overflow-y-auto">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 bg-neutral-600 rounded-full" />
        </div>

        <div className="px-5 pb-6">
          {/* Mode toggle — only show when no bin selected */}
          {!selectedBin && (
            <div className="flex bg-[#262626] rounded-full p-1 mb-5">
              <button
                onClick={() => onModeChange("sort")}
                className={`flex-1 py-2.5 rounded-full text-sm font-semibold transition-all ${
                  mode === "sort"
                    ? "bg-green-500 text-black"
                    : "text-neutral-400"
                }`}
              >
                Sort
              </button>
              <button
                onClick={() => onModeChange("run")}
                className={`flex-1 py-2.5 rounded-full text-sm font-semibold transition-all ${
                  mode === "run"
                    ? "bg-green-500 text-black"
                    : "text-neutral-400"
                }`}
              >
                Run
              </button>
            </div>
          )}

          {/* ── SORT MODE: Idle ── */}
          {mode === "sort" && !selectedBin && (
            <>
              {/* Balance */}
              <div className="mb-5">
                <p className="text-neutral-500 text-xs font-medium uppercase tracking-wider">Balance</p>
                <p className="text-4xl font-bold text-white mt-1">
                  {formatCents(user.clearedCents)}
                </p>
                {user.pendingCents > 0 && (
                  <p className="text-green-400/70 text-sm mt-0.5">
                    + {formatCents(user.pendingCents)} pending
                  </p>
                )}
              </div>

              {/* Scan CTA */}
              <button
                onClick={onScanPress}
                className="w-full bg-green-500 hover:bg-green-400 text-black font-bold py-4 rounded-2xl transition-colors text-base mb-5 flex items-center justify-center gap-2"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2" />
                  <line x1="7" y1="12" x2="17" y2="12" />
                </svg>
                Scan Container
              </button>

              {/* User's bin status */}
              {userBin && (
                <div className="bg-[#262626] rounded-2xl p-4">
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-sm text-neutral-400">Your bin</p>
                    <p className="text-sm text-white font-medium">{userBin.buildingName}</p>
                  </div>
                  <div className="flex justify-between text-xs text-neutral-500 mb-1.5">
                    <span>{userBin.containerCount} containers</span>
                    <span className={getFillBgColor(userBin.fillPercent).replace("bg-", "text-")}>
                      {userBin.fillPercent}%
                    </span>
                  </div>
                  <div className="h-2 bg-[#333] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${getFillBgColor(userBin.fillPercent)}`}
                      style={{ width: `${userBin.fillPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Recent scans */}
              {user.scans.length > 0 && (
                <div className="mt-5">
                  <p className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Recent</p>
                  {user.scans.slice(0, 3).map((scan) => (
                    <div key={scan.id} className="flex justify-between items-center py-2 border-b border-[#262626]">
                      <span className="text-sm text-neutral-300">{scan.containerName}</span>
                      <span className={`text-sm font-semibold ${scan.status === "cleared" ? "text-green-400" : "text-amber-400"}`}>
                        {scan.refundCents}c
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── RUN MODE: Idle ── */}
          {mode === "run" && !selectedBin && (
            <>
              <div className="mb-5">
                <p className="text-3xl font-bold text-white">
                  {fullBins.length} bag{fullBins.length !== 1 ? "s" : ""} ready
                </p>
                <p className="text-neutral-500 text-sm mt-0.5">
                  ~{formatCents(totalAvailableEarnings)} available
                </p>
              </div>

              {fullBins.length === 0 ? (
                <div className="bg-[#262626] rounded-2xl p-6 text-center">
                  <p className="text-neutral-500 text-sm">No bags ready for collection</p>
                  <p className="text-neutral-600 text-xs mt-1">Check back soon</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {fullBins.map((bin) => (
                    <button
                      key={bin.id}
                      onClick={() => {/* parent handles via onBinSelect */}}
                      className="w-full bg-[#262626] rounded-2xl p-4 text-left hover:bg-[#2a2a2a] transition-colors"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-white font-semibold">{bin.buildingName}</p>
                          <p className="text-neutral-500 text-xs mt-0.5">{bin.containerCount} containers</p>
                        </div>
                        <p className="text-green-400 font-bold">
                          {formatCents(bin.containerCount * RUNNER_PAYOUT_CENTS)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── BIN SELECTED (Sort mode) ── */}
          {mode === "sort" && selectedBin && (
            <>
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className="text-lg font-bold text-white">{selectedBin.buildingName}</p>
                  <p className="text-sm text-neutral-500">{selectedBin.address}</p>
                </div>
                <button onClick={onDeselectBin} className="p-1 text-neutral-500 hover:text-white">
                  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 6l8 8M14 6l-8 8" />
                  </svg>
                </button>
              </div>

              <FillBar bin={selectedBin} />
              <MaterialBar bin={selectedBin} />

              <div className="bg-[#262626] rounded-2xl p-4 mt-4 text-center">
                <p className="text-green-400 text-sm font-medium">Drop your containers here</p>
                <p className="text-neutral-500 text-xs mt-1">Earn 10c pending per container</p>
              </div>
            </>
          )}

          {/* ── BIN SELECTED (Run mode, not claimed) ── */}
          {mode === "run" && selectedBin && !isClaimed && (
            <>
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className="text-lg font-bold text-white">{selectedBin.buildingName}</p>
                  <p className="text-sm text-neutral-500">{selectedBin.address}</p>
                </div>
                <button onClick={onDeselectBin} className="p-1 text-neutral-500 hover:text-white">
                  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 6l8 8M14 6l-8 8" />
                  </svg>
                </button>
              </div>

              <FillBar bin={selectedBin} />

              <div className="bg-[#262626] rounded-2xl p-4 mt-4 mb-4">
                <div className="flex justify-between items-center">
                  <span className="text-neutral-400 text-sm">Payout</span>
                  <span className="text-green-400 text-xl font-bold">
                    {formatCents(selectedBin.containerCount * RUNNER_PAYOUT_CENTS)}
                  </span>
                </div>
                <p className="text-neutral-600 text-xs mt-1">
                  {selectedBin.containerCount} containers &middot; ~{selectedBin.estimatedWeightKg}kg
                </p>
              </div>

              <button
                onClick={handleClaim}
                className="w-full bg-green-500 hover:bg-green-400 text-black font-bold py-4 rounded-2xl transition-colors text-base"
              >
                Claim This Bag
              </button>
            </>
          )}

          {/* ── BAG CLAIMED (delivery flow) ── */}
          {mode === "run" && selectedBin && isClaimed && (
            <>
              <div className="mb-4">
                <p className="text-neutral-500 text-xs uppercase tracking-wider">Picking up from</p>
                <p className="text-xl font-bold text-white mt-1">{selectedBin.buildingName}</p>
                <p className="text-sm text-neutral-500">{selectedBin.address}</p>
              </div>

              <div className="bg-[#262626] rounded-2xl p-4 mb-4">
                {["Took the full bag", "Replaced with a fresh bag", "Delivered bag to depot"].map(
                  (text, i) => (
                    <label key={i} className="flex items-center gap-3 py-2.5 cursor-pointer">
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                          deliveryChecks[i]
                            ? "bg-green-500 border-green-500"
                            : "border-neutral-600"
                        }`}
                        onClick={() => toggleCheck(i)}
                      >
                        {deliveryChecks[i] && (
                          <svg width="12" height="12" fill="none" stroke="black" strokeWidth="3">
                            <path d="M2 6l3 3 5-5" />
                          </svg>
                        )}
                      </div>
                      <span className={`text-sm ${deliveryChecks[i] ? "text-green-400" : "text-neutral-300"}`}>
                        {text}
                      </span>
                    </label>
                  )
                )}
              </div>

              <button
                onClick={handleConfirmDelivery}
                className="w-full bg-green-500 hover:bg-green-400 text-black font-bold py-4 rounded-2xl transition-colors text-base mb-2"
              >
                Confirm Delivery &middot; {formatCents(selectedBin.containerCount * RUNNER_PAYOUT_CENTS)}
              </button>
              <button
                onClick={handleUnclaim}
                className="w-full text-neutral-500 font-medium py-2.5 text-sm hover:text-neutral-300 transition-colors"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FillBar({ bin }: { bin: Bin }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-neutral-500 mb-1.5">
        <span>{bin.containerCount} containers</span>
        <span className={getFillBgColor(bin.fillPercent).replace("bg-", "text-")}>
          {bin.fillPercent}%
        </span>
      </div>
      <div className="h-2 bg-[#333] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${getFillBgColor(bin.fillPercent)}`}
          style={{ width: `${bin.fillPercent}%` }}
        />
      </div>
    </div>
  );
}

function MaterialBar({ bin }: { bin: Bin }) {
  if (!bin.materials || bin.containerCount === 0) return null;
  return (
    <div className="mt-3">
      <div className="flex h-1.5 rounded-full overflow-hidden bg-[#333] mb-2">
        {bin.materials.aluminium > 0 && <div className="bg-blue-400 h-full" style={{ width: `${(bin.materials.aluminium / bin.containerCount) * 100}%` }} />}
        {bin.materials.pet > 0 && <div className="bg-cyan-400 h-full" style={{ width: `${(bin.materials.pet / bin.containerCount) * 100}%` }} />}
        {bin.materials.glass > 0 && <div className="bg-amber-400 h-full" style={{ width: `${(bin.materials.glass / bin.containerCount) * 100}%` }} />}
        {bin.materials.hdpe > 0 && <div className="bg-purple-400 h-full" style={{ width: `${(bin.materials.hdpe / bin.containerCount) * 100}%` }} />}
        {bin.materials.liquid_paperboard > 0 && <div className="bg-orange-400 h-full" style={{ width: `${(bin.materials.liquid_paperboard / bin.containerCount) * 100}%` }} />}
      </div>
      <div className="flex gap-3 flex-wrap text-xs text-neutral-600">
        {(Object.entries(bin.materials) as [MaterialType, number][])
          .filter(([, count]) => count > 0)
          .map(([mat, count]) => (
            <span key={mat}>{MATERIAL_LABELS[mat]}: {count}</span>
          ))}
      </div>
    </div>
  );
}
