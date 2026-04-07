"use client";

import { useState, useCallback, useEffect } from "react";
import {
  getOrCreateDefaultUser, getDepots,
  type User, type SortBin, type Route, type Depot,
} from "@/lib/store";
import { getUserApi, getDepotsApi, getBinsApi, getPendingRoutesApi, getActiveRouteApi } from "@/lib/store-api";
import { MapView } from "@/app/components/shared/map-view";
import { RunnerSheet } from "./components/runner-sheet";
import { AccountButton } from "@/app/components/shared/account-button";
import { AccountPanel } from "@/app/components/shared/account-panel";

export default function RunnerApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [bins, setBins] = useState<SortBin[]>([]);
  const [pendingRoutes, setPendingRoutes] = useState<Route[]>([]);
  const [activeRoute, setActiveRoute] = useState<Route | null>(null);
  const [depot, setDepot] = useState<Depot | null>(null);
  const [selectedBinId, setSelectedBinId] = useState<string | null>(null);
  const [showAccount, setShowAccount] = useState(false);

  const refreshData = useCallback(async () => {
    const [apiUser, apiBins, apiDepots, apiPending, apiActive] = await Promise.all([
      getUserApi().catch(() => null),
      getBinsApi().catch(() => []),
      getDepotsApi().catch(() => []),
      getPendingRoutesApi().catch(() => []),
      getActiveRouteApi().catch(() => null),
    ]);

    setUser(apiUser || getOrCreateDefaultUser());
    setBins(apiBins);
    setDepot((apiDepots.length > 0 ? apiDepots : getDepots())[0] || null);
    setPendingRoutes(apiPending);
    setActiveRoute(apiActive);
  }, []);

  useEffect(() => {
    refreshData().then(() => setLoading(false));
  }, [refreshData]);

  const handleBinSelect = useCallback((id: string) => setSelectedBinId(id), []);
  const handleMapTap = useCallback(() => setSelectedBinId(null), []);

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
        bins={bins}
        selectedBinId={selectedBinId}
        activeRoute={activeRoute}
        depot={depot}
        onBinSelect={handleBinSelect}
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
        onDataUpdate={() => { refreshData(); setSelectedBinId(null); }}
      />

      <AccountPanel user={user} open={showAccount} onClose={() => { setShowAccount(false); refreshData(); }} />
    </div>
  );
}
