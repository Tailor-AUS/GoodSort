"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getFullBins,
  claimBin,
  getUser,
  updateUserRole,
  formatCents,
  getFillBgColor,
  topMaterial,
  MATERIAL_LABELS,
  BIN_CAPACITY_CONTAINERS,
  type Bin,
  type User,
  type MaterialType,
  RUNNER_PAYOUT_CENTS,
} from "@/lib/store";
import Link from "next/link";

export default function RunPage() {
  const [user, setUser] = useState<User | null>(null);
  const [bins, setBins] = useState<Bin[]>([]);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [activeClaim, setActiveClaim] = useState<Bin | null>(null);

  const loadData = useCallback(() => {
    const u = getUser();
    setUser(u);
    const fullBins = getFullBins();
    setBins(fullBins);

    // Check if user has an active claim
    if (u) {
      const allBins = JSON.parse(localStorage.getItem("goodsort_bins") || "[]") as Bin[];
      const claimed = allBins.find((b) => b.status === "claimed" && b.claimedBy === u.id);
      if (claimed) setActiveClaim(claimed);
    }
  }, []);

  useEffect(() => {
    loadData();

    // Get user location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {
          // Default to Southport if no location
          setUserLocation({ lat: -27.9670, lng: 153.4000 });
        }
      );
    }
  }, [loadData]);

  function handleEnableRunner() {
    const updated = updateUserRole("both");
    setUser(updated);
  }

  function handleClaim(binId: string) {
    setClaiming(binId);
    const bin = claimBin(binId);
    if (bin) {
      setActiveClaim(bin);
      setBins(getFullBins());
    }
    setClaiming(null);
  }

  function getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLng = (lng2 - lng1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 pt-12 text-center">
        <p className="text-gray-500">Please sign up first.</p>
        <Link href="/" className="text-green-600 underline text-sm mt-2 inline-block">Go to Home</Link>
      </div>
    );
  }

  if (user.role === "sorter") {
    return (
      <div className="max-w-md mx-auto px-4 pt-8">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🗺️</div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Become a Runner</h1>
          <p className="text-gray-500">
            Full bins appear on the map like loot drops.
            Claim one, deliver it to the recycler, earn {RUNNER_PAYOUT_CENTS}c per container.
          </p>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-gray-200 mb-6">
          <h3 className="font-semibold text-gray-800 mb-3">How Running works</h3>
          <div className="space-y-3">
            <RunStep num={1} text="Full bins appear on the map — first come, first served" />
            <RunStep num={2} text="Claim a bin to lock it in — you have 2 hours to pick up" />
            <RunStep num={3} text="Collect the bin and deliver to the recycler" />
            <RunStep num={4} text="Confirm delivery — 5c per container credited instantly" />
            <RunStep num={5} text="Build streaks and climb the Runner leaderboard" />
          </div>
        </div>

        <button
          onClick={handleEnableRunner}
          className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-4 rounded-xl transition-colors text-lg"
        >
          Activate Runner Mode
        </button>
      </div>
    );
  }

  // Active claim - show pickup view
  if (activeClaim) {
    return (
      <div className="max-w-md mx-auto px-4 pt-6">
        <h1 className="text-xl font-bold text-gray-800 mb-4">Active Pickup</h1>
        <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-6 mb-4">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="font-bold text-lg text-gray-800">{activeClaim.buildingName}</p>
              <p className="text-sm text-gray-500">{activeClaim.address}</p>
            </div>
            <span className="bg-amber-400 text-amber-900 text-xs font-bold px-2 py-1 rounded-full">
              CLAIMED
            </span>
          </div>
          <div className="grid grid-cols-3 text-center mb-4 pt-4 border-t border-amber-200">
            <div>
              <p className="text-2xl font-bold text-gray-800">{activeClaim.containerCount}</p>
              <p className="text-xs text-gray-500">Containers</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{activeClaim.estimatedWeightKg}kg</p>
              <p className="text-xs text-gray-500">Est. Weight</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">
                {formatCents(activeClaim.containerCount * RUNNER_PAYOUT_CENTS)}
              </p>
              <p className="text-xs text-gray-500">You&apos;ll Earn</p>
            </div>
          </div>
          <Link
            href={`/run/pickup?binId=${activeClaim.id}`}
            className="block w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl transition-colors text-center"
          >
            I&apos;ve Delivered — Confirm Pickup
          </Link>
        </div>
      </div>
    );
  }

  // Map view with available bins
  const sortedBins = userLocation
    ? [...bins].sort((a, b) =>
        getDistance(userLocation.lat, userLocation.lng, a.lat, a.lng) -
        getDistance(userLocation.lat, userLocation.lng, b.lat, b.lng)
      )
    : bins;

  return (
    <div className="max-w-md mx-auto px-4 pt-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold text-gray-800">Runner Map</h1>
        <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">
          {bins.length} bin{bins.length !== 1 ? "s" : ""} ready
        </span>
      </div>

      {/* Map Visualization */}
      <div className="bg-gray-900 rounded-2xl p-4 mb-4 relative overflow-hidden" style={{ minHeight: 280 }}>
        {/* Stylized map grid */}
        <div className="absolute inset-0 opacity-10">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={`h-${i}`} className="absolute left-0 right-0 border-t border-white" style={{ top: `${(i + 1) * 12.5}%` }} />
          ))}
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={`v-${i}`} className="absolute top-0 bottom-0 border-l border-white" style={{ left: `${(i + 1) * 12.5}%` }} />
          ))}
        </div>

        {/* User location */}
        {userLocation && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
            <div className="w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-lg">
              <div className="w-8 h-8 bg-blue-500/20 rounded-full -mt-2 -ml-2 animate-pulse" />
            </div>
          </div>
        )}

        {/* Bin markers */}
        {sortedBins.map((bin, i) => {
          // Position bins relative to center with some spread
          const angle = (i / sortedBins.length) * 2 * Math.PI;
          const radius = 25 + (i * 8);
          const x = 50 + radius * Math.cos(angle);
          const y = 50 + radius * Math.sin(angle);

          return (
            <button
              key={bin.id}
              onClick={() => handleClaim(bin.id)}
              disabled={claiming === bin.id}
              className="absolute z-20 transform -translate-x-1/2 -translate-y-1/2 group"
              style={{ left: `${Math.min(90, Math.max(10, x))}%`, top: `${Math.min(90, Math.max(10, y))}%` }}
            >
              <div className="relative">
                <div className="w-10 h-10 bg-green-500 rounded-full border-2 border-white shadow-lg flex items-center justify-center text-white font-bold text-xs animate-pulse">
                  {bin.containerCount}
                </div>
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block group-focus:block">
                  <div className="bg-white rounded-lg p-2 shadow-lg text-left whitespace-nowrap">
                    <p className="text-xs font-bold text-gray-800">{bin.buildingName}</p>
                    <p className="text-xs text-green-600">{formatCents(bin.containerCount * RUNNER_PAYOUT_CENTS)}</p>
                  </div>
                </div>
              </div>
            </button>
          );
        })}

        {bins.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-gray-400 text-sm">No full bins right now</p>
              <p className="text-gray-500 text-xs mt-1">Check back soon — bins fill up fast</p>
            </div>
          </div>
        )}
      </div>

      {/* Bin List */}
      <div className="space-y-3">
        {sortedBins.map((bin) => {
          const dist = userLocation
            ? getDistance(userLocation.lat, userLocation.lng, bin.lat, bin.lng)
            : null;
          const dominant = bin.materials ? topMaterial(bin.materials) : "aluminium";

          return (
            <div
              key={bin.id}
              className="bg-white rounded-xl p-4 border border-gray-200"
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full animate-pulse ${getFillBgColor(bin.fillPercent)}`} />
                    <p className="font-semibold text-sm text-gray-800">{bin.buildingName}</p>
                  </div>
                  <p className="text-xs text-gray-400 ml-5">{bin.address}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-green-600">
                    {formatCents(bin.containerCount * RUNNER_PAYOUT_CENTS)}
                  </p>
                  {dist !== null && (
                    <p className="text-xs text-gray-400">{dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(1)}km`}</p>
                  )}
                </div>
              </div>

              {/* Capacity Bar */}
              <div className="mb-2">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>{bin.containerCount.toLocaleString()} / {BIN_CAPACITY_CONTAINERS.toLocaleString()}</span>
                  <span>{bin.fillPercent}% full</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${getFillBgColor(bin.fillPercent)}`}
                    style={{ width: `${bin.fillPercent}%` }}
                  />
                </div>
              </div>

              {/* Material Composition */}
              {bin.materials && (
                <div className="mb-3">
                  <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
                    {bin.containerCount > 0 && (
                      <>
                        {bin.materials.aluminium > 0 && (
                          <div className="bg-blue-500 h-full" style={{ width: `${(bin.materials.aluminium / bin.containerCount) * 100}%` }} title="Aluminium" />
                        )}
                        {bin.materials.pet > 0 && (
                          <div className="bg-cyan-400 h-full" style={{ width: `${(bin.materials.pet / bin.containerCount) * 100}%` }} title="PET" />
                        )}
                        {bin.materials.glass > 0 && (
                          <div className="bg-amber-400 h-full" style={{ width: `${(bin.materials.glass / bin.containerCount) * 100}%` }} title="Glass" />
                        )}
                        {bin.materials.hdpe > 0 && (
                          <div className="bg-purple-400 h-full" style={{ width: `${(bin.materials.hdpe / bin.containerCount) * 100}%` }} title="HDPE" />
                        )}
                        {bin.materials.liquid_paperboard > 0 && (
                          <div className="bg-orange-400 h-full" style={{ width: `${(bin.materials.liquid_paperboard / bin.containerCount) * 100}%` }} title="Carton" />
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    <span className="text-xs text-gray-500">~{bin.estimatedWeightKg}kg</span>
                    <span className="text-xs text-gray-400">Mostly {MATERIAL_LABELS[dominant]}</span>
                  </div>
                </div>
              )}

              {/* Claim Button */}
              <button
                onClick={() => handleClaim(bin.id)}
                disabled={claiming === bin.id}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {claiming === bin.id ? "Claiming..." : `CLAIM — Earn ${formatCents(bin.containerCount * RUNNER_PAYOUT_CENTS)}`}
              </button>
            </div>
          );
        })}
      </div>

      {/* Runner Stats */}
      {user.runs.length > 0 && (
        <div className="mt-6 bg-white rounded-xl p-4 border border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Your Runner Stats</h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-lg font-bold text-gray-800">{user.runs.length}</p>
              <p className="text-xs text-gray-500">Runs</p>
            </div>
            <div>
              <p className="text-lg font-bold text-gray-800">{user.streak}</p>
              <p className="text-xs text-gray-500">Day Streak</p>
            </div>
            <div>
              <p className="text-lg font-bold text-green-600">
                {formatCents(user.runs.reduce((sum, r) => sum + r.earnedCents, 0))}
              </p>
              <p className="text-xs text-gray-500">Run Earnings</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RunStep({ num, text }: { num: number; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">
        {num}
      </span>
      <p className="text-sm text-gray-600">{text}</p>
    </div>
  );
}
