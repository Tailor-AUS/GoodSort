"use client";

import { useState, useCallback, useEffect } from "react";
import { getOrCreateDefaultUser, getBins, type User, type Bin } from "@/lib/store";
import { MapView, type AppMode } from "./components/map-view";
import { BottomSheet } from "./components/bottom-sheet";
import { Scanner } from "./components/scanner";
import { AccountButton } from "./components/account-button";
import { AccountPanel } from "./components/account-panel";

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

  const handleScanComplete = useCallback(
    (containerName: string, cents: number) => {
      setShowScanner(false);
      refreshData();
      setToast({ text: `+${cents}c pending \u00b7 ${containerName}`, visible: true });
      setTimeout(() => setToast((t) => (t ? { ...t, visible: false } : null)), 2500);
      setTimeout(() => setToast(null), 3000);
    },
    [refreshData]
  );

  const selectedBin = bins.find((b) => b.id === selectedBinId) || null;

  if (loading || !user) {
    return (
      <div className="h-full flex items-center justify-center bg-black">
        <div className="text-neutral-600 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-full relative">
      {/* Map — full screen */}
      <MapView
        mode={mode}
        bins={bins}
        selectedBinId={selectedBinId}
        onBinSelect={(id) => setSelectedBinId(id)}
        onMapTap={() => { if (selectedBinId) setSelectedBinId(null); }}
      />

      {/* Account — top left */}
      <div className="fixed top-4 left-4 z-30">
        <AccountButton user={user} onClick={() => setShowAccount(true)} />
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-16 left-1/2 z-40 bg-[#1a1a1a] border border-[#333] text-white px-5 py-2.5 rounded-full shadow-lg text-sm font-medium ${
            toast.visible ? "animate-toast-in" : "animate-toast-out"
          }`}
        >
          <span className="text-green-400">{toast.text}</span>
        </div>
      )}

      {/* Bottom sheet — always visible */}
      <BottomSheet
        mode={mode}
        onModeChange={setMode}
        user={user}
        bins={bins}
        selectedBin={selectedBin}
        onScanPress={() => setShowScanner(true)}
        onBinUpdate={refreshData}
        onDeselectBin={() => setSelectedBinId(null)}
      />

      {/* Scanner overlay */}
      {showScanner && (
        <Scanner
          onClose={() => setShowScanner(false)}
          onScanComplete={handleScanComplete}
        />
      )}

      {/* Account panel */}
      <AccountPanel
        user={user}
        open={showAccount}
        onClose={() => { setShowAccount(false); refreshData(); }}
      />
    </div>
  );
}
