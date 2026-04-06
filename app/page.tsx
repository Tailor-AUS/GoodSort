"use client";

import dynamic from "next/dynamic";
import { useState, useCallback, useEffect } from "react";
import { getOrCreateDefaultUser, getBins, type User, type Bin } from "@/lib/store";
import { ModeToggle, type AppMode } from "./components/mode-toggle";
import { BinSheet } from "./components/bin-sheet";
import { ScanButton } from "./components/scan-button";
import { Scanner } from "./components/scanner";
import { AccountButton } from "./components/account-button";
import { AccountPanel } from "./components/account-panel";

// MapLibre needs browser (WebGL) — skip SSR
const MapView = dynamic(() => import("./components/map-view").then((m) => ({ default: m.MapView })), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-gray-900 flex items-center justify-center">
      <div className="text-white/30 text-sm">Loading map...</div>
    </div>
  ),
});

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<AppMode>("sort");
  const [bins, setBins] = useState<Bin[]>([]);
  const [selectedBinId, setSelectedBinId] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [toast, setToast] = useState<{ text: string; visible: boolean } | null>(null);

  useEffect(() => {
    setUser(getOrCreateDefaultUser());
    setBins(getBins());
    setLoading(false);
  }, []);

  const refreshData = useCallback(() => {
    setUser(getOrCreateDefaultUser());
    setBins(getBins());
  }, []);

  const handleBinSelect = useCallback((binId: string) => {
    setSelectedBinId(binId);
  }, []);

  const handleBinClose = useCallback(() => {
    setSelectedBinId(null);
  }, []);

  const handleScanComplete = useCallback(
    (containerName: string, cents: number) => {
      setShowScanner(false);
      refreshData();
      // Show toast
      setToast({ text: `\u23f3 +${cents}c pending \u00b7 ${containerName}`, visible: true });
      setTimeout(() => setToast((t) => (t ? { ...t, visible: false } : null)), 2500);
      setTimeout(() => setToast(null), 3000);
    },
    [refreshData]
  );

  const selectedBin = bins.find((b) => b.id === selectedBinId) || null;

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-900">
        <div className="text-white/30 text-sm">Loading...</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="h-full relative">
      {/* Map */}
      <MapView
        mode={mode}
        bins={bins}
        selectedBinId={selectedBinId}
        onBinSelect={handleBinSelect}
      />

      {/* Top bar: mode toggle + account */}
      <div className="fixed top-0 inset-x-0 z-30 flex justify-between items-center px-4 pt-[env(safe-area-inset-top,12px)] pb-2">
        <div /> {/* spacer */}
        <ModeToggle mode={mode} onChange={setMode} />
        <AccountButton user={user} onClick={() => setShowAccount(true)} />
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-20 left-1/2 -translate-x-1/2 z-40 bg-amber-500 text-white px-5 py-2.5 rounded-full shadow-lg text-sm font-medium ${
            toast.visible ? "animate-toast-in" : "animate-toast-out"
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Scan button (Sort mode only, hidden when sheet is open) */}
      {mode === "sort" && !selectedBinId && !showScanner && (
        <ScanButton onClick={() => setShowScanner(true)} />
      )}

      {/* Bin bottom sheet */}
      {selectedBin && (
        <BinSheet
          bin={selectedBin}
          mode={mode}
          onClose={handleBinClose}
          onBinUpdate={() => {
            refreshData();
            setSelectedBinId(null);
          }}
        />
      )}

      {/* Scanner overlay */}
      {showScanner && (
        <Scanner
          onClose={() => setShowScanner(false)}
          onScanComplete={handleScanComplete}
        />
      )}

      {/* Account panel */}
      <AccountPanel user={user} open={showAccount} onClose={() => { setShowAccount(false); refreshData(); }} />
    </div>
  );
}
