"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { completeBinRun, unclaimBin, formatCents, type User, type Bin } from "@/lib/store";
import Link from "next/link";

function PickupContent() {
  const searchParams = useSearchParams();
  const binId = searchParams.get("binId");
  const [result, setResult] = useState<{ user: User; bin: Bin; settledScans: number } | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  function handleConfirm() {
    if (!binId) return;
    const res = completeBinRun(binId);
    if (res) {
      setResult(res);
      setConfirmed(true);
    }
  }

  function handleCancel() {
    if (!binId) return;
    unclaimBin(binId);
    window.location.href = "/run";
  }

  if (!binId) {
    return (
      <div className="max-w-md mx-auto px-4 pt-12 text-center">
        <p className="text-gray-500">No bin selected.</p>
        <Link href="/run" className="text-green-600 underline text-sm mt-2 inline-block">Back to Map</Link>
      </div>
    );
  }

  if (confirmed && result) {
    const latestRun = result.user.runs[0];
    return (
      <div className="max-w-md mx-auto px-4 pt-6">
        <div className="animate-slide-up text-center">
          <div className="bg-green-50 border-2 border-green-500 rounded-2xl p-8 mb-6">
            <div className="text-5xl mb-2 animate-ka-ching">
              +{formatCents(latestRun.earnedCents)}
            </div>
            <p className="text-green-800 font-semibold text-lg mb-1">Run Complete!</p>
            <p className="text-green-600 text-sm">
              {latestRun.containerCount} containers delivered from {latestRun.buildingName}
            </p>

            {result.settledScans > 0 && (
              <p className="text-green-600 text-sm mt-3">
                {result.settledScans} pending scan{result.settledScans !== 1 ? "s" : ""} verified and cleared
              </p>
            )}

            <div className="flex justify-around mt-6 pt-4 border-t border-green-200">
              <div>
                <p className="text-xs text-green-600">Cleared Balance</p>
                <p className="text-xl font-bold text-green-800">{formatCents(result.user.clearedCents)}</p>
              </div>
              <div>
                <p className="text-xs text-green-600">Streak</p>
                <p className="text-xl font-bold text-green-800">{result.user.streak} day{result.user.streak !== 1 ? "s" : ""}</p>
              </div>
              <div>
                <p className="text-xs text-green-600">Total Runs</p>
                <p className="text-xl font-bold text-green-800">{result.user.runs.length}</p>
              </div>
            </div>

            {/* Badge notification */}
            {result.user.badges.length > 0 && (
              <div className="mt-4 pt-4 border-t border-green-200">
                <p className="text-xs text-green-600 mb-2">Badges</p>
                <div className="flex justify-center gap-2">
                  {result.user.badges.map((badge) => (
                    <span key={badge} className="text-2xl">{getBadgeIcon(badge)}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Link
              href="/run"
              className="block w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 rounded-xl transition-colors text-center"
            >
              Find Another Bin
            </Link>
            <Link
              href="/leaderboard"
              className="block w-full bg-white border border-gray-200 text-gray-700 font-semibold py-3 rounded-xl transition-colors text-center"
            >
              View Leaderboards
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 pt-6">
      <h1 className="text-xl font-bold text-gray-800 mb-4">Confirm Delivery</h1>

      <div className="bg-white rounded-2xl p-6 border border-gray-200 mb-6">
        <p className="text-gray-600 text-sm mb-4">
          Have you collected the bin and delivered the containers to the recycler?
        </p>
        <div className="bg-gray-50 rounded-lg p-4 mb-4">
          <p className="text-xs text-gray-500 mb-2">Delivery checklist:</p>
          <ul className="space-y-2">
            <CheckItem text="Collected bin from the building" />
            <CheckItem text="Delivered containers to recycler" />
            <CheckItem text="Returned empty bin to building" />
          </ul>
        </div>
      </div>

      <button
        onClick={handleConfirm}
        className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-4 rounded-xl transition-colors text-lg mb-3"
      >
        Confirm Delivery — Get Paid
      </button>
      <button
        onClick={handleCancel}
        className="w-full bg-white border border-gray-200 text-gray-500 font-medium py-3 rounded-xl transition-colors"
      >
        Cancel — Release Bin
      </button>
    </div>
  );
}

function CheckItem({ text }: { text: string }) {
  const [checked, setChecked] = useState(false);
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => setChecked(e.target.checked)}
        className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
      />
      <span className={`text-sm ${checked ? "text-green-700 line-through" : "text-gray-700"}`}>{text}</span>
    </label>
  );
}

function getBadgeIcon(badge: string): string {
  const icons: Record<string, string> = {
    first_run: "🏃",
    week_warrior: "🔥",
    ten_runs: "⭐",
    fifty_runs: "👑",
  };
  return icons[badge] || "🏅";
}

export default function PickupPage() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto px-4 pt-12 text-center animate-pulse"><div className="h-40 bg-gray-200 rounded-2xl" /></div>}>
      <PickupContent />
    </Suspense>
  );
}
