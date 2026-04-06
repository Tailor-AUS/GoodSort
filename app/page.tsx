"use client";

import { useState, useCallback, useEffect } from "react";
import {
  getOrCreateDefaultUser, getHouseholds, getRoutes, getDepots, getPendingRoutes, getActiveRoute, saveRoutes,
  type User, type Household, type Route, type Depot, type BagInfo,
} from "@/lib/store";
import { clusterHouseholds, getRouteReadyClusters, createRouteFromCluster } from "@/lib/clustering";
import { MapView, type AppMode } from "./components/map-view";
import { BottomSheet } from "./components/bottom-sheet";
import { Scanner } from "./components/scanner";
import { AccountButton } from "./components/account-button";
import { AccountPanel } from "./components/account-panel";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<AppMode>("sort");
  const [households, setHouseholds] = useState<Household[]>([]);
  const [pendingRoutes, setPendingRoutes] = useState<Route[]>([]);
  const [activeRoute, setActiveRoute] = useState<Route | null>(null);
  const [depot, setDepot] = useState<Depot | null>(null);
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [toast, setToast] = useState<{ text: string; visible: boolean } | null>(null);

  const refreshData = useCallback(() => {
    const u = getOrCreateDefaultUser();
    const h = getHouseholds();
    const depots = getDepots();
    const d = depots[0] || null;

    // Auto-generate routes from clusters
    const clusters = clusterHouseholds(h);
    const readyClusters = getRouteReadyClusters(clusters);
    const existingRoutes = getRoutes();
    const existingPending = existingRoutes.filter((r) => r.status === "pending");

    // Only generate new routes if none exist
    if (existingPending.length === 0 && readyClusters.length > 0 && d) {
      const newRoutes = readyClusters.map((c) => createRouteFromCluster(c, d));
      const allRoutes = [...existingRoutes, ...newRoutes];
      saveRoutes(allRoutes);
    }

    setUser(u);
    setHouseholds(h);
    setPendingRoutes(getPendingRoutes());
    setActiveRoute(getActiveRoute());
    setDepot(d);
  }, []);

  useEffect(() => {
    refreshData();
    setLoading(false);
  }, [refreshData]);

  const handleScanComplete = useCallback(
    (containerName: string, cents: number, bag: BagInfo) => {
      setShowScanner(false);
      refreshData();
      setToast({ text: `+${cents}c \u00b7 ${bag.label} \u00b7 ${containerName}`, visible: true });
      setTimeout(() => setToast((t) => (t ? { ...t, visible: false } : null)), 2500);
      setTimeout(() => setToast(null), 3000);
    },
    [refreshData]
  );

  const selectedHousehold = households.find((h) => h.id === selectedHouseholdId) || null;

  if (loading || !user) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <div className="text-slate-400 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-full relative">
      <MapView
        mode={mode}
        households={households}
        selectedHouseholdId={selectedHouseholdId}
        userHouseholdId={user.householdId}
        activeRoute={activeRoute}
        depot={depot}
        onHouseholdSelect={(id) => setSelectedHouseholdId(id)}
        onMapTap={() => { if (selectedHouseholdId) setSelectedHouseholdId(null); }}
      />

      <div className="fixed top-4 left-4 z-30">
        <AccountButton user={user} onClick={() => setShowAccount(true)} />
      </div>

      {toast && (
        <div className={`fixed top-16 left-1/2 z-40 bg-white border border-slate-200 text-slate-900 px-5 py-2.5 rounded-full shadow-lg text-sm font-medium ${toast.visible ? "animate-toast-in" : "animate-toast-out"}`}>
          <span className="text-green-600">{toast.text}</span>
        </div>
      )}

      <BottomSheet
        mode={mode}
        onModeChange={setMode}
        user={user}
        households={households}
        selectedHousehold={selectedHousehold}
        pendingRoutes={pendingRoutes}
        activeRoute={activeRoute}
        depot={depot}
        onScanPress={() => setShowScanner(true)}
        onDataUpdate={() => { refreshData(); setSelectedHouseholdId(null); }}
        onDeselectHousehold={() => setSelectedHouseholdId(null)}
      />

      {showScanner && (
        <Scanner onClose={() => setShowScanner(false)} onScanComplete={handleScanComplete} />
      )}

      <AccountPanel user={user} open={showAccount} onClose={() => { setShowAccount(false); refreshData(); }} />
    </div>
  );
}
