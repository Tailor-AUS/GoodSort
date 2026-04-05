"use client";

import { useEffect, useState } from "react";
import { getUser, formatCents, type User } from "@/lib/store";
import Link from "next/link";

export default function WalletPage() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    setUser(getUser());
  }, []);

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 pt-12 text-center">
        <p className="text-gray-500">Please sign up first.</p>
        <Link href="/" className="text-green-600 underline text-sm mt-2 inline-block">
          Go to Home
        </Link>
      </div>
    );
  }

  const materialBreakdown = user.scans.reduce(
    (acc, scan) => {
      acc[scan.material] = (acc[scan.material] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="max-w-md mx-auto px-4 pt-6">
      <h1 className="text-xl font-bold text-gray-800 mb-4">Your Wallet</h1>

      {/* Balance */}
      <div className="bg-gradient-to-br from-green-600 to-green-700 rounded-2xl p-6 text-white mb-6 shadow-lg">
        <p className="text-green-200 text-sm font-medium">Available Balance</p>
        <p className="text-4xl font-bold mt-1">{formatCents(user.balanceCents)}</p>
        <button className="mt-4 bg-white/20 hover:bg-white/30 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          Cash Out (Coming Soon)
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard label="Containers" value={user.totalContainers.toString()} />
        <StatCard label="CO2 Saved" value={`${user.totalCO2SavedKg.toFixed(1)}kg`} />
        <StatCard label="Member Since" value={new Date(user.createdAt).toLocaleDateString("en-AU", { month: "short", year: "numeric" })} />
      </div>

      {/* Material Breakdown */}
      {Object.keys(materialBreakdown).length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-gray-200 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Material Breakdown</h3>
          <div className="space-y-2">
            {Object.entries(materialBreakdown)
              .sort(([, a], [, b]) => b - a)
              .map(([material, count]) => (
                <div key={material} className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <MaterialBadge material={material} />
                    <span className="text-sm text-gray-700 capitalize">{material.replace("_", " ")}</span>
                  </div>
                  <span className="text-sm font-medium text-gray-800">{count}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Scan History */}
      <div>
        <h3 className="text-sm font-semibold text-gray-600 mb-2">
          All Scans ({user.scans.length})
        </h3>
        {user.scans.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center border border-gray-200">
            <p className="text-gray-400 text-sm">No scans yet</p>
            <Link href="/scan" className="text-green-600 underline text-sm mt-2 inline-block">
              Scan your first container
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {user.scans.map((scan) => (
              <div
                key={scan.id}
                className="bg-white rounded-lg p-3 flex justify-between items-center border border-gray-100"
              >
                <div className="flex items-center gap-3">
                  <MaterialBadge material={scan.material} />
                  <div>
                    <p className="text-sm font-medium">{scan.containerName}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(scan.timestamp).toLocaleString("en-AU", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
                <span className="text-green-600 font-bold text-sm">+{scan.refundCents}c</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl p-3 border border-gray-200 text-center">
      <p className="text-lg font-bold text-gray-800">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function MaterialBadge({ material }: { material: string }) {
  const colors: Record<string, string> = {
    aluminium: "bg-blue-100 text-blue-700",
    pet: "bg-cyan-100 text-cyan-700",
    glass: "bg-amber-100 text-amber-700",
    hdpe: "bg-purple-100 text-purple-700",
    liquid_paperboard: "bg-orange-100 text-orange-700",
  };

  const labels: Record<string, string> = {
    aluminium: "AL",
    pet: "PET",
    glass: "GL",
    hdpe: "HD",
    liquid_paperboard: "LP",
  };

  return (
    <span
      className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${
        colors[material] || "bg-gray-100 text-gray-700"
      }`}
    >
      {labels[material] || "?"}
    </span>
  );
}
