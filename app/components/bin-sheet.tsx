"use client";

import { useState } from "react";
import type { AppMode } from "./mode-toggle";
import {
  type Bin,
  formatCents,
  getFillBgColor,
  MATERIAL_LABELS,
  type MaterialType,
  RUNNER_PAYOUT_CENTS,
  claimBin,
  completeBinRun,
  unclaimBin,
} from "@/lib/store";

interface BinSheetProps {
  bin: Bin | null;
  mode: AppMode;
  onClose: () => void;
  onBinUpdate: () => void;
}

export function BinSheet({ bin, mode, onClose, onBinUpdate }: BinSheetProps) {
  const [deliveryChecks, setDeliveryChecks] = useState([false, false, false]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [earnedCents, setEarnedCents] = useState(0);
  const [settledCount, setSettledCount] = useState(0);

  if (!bin) return null;

  const runnerPayout = bin.containerCount * RUNNER_PAYOUT_CENTS;
  const isClaimed = bin.status === "claimed";

  function handleClaim() {
    const result = claimBin(bin!.id);
    if (result) onBinUpdate();
  }

  function handleUnclaim() {
    unclaimBin(bin!.id);
    onBinUpdate();
    onClose();
  }

  function handleConfirmDelivery() {
    const result = completeBinRun(bin!.id);
    if (result) {
      setEarnedCents(result.user.runs[0].earnedCents);
      setSettledCount(result.settledScans);
      setShowSuccess(true);
      setTimeout(() => {
        setShowSuccess(false);
        onBinUpdate();
        onClose();
      }, 3000);
    }
  }

  function toggleCheck(i: number) {
    const next = [...deliveryChecks];
    next[i] = !next[i];
    setDeliveryChecks(next);
  }

  if (showSuccess) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-50 animate-slide-up">
        <div className="bg-green-600 text-white rounded-t-3xl p-8 text-center shadow-2xl">
          <div className="text-5xl mb-2 animate-ka-ching">+{formatCents(earnedCents)}</div>
          <p className="text-green-100 font-semibold text-lg">Run Complete!</p>
          <p className="text-green-200 text-sm mt-1">
            {bin.containerCount} containers delivered from {bin.buildingName}
          </p>
          {settledCount > 0 && (
            <p className="text-green-200 text-sm mt-1">
              {settledCount} pending scan{settledCount !== 1 ? "s" : ""} cleared
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bottom-sheet">
      <div className="bg-white rounded-t-3xl shadow-2xl max-h-[60vh] overflow-y-auto">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        <div className="px-6 pb-6">
          {/* Header */}
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900">{bin.buildingName}</h3>
              <p className="text-sm text-gray-500">{bin.address}</p>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-600"
            >
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l8 8M14 6l-8 8" />
              </svg>
            </button>
          </div>

          {/* Fill bar */}
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{bin.containerCount} containers</span>
              <span className={getFillBgColor(bin.fillPercent).replace("bg-", "text-")}>
                {bin.fillPercent}% full
              </span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${getFillBgColor(bin.fillPercent)}`}
                style={{ width: `${bin.fillPercent}%` }}
              />
            </div>
          </div>

          {/* Material breakdown */}
          {bin.materials && bin.containerCount > 0 && (
            <div className="mb-4">
              <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 mb-2">
                {bin.materials.aluminium > 0 && (
                  <div className="bg-blue-500 h-full" style={{ width: `${(bin.materials.aluminium / bin.containerCount) * 100}%` }} />
                )}
                {bin.materials.pet > 0 && (
                  <div className="bg-cyan-400 h-full" style={{ width: `${(bin.materials.pet / bin.containerCount) * 100}%` }} />
                )}
                {bin.materials.glass > 0 && (
                  <div className="bg-amber-400 h-full" style={{ width: `${(bin.materials.glass / bin.containerCount) * 100}%` }} />
                )}
                {bin.materials.hdpe > 0 && (
                  <div className="bg-purple-400 h-full" style={{ width: `${(bin.materials.hdpe / bin.containerCount) * 100}%` }} />
                )}
                {bin.materials.liquid_paperboard > 0 && (
                  <div className="bg-orange-400 h-full" style={{ width: `${(bin.materials.liquid_paperboard / bin.containerCount) * 100}%` }} />
                )}
              </div>
              <div className="flex gap-3 flex-wrap text-xs text-gray-500">
                {(Object.entries(bin.materials) as [MaterialType, number][])
                  .filter(([, count]) => count > 0)
                  .map(([mat, count]) => (
                    <span key={mat}>{MATERIAL_LABELS[mat]}: {count}</span>
                  ))}
              </div>
            </div>
          )}

          {/* Sort mode: just info */}
          {mode === "sort" && (
            <div className="bg-green-50 rounded-xl p-4 text-center">
              <p className="text-green-700 text-sm font-medium">
                Scan your containers and drop them here
              </p>
              <p className="text-green-600 text-xs mt-1">Earn 10c pending per container</p>
            </div>
          )}

          {/* Run mode: claim / delivery */}
          {mode === "run" && !isClaimed && (
            <div>
              <div className="bg-amber-50 rounded-xl p-4 mb-3">
                <div className="flex justify-between items-center">
                  <span className="text-amber-800 text-sm font-medium">Runner Payout</span>
                  <span className="text-amber-800 text-xl font-bold">{formatCents(runnerPayout)}</span>
                </div>
                <p className="text-amber-600 text-xs mt-1">~{bin.estimatedWeightKg}kg &middot; {bin.containerCount} containers</p>
              </div>
              <button
                onClick={handleClaim}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3.5 rounded-xl transition-colors text-lg"
              >
                Claim This Bag
              </button>
            </div>
          )}

          {mode === "run" && isClaimed && (
            <div>
              <div className="bg-gray-50 rounded-xl p-4 mb-3">
                <p className="text-xs text-gray-500 mb-3">Delivery checklist:</p>
                {["Took the full bag", "Replaced with a fresh bag", "Delivered bag to depot"].map(
                  (text, i) => (
                    <label key={i} className="flex items-center gap-2 mb-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={deliveryChecks[i]}
                        onChange={() => toggleCheck(i)}
                        className="w-4 h-4 rounded border-gray-300 text-green-600"
                      />
                      <span
                        className={`text-sm ${deliveryChecks[i] ? "text-green-700 line-through" : "text-gray-700"}`}
                      >
                        {text}
                      </span>
                    </label>
                  )
                )}
              </div>
              <button
                onClick={handleConfirmDelivery}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3.5 rounded-xl transition-colors text-lg mb-2"
              >
                Confirm Delivery — {formatCents(runnerPayout)}
              </button>
              <button
                onClick={handleUnclaim}
                className="w-full bg-white border border-gray-200 text-gray-500 font-medium py-2.5 rounded-xl transition-colors text-sm"
              >
                Release Bag
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
