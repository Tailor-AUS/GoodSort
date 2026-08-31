"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  type User, type SortBin, type Depot,
} from "@/lib/store";
import { getUserApi, getDepotsApi, getBinsApi } from "@/lib/store-api";
import type { MarketplaceRun, RunDetail, RunnerEarnings, LeaderboardEntry } from "@/lib/marketplace";
import {
  getRunnerProfile, getAvailableRuns, getActiveRun,
  claimRun, startRun, arriveAtStop, pickupStop, skipStop,
  deliverRun, completeRun, getRunnerEarnings, getLeaderboard,
  sendHeartbeat, registerAsRunner,
} from "@/lib/marketplace-api";
import { MapView } from "@/app/components/shared/map-view";
import { RunnerSheet } from "./components/runner-sheet";
import { AccountButton } from "@/app/components/shared/account-button";
import { AccountPanel } from "@/app/components/shared/account-panel";

export default function RunnerApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [bins, setBins] = useState<SortBin[]>([]);
  const [depot, setDepot] = useState<Depot | null>(null);
  const [showAccount, setShowAccount] = useState(false);

  // Marketplace state
  const [availableRuns, setAvailableRuns] = useState<MarketplaceRun[]>([]);
  const [activeRun, setActiveRun] = useState<RunDetail | null>(null);
  const [earnings, setEarnings] = useState<RunnerEarnings | null>(null);
  const [leaderboard, setLeaderboardData] = useState<LeaderboardEntry[]>([]);
  const [runnerId, setRunnerId] = useState<string | undefined>();
  // Every marketplace call returns null on any failure — offline, 4xx, 5xx
  // alike. Without somewhere to put that, a failed pickup was a no-op: the tap
  // did nothing, said nothing, and the stop went unrecorded. At settle the
  // driver is not paid for it and the household's credit never clears.
  const [actionError, setActionError] = useState<string | null>(null);
  const [userLat, setUserLat] = useState(-27.4810);
  const [userLng, setUserLng] = useState(153.0230);
  const heartbeatRef = useRef<NodeJS.Timeout>(undefined);

  const refreshData = useCallback(async () => {
    const [apiUser, apiBins, apiDepots] = await Promise.all([
      getUserApi().catch(() => null),
      getBinsApi().catch(() => []),
      getDepotsApi().catch(() => []),
    ]);

    const currentUser = apiUser;
    if (!currentUser) return;
    setUser(currentUser);
    setBins(apiBins);
    setDepot(apiDepots[0] || null);

    // Ensure runner profile exists
    let runnerProfile = await getRunnerProfile(currentUser.id).catch(() => null);
    if (!runnerProfile) {
      runnerProfile = await registerAsRunner(currentUser.id).catch(() => null);
    }
    if (runnerProfile) setRunnerId(runnerProfile.id);

    // Load marketplace data in parallel
    const [runs, active, earningsData, boardData] = await Promise.all([
      getAvailableRuns(userLat, userLng).catch(() => []),
      getActiveRun().catch(() => null),
      getRunnerEarnings().catch(() => null),
      getLeaderboard().catch(() => []),
    ]);

    setAvailableRuns(runs);
    setActiveRun(active);
    setEarnings(earningsData);
    setLeaderboardData(boardData);
  }, [userLat, userLng]);

  // Get user location
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLat(pos.coords.latitude);
          setUserLng(pos.coords.longitude);
        },
        () => {}, // Use defaults on error
        { enableHighAccuracy: false, timeout: 5000 }
      );
    }
  }, []);

  // Initial data load
  useEffect(() => {
    refreshData().then(() => setLoading(false));
  }, [refreshData]);

  // Location heartbeat every 60s when online
  useEffect(() => {
    heartbeatRef.current = setInterval(() => {
      sendHeartbeat(userLat, userLng, true).catch(() => {});
    }, 60000);

    // Send initial heartbeat
    sendHeartbeat(userLat, userLng, true).catch(() => {});

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      sendHeartbeat(userLat, userLng, false).catch(() => {}); // Go offline
    };
  }, [userLat, userLng]);

  // ── Marketplace Actions ──

  const handleClaim = useCallback(async (runId: string) => {
    const result = await claimRun(runId);
    if (!result) {
      // Silence here is the worst of the set: another runner may have taken it,
      // and a driver who thinks they hold a run will drive to it for nothing.
      setActionError("Could not claim that run. Someone may have taken it — pull down to refresh the list.");
      return;
    }
    setActionError(null);
    {
      setActiveRun(result);
      setAvailableRuns((prev) => prev.filter((r) => r.id !== runId));
    }
  }, []);

  const handleStart = useCallback(async () => {
    if (!activeRun) return;
    const result = await startRun(activeRun.id);
    if (!result) {
      setActionError("Could not start the run. Check your signal and try again.");
      return;
    }
    setActionError(null);
    setActiveRun(result);
  }, [activeRun]);

  const handleArrive = useCallback(async (stopId: string) => {
    if (!activeRun) return;
    const arrived = await arriveAtStop(activeRun.id, stopId);
    if (!arrived) {
      setActionError("Could not record arriving at that stop. Check your signal and try again.");
      return;
    }
    setActionError(null);
    // Refresh active run to get updated stop status
    const updated = await getActiveRun();
    if (updated) setActiveRun(updated);
  }, [activeRun]);

  const handlePickup = useCallback(async (stopId: string, count: number, photoUrl?: string) => {
    if (!activeRun) return;
    const result = await pickupStop(activeRun.id, stopId, count, photoUrl);
    if (!result) {
      setActionError("That pickup did not save. Check your signal and tap it again — you will not be paid for a stop we never recorded.");
      return;
    }
    setActionError(null);
    setActiveRun(result);
  }, [activeRun]);

  const handleSkip = useCallback(async (stopId: string) => {
    if (!activeRun) return;
    const result = await skipStop(activeRun.id, stopId);
    if (!result) {
      setActionError("Could not skip that stop. Check your signal and try again.");
      return;
    }
    setActionError(null);
    setActiveRun(result);
  }, [activeRun]);

  const handleDeliver = useCallback(async () => {
    if (!activeRun) return;
    const result = await deliverRun(activeRun.id);
    if (!result) {
      setActionError("Could not mark the run as delivering. Check your signal and try again.");
      return;
    }
    setActionError(null);
    setActiveRun(result);
  }, [activeRun]);

  const handleComplete = useCallback(async () => {
    if (!activeRun) return;
    const result = await completeRun(activeRun.id);
    if (!result) {
      setActionError("Could not complete the run. Check your signal and try again — settling is what pays you.");
      return;
    }
    setActionError(null);
    setActiveRun(result);
  }, [activeRun]);

  if (loading || !user) {
    return (
      <div className="h-dvh flex items-center justify-center bg-white">
        <div className="text-slate-400 text-sm">Loading...</div>
      </div>
    );
  }

  // Build centroid markers for map from available runs
  const runCentroids = availableRuns.map((r) => ({
    id: r.id,
    lat: r.centroidLat,
    lng: r.centroidLng,
    label: r.areaName,
    containers: r.estimatedContainers,
    pricingTier: r.pricingTier,
  }));

  return (
    <div className="h-dvh relative">
      <MapView
        mode="collect"
        bins={bins}
        depot={depot}
        runCentroids={runCentroids}
        activeRunStops={activeRun?.stops}
        onMapTap={() => {}}
      />

      {actionError && (
        <div
          role="alert"
          className="fixed left-1/2 -translate-x-1/2 z-[60] max-w-sm w-[92%] bg-red-600 text-white text-[13px] font-semibold px-4 py-3 rounded-2xl shadow-xl"
          style={{ top: "calc(env(safe-area-inset-top, 16px) + 3.5rem)" }}
        >
          {actionError}
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="ml-3 underline font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="fixed z-30" style={{ top: "calc(env(safe-area-inset-top, 16px) + 0.5rem)", left: "1rem" }}>
        <AccountButton onClick={() => setShowAccount(true)} />
      </div>

      <RunnerSheet
        user={user}
        availableRuns={availableRuns}
        activeRun={activeRun}
        earnings={earnings}
        leaderboard={leaderboard}
        runnerId={runnerId}
        loading={loading}
        onClaim={handleClaim}
        onStart={handleStart}
        onArrive={handleArrive}
        onPickup={handlePickup}
        onSkip={handleSkip}
        onDeliver={handleDeliver}
        onComplete={handleComplete}
        onDataUpdate={refreshData}
      />

      <AccountPanel user={user} open={showAccount} onClose={() => { setShowAccount(false); refreshData(); }} />
    </div>
  );
}
