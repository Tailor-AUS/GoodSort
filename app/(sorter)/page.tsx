"use client";

import { useState, useCallback, useEffect } from "react";
import { type User, type SortBin, type Depot, type BagInfo } from "@/lib/store";
import { getUserApi, getDepotsApi, getBinsApi } from "@/lib/store-api";
import { getOrCreateDefaultUser, getDepots } from "@/lib/store";
import { MapView } from "@/app/components/shared/map-view";
import { SorterSheet } from "./components/sorter-sheet";
import { Scanner } from "@/app/components/shared/scanner";
import { AccountButton } from "@/app/components/shared/account-button";
import { AccountPanel } from "@/app/components/shared/account-panel";

export default function SorterApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [bins, setBins] = useState<SortBin[]>([]);
  const [depot, setDepot] = useState<Depot | null>(null);
  const [selectedBinId, setSelectedBinId] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [toast, setToast] = useState<{ text: string; visible: boolean } | null>(null);

  const refreshData = useCallback(async () => {
    const [apiUser, apiBins, apiDepots] = await Promise.all([
      getUserApi().catch(() => null),
      getBinsApi().catch(() => []),
      getDepotsApi().catch(() => []),
    ]);

    setUser(apiUser || getOrCreateDefaultUser());
    setBins(apiBins);
    setDepot((apiDepots.length > 0 ? apiDepots : getDepots())[0] || null);
  }, []);

  useEffect(() => {
    refreshData().then(() => setLoading(false));
  }, [refreshData]);

  const handleScanComplete = useCallback(
    (containerName: string, cents: number, bag: BagInfo) => {
      setShowScanner(false);
      refreshData();
      setToast({ text: `+${cents}¢ in your account · ${bag.label}`, visible: true });
      setTimeout(() => setToast((t) => (t ? { ...t, visible: false } : null)), 2500);
      setTimeout(() => setToast(null), 3000);
    },
    [refreshData]
  );

  const handleBatchComplete = useCallback(
    (totalItems: number, totalCents: number) => {
      setShowScanner(false);
      refreshData();
      setToast({ text: `+$${(totalCents / 100).toFixed(2)} in your account · ${totalItems} containers`, visible: true });
      setTimeout(() => setToast((t) => (t ? { ...t, visible: false } : null)), 3500);
      setTimeout(() => setToast(null), 4000);
    },
    [refreshData]
  );

  const handleBinSelect = useCallback((id: string) => setSelectedBinId(id), []);
  const handleMapTap = useCallback(() => setSelectedBinId(null), []);
  const selectedBin = bins.find((b) => b.id === selectedBinId) || null;

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
        bins={bins}
        selectedBinId={selectedBinId}
        activeRoute={null}
        depot={depot}
        onBinSelect={handleBinSelect}
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
        bins={bins}
        selectedBin={selectedBin}
        onScanPress={() => setShowScanner(true)}
        onDataUpdate={() => { refreshData(); setSelectedBinId(null); }}
        onDeselectBin={() => setSelectedBinId(null)}
      />

      {showScanner && (
        <Scanner onClose={() => setShowScanner(false)} onScanComplete={handleScanComplete} onBatchComplete={handleBatchComplete} />
      )}

      <AccountPanel user={user} open={showAccount} onClose={() => { setShowAccount(false); refreshData(); }} />
    </div>
  );
}
