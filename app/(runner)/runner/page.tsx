"use client";

import { useState, useCallback, useEffect } from "react";
import {
  getOrCreateDefaultUser, getHouseholds, getRoutes, getDepots, getPendingRoutes, getActiveRoute, saveRoutes,
  type User, type Household, type Route, type Depot,
} from "@/lib/store";
import { getUserApi, getHouseholdsApi, getPendingRoutesApi, getActiveRouteApi, getDepotsApi } from "@/lib/store-api";
import { clusterHouseholds, getRouteReadyClusters, createRouteFromCluster } from "@/lib/clustering";
import { MapView } from "@/app/components/shared/map-view";
import { RunnerSheet } from "./components/runner-sheet";
import { AccountButton } from "@/app/components/shared/account-button";
import { AccountPanel } from "@/app/components/shared/account-panel";

export default function RunnerApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [pendingRoutes, setPendingRoutes] = useState<Route[]>([]);
  const [activeRoute, setActiveRoute] = useState<Route | null>(null);
  const [depot, setDepot] = useState<Depot | null>(null);
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string | null>(null);
  const [showAccount, setShowAccount] = useState(false);

  const refreshData = useCallback(async () => {
    // Try API first, fall back to localStorage
    const [apiUser, apiHouseholds, apiDepots] = await Promise.all([
      getUserApi().catch(() => null),
      getHouseholdsApi().catch(() => []),
      getDepotsApi().catch(() => []),
    ]);

    const u = apiUser || getOrCreateDefaultUser();
    const h = apiHouseholds.length > 0 ? apiHouseholds : getHouseholds();
    const depots = apiDepots.length > 0 ? apiDepots : getDepots();
    const d = depots[0] || null;

    // Auto-generate routes from clusters (localStorage fallback)
    const clusters = clusterHouseholds(h);
    const readyClusters = getRouteReadyClusters(clusters);
    const existingRoutes = getRoutes();
    const existingPending = existingRoutes.filter((r) => r.status === "pending");

    if (existingPending.length === 0 && readyClusters.length > 0 && d) {
      const newRoutes = readyClusters.map((c) => createRouteFromCluster(c, d));
      saveRoutes([...existingRoutes, ...newRoutes]);
    }

    // Try API routes, fall back to local
    const [apiPending, apiActive] = await Promise.all([
      getPendingRoutesApi().catch(() => []),
      getActiveRouteApi().catch(() => null),
    ]);

    setUser(u);
    setHouseholds(h);
    setPendingRoutes(apiPending.length > 0 ? apiPending : getPendingRoutes());
    setActiveRoute(apiActive || getActiveRoute());
    setDepot(d);
  }, []);

  useEffect(() => {
    refreshData().then(() => setLoading(false));
  }, [refreshData]);

  const handleHouseholdSelect = useCallback((id: string) => setSelectedHouseholdId(id), []);
  const handleMapTap = useCallback(() => setSelectedHouseholdId(null), []);

  if (loading || !user) {
    return (
      <div className="h-dvh flex items-center justify-center bg-white">
        <div className="text-slate-400 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-dvh relative">
      <MapView
        mode="collect"
        households={households}
        selectedHouseholdId={selectedHouseholdId}
        userHouseholdId={user.householdId}
        activeRoute={activeRoute}
        depot={depot}
        onHouseholdSelect={handleHouseholdSelect}
        onMapTap={handleMapTap}
      />

      <div className="fixed z-30" style={{ top: "calc(env(safe-area-inset-top, 16px) + 0.5rem)", left: "1rem" }}>
        <AccountButton onClick={() => setShowAccount(true)} />
      </div>

      <RunnerSheet
        user={user}
        pendingRoutes={pendingRoutes}
        activeRoute={activeRoute}
        depot={depot}
        onDataUpdate={() => { refreshData(); setSelectedHouseholdId(null); }}
      />

      <AccountPanel user={user} open={showAccount} onClose={() => { setShowAccount(false); refreshData(); }} />
    </div>
  );
}
