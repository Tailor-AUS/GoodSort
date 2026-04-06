"use client";

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
      <div className="fixed inset-0 z-50 bg-black/60" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 z-50 w-80 max-w-[85vw] bg-[#111] overflow-y-auto animate-slide-in-right">
        {/* Header */}
        <div className="p-6 border-b border-[#262626]">
          <div className="flex justify-between items-start mb-5">
            <div>
              <h2 className="text-xl font-bold text-white">{user.name}</h2>
              <p className="text-neutral-500 text-xs">Unit {user.unit}</p>
            </div>
            <button onClick={onClose} className="p-1 text-neutral-500 hover:text-white">
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l8 8M14 6l-8 8" />
              </svg>
            </button>
          </div>

          <div>
            <p className="text-neutral-500 text-xs uppercase tracking-wider">Available</p>
            <p className="text-3xl font-bold text-white mt-1">{formatCents(user.clearedCents)}</p>
            {user.pendingCents > 0 && (
              <p className="text-green-400/70 text-sm mt-0.5">
                + {formatCents(user.pendingCents)} pending
              </p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="p-6 border-b border-[#262626]">
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Containers" value={user.totalContainers.toString()} />
            <StatCard label="CO2 Saved" value={`${user.totalCO2SavedKg.toFixed(1)}kg`} />
            <StatCard label="Runs" value={user.runs.length.toString()} />
          </div>
        </div>

        {/* Materials */}
        {Object.keys(materialBreakdown).length > 0 && (
          <div className="p-6 border-b border-[#262626]">
            <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Materials</p>
            <div className="space-y-2">
              {Object.entries(materialBreakdown)
                .sort(([, a], [, b]) => b - a)
                .map(([material, count]) => (
                  <div key={material} className="flex justify-between">
                    <span className="text-sm text-neutral-400 capitalize">{material.replace("_", " ")}</span>
                    <span className="text-sm font-medium text-white">{count}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Recent scans */}
        <div className="p-6">
          <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">
            Scans ({user.scans.length})
          </p>
          {user.scans.length === 0 ? (
            <p className="text-neutral-600 text-sm">No scans yet</p>
          ) : (
            <div className="space-y-0 max-h-60 overflow-y-auto">
              {user.scans.slice(0, 20).map((scan) => (
                <div key={scan.id} className="flex justify-between items-center py-2 border-b border-[#1a1a1a]">
                  <div>
                    <p className="text-sm text-neutral-300">{scan.containerName}</p>
                    <p className="text-xs text-neutral-600">
                      {new Date(scan.timestamp).toLocaleString("en-AU", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <span className={`text-xs font-bold ${scan.status === "cleared" ? "text-green-400" : "text-amber-400"}`}>
                    {scan.refundCents}c
                  </span>
                </div>
              ))}
            </div>
          )}

          <button className="mt-6 w-full bg-[#262626] text-neutral-500 font-medium py-3 rounded-xl text-sm cursor-not-allowed">
            Cash Out (Coming Soon)
          </button>
        </div>
      </div>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#1a1a1a] rounded-xl p-3 text-center">
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-[10px] text-neutral-500 uppercase tracking-wider">{label}</p>
    </div>
  );
}
