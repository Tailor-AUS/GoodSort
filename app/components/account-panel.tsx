"use client";

import { X, Package, Leaf, Truck, Wallet } from "lucide-react";
import { formatCents, type User } from "@/lib/store";

interface AccountPanelProps {
  user: User;
  open: boolean;
  onClose: () => void;
}

export function AccountPanel({ user, open, onClose }: AccountPanelProps) {
  if (!open) return null;

  const materialBreakdown = user.scans.reduce(
    (acc, scan) => {
      acc[scan.material] = (acc[scan.material] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/70" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 z-50 w-80 max-w-[85vw] bg-[#111] overflow-y-auto animate-slide-in-right border-l border-[#222]">
        {/* Header */}
        <div className="p-6 border-b border-[#1e1e1e]">
          <div className="flex justify-between items-start mb-6">
            <div>
              <p className="text-[11px] text-neutral-500 font-semibold uppercase tracking-[0.15em]">Account</p>
              <h2 className="text-xl font-display font-extrabold text-white mt-1">{user.name}</h2>
            </div>
            <button onClick={onClose} className="p-1.5 text-neutral-600 hover:text-neutral-300 transition-colors duration-200">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="bg-[#1e1e1e] rounded-2xl p-4 border border-[#2a2a2a]">
            <p className="text-[11px] text-neutral-500 font-semibold uppercase tracking-[0.15em]">Available</p>
            <p className="text-3xl font-display font-extrabold text-white mt-1">{formatCents(user.clearedCents)}</p>
            {user.pendingCents > 0 && (
              <p className="text-green-400/50 text-sm font-medium mt-0.5">
                + {formatCents(user.pendingCents)} pending
              </p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="p-6 border-b border-[#1e1e1e]">
          <div className="grid grid-cols-3 gap-2">
            <StatCard icon={Package} label="Sorted" value={user.totalContainers.toString()} />
            <StatCard icon={Leaf} label="CO2" value={`${user.totalCO2SavedKg.toFixed(1)}kg`} />
            <StatCard icon={Truck} label="Runs" value={user.runs.length.toString()} />
          </div>
        </div>

        {/* Materials */}
        {Object.keys(materialBreakdown).length > 0 && (
          <div className="p-6 border-b border-[#1e1e1e]">
            <p className="text-[11px] text-neutral-500 font-semibold uppercase tracking-[0.15em] mb-3">Materials</p>
            <div className="space-y-2.5">
              {Object.entries(materialBreakdown)
                .sort(([, a], [, b]) => b - a)
                .map(([material, count]) => (
                  <div key={material} className="flex justify-between items-center">
                    <span className="text-[13px] text-neutral-400 capitalize">{material.replace("_", " ")}</span>
                    <span className="text-[13px] font-bold text-white">{count}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Recent scans */}
        <div className="p-6">
          <p className="text-[11px] text-neutral-500 font-semibold uppercase tracking-[0.15em] mb-3">
            History ({user.scans.length})
          </p>
          {user.scans.length === 0 ? (
            <p className="text-neutral-600 text-[13px]">No scans yet</p>
          ) : (
            <div className="space-y-0 max-h-64 overflow-y-auto">
              {user.scans.slice(0, 20).map((scan) => (
                <div key={scan.id} className="flex justify-between items-center py-2.5 border-b border-[#1a1a1a] last:border-0">
                  <div>
                    <p className="text-[13px] text-neutral-300 font-medium">{scan.containerName}</p>
                    <p className="text-[11px] text-neutral-600">
                      {new Date(scan.timestamp).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                    scan.status === "cleared"
                      ? "bg-green-500/15 text-green-400 border-green-500/20"
                      : "bg-amber-500/15 text-amber-400 border-amber-500/20"
                  }`}>
                    {scan.refundCents}c
                  </span>
                </div>
              ))}
            </div>
          )}

          <button className="mt-6 w-full bg-[#1e1e1e] border border-[#2a2a2a] text-neutral-500 font-semibold py-3 rounded-xl text-[13px] cursor-not-allowed flex items-center justify-center gap-2">
            <Wallet className="w-4 h-4" />
            Cash Out (Coming Soon)
          </button>
        </div>
      </div>
    </>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="bg-[#1a1a1a] rounded-xl p-3 text-center border border-[#222]">
      <Icon className="w-4 h-4 text-green-400/60 mx-auto mb-1.5" />
      <p className="text-base font-display font-extrabold text-white">{value}</p>
      <p className="text-[9px] text-neutral-600 uppercase tracking-[0.15em] mt-0.5">{label}</p>
    </div>
  );
}
