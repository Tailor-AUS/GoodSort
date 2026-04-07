"use client";

import { ScanBarcode, MapPin, X, QrCode } from "lucide-react";
import { type SortBin, type User, formatCents, BAGS } from "@/lib/store";
import Link from "next/link";

interface SorterSheetProps {
  user: User;
  bins: SortBin[];
  selectedBin: SortBin | null;
  onScanPress: () => void;
  onDataUpdate: () => void;
  onDeselectBin: () => void;
}

export function SorterSheet({
  user, bins, selectedBin,
  onScanPress, onDataUpdate, onDeselectBin,
}: SorterSheetProps) {
  const activeBins = bins.filter((b) => b.status === "active" || b.status === "full");

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bottom-sheet pointer-events-none">
      <div className="pointer-events-auto glass-strong rounded-t-[2rem] shadow-[0_-4px_40px_rgba(0,0,0,0.06)] max-h-[75dvh] overflow-y-auto sheet-inner border-t border-white/40">
        <div className="flex justify-center pt-3 pb-1.5 sticky top-0 glass-strong rounded-t-[2rem] z-10">
          <div className="w-9 h-[4px] bg-slate-300/60 rounded-full" />
        </div>

        <div className="px-5 pt-2" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>

          {/* ═══════ IDLE ═══════ */}
          {!selectedBin && (
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
                className="w-full bg-gradient-to-b from-green-500 to-green-600 hover:from-green-400 hover:to-green-500 text-white font-extrabold py-4 rounded-2xl transition-all duration-200 text-[15px] mb-4 flex items-center justify-center gap-2.5 shadow-lg shadow-green-600/20 min-h-[48px]">
                <ScanBarcode className="w-5 h-5" />
                Scan Containers
              </button>

              {/* Nearby bins */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">
                    Nearby bins ({activeBins.length})
                  </p>
                </div>

                {activeBins.length > 0 ? (
                  <div className="space-y-1.5">
                    {activeBins.slice(0, 4).map((bin) => (
                      <div key={bin.id} className="flex items-center gap-3 py-2.5 px-3 glass rounded-xl border border-white/40">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm ${
                          bin.pendingContainers >= 200 ? "bg-red-500" : bin.pendingContainers >= 50 ? "bg-amber-500" : "bg-green-500"
                        }`}>
                          ♻
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] text-slate-700 font-medium truncate">{bin.name}</p>
                          <p className="text-[11px] text-slate-400">{bin.code} · {bin.pendingContainers} containers</p>
                        </div>
                        <Link href={`/scan?bin=${bin.code}`}
                          className="p-2 rounded-lg bg-green-50 text-green-600 min-w-[36px] min-h-[36px] flex items-center justify-center">
                          <QrCode className="w-4 h-4" />
                        </Link>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="glass rounded-2xl p-4 border border-white/40 text-center">
                    <p className="text-slate-400 text-[13px]">No bins nearby yet</p>
                  </div>
                )}
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

          {/* ═══════ BIN SELECTED ═══════ */}
          {selectedBin && (
            <>
              <div className="flex justify-between items-start mb-5">
                <div>
                  <p className="text-[11px] text-green-600 font-bold">{selectedBin.code}</p>
                  <p className="text-[17px] font-display font-extrabold text-slate-900">{selectedBin.name}</p>
                  <p className="text-[13px] text-slate-400 mt-0.5">{selectedBin.address}</p>
                  {selectedBin.hostedBy && <p className="text-[11px] text-slate-500 mt-0.5">Hosted by {selectedBin.hostedBy}</p>}
                </div>
                <button onClick={onDeselectBin} className="p-2.5 -mr-1 text-slate-400 hover:text-slate-600 transition-colors duration-200 min-w-[44px] min-h-[44px] flex items-center justify-center">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Bin stats */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <MiniStat label="Containers" value={selectedBin.pendingContainers.toString()} />
                <MiniStat label="Weight" value={`${selectedBin.estimatedWeightKg}kg`} />
                <MiniStat label="Status" value={selectedBin.status} />
              </div>

              {/* 4-bag breakdown */}
              {selectedBin.pendingContainers > 0 && (
                <div className="grid grid-cols-4 gap-2 mb-4">
                  {BAGS.map((bag) => {
                    const count = selectedBin.materials?.[bag.material] || 0;
                    return (
                      <div key={bag.id} className={`glass rounded-xl p-2.5 text-center border ${bag.borderColor}`}>
                        <div className={`w-6 h-6 ${bag.color} rounded-lg mx-auto mb-1.5 shadow-sm`} />
                        <p className="text-[15px] font-display font-extrabold text-slate-900">{count}</p>
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider">{bag.label.split(" ")[0]}</p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Scan at this bin */}
              <Link href={`/scan?bin=${selectedBin.code}`}
                className="block w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-4 rounded-2xl text-center text-[15px] shadow-lg shadow-green-600/20 min-h-[48px]">
                Scan at This Bin
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
