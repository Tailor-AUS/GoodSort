"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getUser, formatCents, type User } from "@/lib/store";
import { Onboarding } from "./components/onboarding";

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(getUser());
    setLoading(false);
  }, []);

  if (loading) return <LoadingSkeleton />;
  if (!user) return <Onboarding onComplete={(u) => setUser(u)} />;

  return (
    <div className="max-w-md mx-auto px-4 pt-6">
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-green-700">The Good Sort</h1>
        <p className="text-gray-500 text-sm">You sort it. We collect it. The planet keeps it.</p>
      </div>

      {/* Balance Card */}
      <div className="bg-gradient-to-br from-green-600 to-green-700 rounded-2xl p-6 text-white mb-6 shadow-lg">
        <p className="text-green-200 text-sm font-medium">Your Balance</p>
        <p className="text-4xl font-bold mt-1">{formatCents(user.balanceCents)}</p>
        <div className="flex justify-between mt-4 pt-4 border-t border-green-500/30">
          <div>
            <p className="text-green-200 text-xs">Containers</p>
            <p className="text-xl font-semibold">{user.totalContainers}</p>
          </div>
          <div>
            <p className="text-green-200 text-xs">CO2 Saved</p>
            <p className="text-xl font-semibold">{user.totalCO2SavedKg.toFixed(1)} kg</p>
          </div>
          <div>
            <p className="text-green-200 text-xs">Per Scan</p>
            <p className="text-xl font-semibold">5c</p>
          </div>
        </div>
      </div>

      {/* Scan CTA */}
      <Link
        href="/scan"
        className="block bg-amber-500 hover:bg-amber-600 text-white rounded-2xl p-6 text-center mb-4 shadow-md transition-colors"
      >
        <p className="text-3xl mb-1">SCAN</p>
        <p className="text-amber-100 text-sm">Scan a container barcode to earn 5c</p>
      </Link>

      {/* Two modes */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Link
          href="/scan"
          className="bg-white rounded-xl p-4 border border-gray-200 hover:border-green-300 transition-colors"
        >
          <p className="text-sm font-semibold text-gray-800">Sort</p>
          <p className="text-xs text-gray-500">Scan containers, earn 5c each</p>
        </Link>
        <Link
          href="/run"
          className="bg-white rounded-xl p-4 border border-gray-200 hover:border-amber-300 transition-colors"
        >
          <p className="text-sm font-semibold text-gray-800">Run</p>
          <p className="text-xs text-gray-500">Find full bins, deliver, earn 5c each</p>
        </Link>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Link
          href="/wallet"
          className="bg-white rounded-xl p-4 border border-gray-200 hover:border-green-300 transition-colors"
        >
          <p className="text-sm font-semibold text-gray-800">Wallet</p>
          <p className="text-xs text-gray-500">View history &amp; balance</p>
        </Link>
        <Link
          href="/leaderboard"
          className="bg-white rounded-xl p-4 border border-gray-200 hover:border-green-300 transition-colors"
        >
          <p className="text-sm font-semibold text-gray-800">Leaderboard</p>
          <p className="text-xs text-gray-500">Buildings &amp; Runners</p>
        </Link>
      </div>

      {/* Recent Scans */}
      {user.scans.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-600 mb-2">Recent Scans</h2>
          <div className="space-y-2">
            {user.scans.slice(0, 5).map((scan) => (
              <div
                key={scan.id}
                className="bg-white rounded-lg p-3 flex justify-between items-center border border-gray-100"
              >
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
                <span className="text-green-600 font-bold text-sm">+{scan.refundCents}c</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="max-w-md mx-auto px-4 pt-6 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-48 mx-auto mb-6" />
      <div className="h-40 bg-gray-200 rounded-2xl mb-6" />
      <div className="h-24 bg-gray-200 rounded-2xl mb-4" />
    </div>
  );
}
