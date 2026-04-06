"use client";

import { ScanBarcode, MapPin, X } from "lucide-react";
import {
  type Household,
  type User,
  formatCents,
  BAGS,
} from "@/lib/store";
import Link from "next/link";

interface SorterSheetProps {
  user: User;
  households: Household[];
  selectedHousehold: Household | null;
  onScanPress: () => void;
  onDataUpdate: () => void;
  onDeselectHousehold: () => void;
}

export function SorterSheet({
  user, households, selectedHousehold,
  onScanPress, onDataUpdate, onDeselectHousehold,
}: SorterSheetProps) {
  const userHousehold = households.find((h) => h.id === user.householdId);
  const totalHouseholdsWithContainers = households.filter((h) => h.pendingContainers > 0).length;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bottom-sheet pointer-events-none">
      <div className="pointer-events-auto glass-strong rounded-t-[2rem] shadow-[0_-4px_40px_rgba(0,0,0,0.06)] max-h-[75dvh] overflow-y-auto sheet-inner border-t border-white/40">
        <div className="flex justify-center pt-3 pb-1.5 sticky top-0 glass-strong rounded-t-[2rem] z-10">
          <div className="w-9 h-[4px] bg-slate-300/60 rounded-full" />
        </div>

        <div className="px-5 pt-2" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>

          {/* ═══════ IDLE ═══════ */}
          {!selectedHousehold && (
            <>
              {/* Balance */}
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

              {/* Scan CTA */}
              <button onClick={onScanPress}
                className="w-full bg-gradient-to-b from-green-500 to-green-600 hover:from-green-400 hover:to-green-500 active:from-green-600 active:to-green-700 text-white font-extrabold py-4 rounded-2xl transition-all duration-200 text-[15px] mb-6 flex items-center justify-center gap-2.5 shadow-lg shadow-green-600/20 min-h-[48px]">
                <ScanBarcode className="w-5 h-5" />
                Scan Container
              </button>

              {/* 4-bag counts */}
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

              {/* Nearby */}
              <div className="glass rounded-2xl p-4 border border-white/40 shadow-sm mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Nearby</p>
                </div>
                <p className="text-[13px] text-slate-600">{totalHouseholdsWithContainers} household{totalHouseholdsWithContainers !== 1 ? "s" : ""} scanning</p>
              </div>

              {/* Switch to Runner */}
              <Link href="/runner"
                className="block text-center text-[13px] text-slate-400 hover:text-green-600 font-medium py-2 transition-colors duration-200">
                Switch to Runner mode →
              </Link>

              {/* Recent scans */}
              {user.scans.length > 0 && (
                <div className="mt-4">
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

          {/* ═══════ HOUSEHOLD SELECTED ═══════ */}
          {selectedHousehold && (
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
        </div>

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
