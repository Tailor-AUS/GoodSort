"use client";

import { useState, useCallback, useEffect } from "react";
import {
  getOrCreateDefaultUser, getHouseholds, getDepots,
  type User, type Household, type Depot, type BagInfo,
} from "@/lib/store";
import { MapView } from "@/app/components/shared/map-view";
import { SorterSheet } from "./components/sorter-sheet";
import { Scanner } from "@/app/components/shared/scanner";
import { AccountButton } from "@/app/components/shared/account-button";
import { AccountPanel } from "@/app/components/shared/account-panel";

export default function SorterApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [depot, setDepot] = useState<Depot | null>(null);
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [toast, setToast] = useState<{ text: string; visible: boolean } | null>(null);

  const refreshData = useCallback(() => {
    setUser(getOrCreateDefaultUser());
    setHouseholds(getHouseholds());
    setDepot(getDepots()[0] || null);
  }, []);

  useEffect(() => {
    refreshData();
    setLoading(false);
  }, [refreshData]);

  const handleScanComplete = useCallback(
    (containerName: string, cents: number, bag: BagInfo) => {
      setShowScanner(false);
      refreshData();
      setToast({ text: `+${cents}c · ${bag.label} · ${containerName}`, visible: true });
      setTimeout(() => setToast((t) => (t ? { ...t, visible: false } : null)), 2500);
      setTimeout(() => setToast(null), 3000);
    },
    [refreshData]
  );

  const handleBatchComplete = useCallback(
    (totalItems: number, totalCents: number) => {
      setShowScanner(false);
      refreshData();
      setToast({ text: `+$${(totalCents / 100).toFixed(2)} pending · ${totalItems} containers`, visible: true });
      setTimeout(() => setToast((t) => (t ? { ...t, visible: false } : null)), 3500);
      setTimeout(() => setToast(null), 4000);
    },
    [refreshData]
  );

  const handleHouseholdSelect = useCallback((id: string) => setSelectedHouseholdId(id), []);
  const handleMapTap = useCallback(() => setSelectedHouseholdId(null), []);
  const selectedHousehold = households.find((h) => h.id === selectedHouseholdId) || null;

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
        mode="sort"
        households={households}
        selectedHouseholdId={selectedHouseholdId}
        userHouseholdId={user.householdId}
        activeRoute={null}
        depot={depot}
        onHouseholdSelect={handleHouseholdSelect}
        onMapTap={handleMapTap}
      />

      <div className="fixed z-30" style={{ top: "calc(env(safe-area-inset-top, 16px) + 0.5rem)", left: "1rem" }}>
        <AccountButton onClick={() => setShowAccount(true)} />
      </div>

      {toast && (
        <div
          className={`fixed left-1/2 z-[45] glass-strong border border-slate-200/50 text-slate-900 px-5 py-2.5 rounded-full shadow-xl text-sm font-medium ${toast.visible ? "animate-toast-in" : "animate-toast-out"}`}
          style={{ top: "calc(env(safe-area-inset-top, 16px) + 3.5rem)" }}
        >
          <span className="text-green-600">{toast.text}</span>
        </div>
      )}

      <SorterSheet
        user={user}
        households={households}
        selectedHousehold={selectedHousehold}
        onScanPress={() => setShowScanner(true)}
        onDataUpdate={() => { refreshData(); setSelectedHouseholdId(null); }}
        onDeselectHousehold={() => setSelectedHouseholdId(null)}
      />

      {showScanner && (
        <Scanner onClose={() => setShowScanner(false)} onScanComplete={handleScanComplete} onBatchComplete={handleBatchComplete} />
      )}

      <AccountPanel user={user} open={showAccount} onClose={() => { setShowAccount(false); refreshData(); }} />
    </div>
  );
}
