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
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-80 max-w-[85vw] bg-white shadow-2xl overflow-y-auto animate-slide-in-right">
        {/* Header */}
        <div className="bg-gradient-to-br from-green-600 to-green-700 p-6 text-white">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-green-200 text-xs font-medium">Welcome back</p>
              <h2 className="text-xl font-bold">{user.name}</h2>
              <p className="text-green-300 text-xs">Unit {user.unit}</p>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full">
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l8 8M14 6l-8 8" />
              </svg>
            </button>
          </div>

          {/* Balance */}
          <div className="bg-white/10 rounded-xl p-4">
            <p className="text-green-200 text-xs">Available Balance</p>
            <p className="text-3xl font-bold">{formatCents(user.clearedCents)}</p>
            {user.pendingCents > 0 && (
              <p className="text-green-300 text-sm mt-1">
                + {formatCents(user.pendingCents)} pending
              </p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="p-4">
          <div className="grid grid-cols-3 gap-2 mb-6">
            <StatCard label="Containers" value={user.totalContainers.toString()} />
            <StatCard label="CO2 Saved" value={`${user.totalCO2SavedKg.toFixed(1)}kg`} />
            <StatCard
              label="Runs"
              value={user.runs.length.toString()}
            />
          </div>

          {/* Material breakdown */}
          {Object.keys(materialBreakdown).length > 0 && (
            <div className="mb-6">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Materials</h3>
              <div className="space-y-1.5">
                {Object.entries(materialBreakdown)
                  .sort(([, a], [, b]) => b - a)
                  .map(([material, count]) => (
                    <div key={material} className="flex justify-between items-center">
                      <span className="text-sm text-gray-600 capitalize">
                        {material.replace("_", " ")}
                      </span>
                      <span className="text-sm font-medium text-gray-800">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Recent scans */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">
              Recent Scans ({user.scans.length})
            </h3>
            {user.scans.length === 0 ? (
              <p className="text-gray-400 text-sm">No scans yet</p>
            ) : (
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {user.scans.slice(0, 20).map((scan) => (
                  <div
                    key={scan.id}
                    className="flex justify-between items-center py-1.5 border-b border-gray-50"
                  >
                    <div>
                      <p className="text-sm text-gray-700">{scan.containerName}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(scan.timestamp).toLocaleString("en-AU", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <span
                      className={`text-xs font-bold ${
                        scan.status === "cleared" ? "text-green-600" : "text-amber-500"
                      }`}
                    >
                      {scan.refundCents}c {scan.status === "pending" ? "\u23f3" : "\u2705"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cash out */}
          <button className="mt-6 w-full bg-gray-100 text-gray-400 font-medium py-3 rounded-xl text-sm cursor-not-allowed">
            Cash Out (Coming Soon)
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes slide-in-right {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.3s cubic-bezier(0.32, 0.72, 0, 1);
        }
      `}</style>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-2.5 text-center">
      <p className="text-base font-bold text-gray-800">{value}</p>
      <p className="text-[10px] text-gray-500">{label}</p>
    </div>
  );
}
