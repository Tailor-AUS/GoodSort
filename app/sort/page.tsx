"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { type User, type SortBin, type Depot, type BagInfo, getUser } from "@/lib/store";
import { getUserApi, getDepotsApi, getBinsApi } from "@/lib/store-api";
import { apiUrl, authHeaders } from "@/lib/config";
import { isCollecting, LIVE_VOLUME_THRESHOLD, residentialNeedsStreet, sameSuburb, streetStatsForViewer, type GrowthSuburb } from "@/lib/brisbane";
import { getDepots } from "@/lib/store";
import { MapView } from "@/app/components/shared/map-view";
import { SorterSheet, type HouseholdStatus } from "./components/sorter-sheet";
import { WaitlistHome } from "./components/waitlist-home";
import { Scanner } from "@/app/components/shared/scanner";
import { AccountButton } from "@/app/components/shared/account-button";
import { AccountPanel } from "@/app/components/shared/account-panel";

function userFromProfile(): User | null {
  try {
    const p = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
    if (!p.id) return null;
    return {
      id: p.id,
      name: p.name || "You",
      householdId: p.householdId || "",
      role: "sorter",
      pendingCents: 0,
      clearedCents: 0,
      totalContainers: 0,
      totalCO2SavedKg: 0,
      scans: [],
      collections: [],
      badges: [],
      createdAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export default function SorterApp() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [bins, setBins] = useState<SortBin[]>([]);
  const [depot, setDepot] = useState<Depot | null>(null);
  const [selectedBinId, setSelectedBinId] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [toast, setToast] = useState<{ text: string; visible: boolean } | null>(null);
  const [household, setHousehold] = useState<HouseholdStatus | null>(null);
  const [nextPickup, setNextPickup] = useState<string | null>(null);
  const [pickupConfirmed, setPickupConfirmed] = useState(false);

  const refreshData = useCallback(async () => {
    const [apiUser, apiBins, apiDepots] = await Promise.all([
      getUserApi().catch(() => null),
      getBinsApi().catch(() => []),
      getDepotsApi().catch(() => []),
    ]);

    setUser(apiUser ?? getUser() ?? userFromProfile());
    setBins(apiBins);
    setDepot((apiDepots.length > 0 ? apiDepots : getDepots())[0] || null);

    const profile = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
    if (profile.householdId) {
      const [hh, pickup] = await Promise.all([
        fetch(apiUrl(`/api/households/${profile.householdId}`), { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(apiUrl(`/api/households/${profile.householdId}/next-pickup`), { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (hh) {
        let areaLive = false;
        let needed = LIVE_VOLUME_THRESHOLD;
        let households = hh.type === "unit_complex" ? 0 : 1;
        let containers = 0;
        let dayName: string | null = null;
        try {
          const g = await fetch(apiUrl("/api/growth/brisbane")).then((r) => (r.ok ? r.json() : null));
          const match = g?.suburbs?.find((s: GrowthSuburb) => sameSuburb(s.suburb, hh.suburb));
          const cluster = streetStatsForViewer(match, hh.councilCollectionDay, hh.type !== "unit_complex");
          areaLive = cluster.live;
          needed = cluster.needed;
          households = cluster.households;
          containers = cluster.containers;
          dayName = cluster.dayName;
        } catch { /* waitlist card can fall back */ }
        setHousehold({
          id: hh.id,
          binIsOut: !!hh.binIsOut,
          suburb: hh.suburb,
          councilCollectionDay: hh.councilCollectionDay,
          binStatus: hh.binStatus ?? "waitlisted",
          type: hh.type,
          areaLive,
          needed,
          households,
          containers,
          dayName,
        });
      } else {
        let suburbHint: string | null = null;
        try { suburbHint = sessionStorage.getItem("goodsort_suburb_hint"); } catch { /* ignore */ }
        setHousehold({
          id: profile.householdId,
          binIsOut: false,
          suburb: suburbHint,
          binStatus: "waitlisted",
          areaLive: false,
          needed: LIVE_VOLUME_THRESHOLD,
          households: 1,
          containers: 0,
          dayName: null,
        });
      }
      setNextPickup(pickup?.nextPickup ?? null);
      setPickupConfirmed(!!pickup?.confirmed);
    }
  }, []);

  useEffect(() => {
    refreshData().then(async () => {
      // A scan-first member has credit but no address yet. Let them in and
      // prompt for the address in-page — bouncing them to /onboard is the wall
      // we just removed from the scan path.
      const profile = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
      if (profile.id && !profile.householdId) {
        setLoading(false);
        return;
      }
      if (profile.householdId) {
        try {
          const hh = await fetch(apiUrl(`/api/households/${profile.householdId}`), { headers: authHeaders() }).then(r => r.ok ? r.json() : null);
          if (residentialNeedsStreet(hh)) {
            router.push("/onboard");
            return;
          }
        } catch { /* ignore, let user in */ }
      }
      setLoading(false);
    });
  }, [refreshData, router]);

  const handleScanComplete = useCallback(
    (containerName: string, cents: number, bag: BagInfo) => {
      setShowScanner(false);
      refreshData();
      setToast({ text: `+${cents}¢ added to your account · ${bag.label}`, visible: true });
      setTimeout(() => setToast((t) => (t ? { ...t, visible: false } : null)), 2500);
      setTimeout(() => setToast(null), 3000);
    },
    [refreshData]
  );

  const handleBatchComplete = useCallback(
    (totalItems: number, totalCents: number) => {
      setShowScanner(false);
      refreshData();
      setToast({ text: `+$${(totalCents / 100).toFixed(2)} added to your account · ${totalItems} containers`, visible: true });
      setTimeout(() => setToast((t) => (t ? { ...t, visible: false } : null)), 3500);
      setTimeout(() => setToast(null), 4000);
    },
    [refreshData]
  );

  const handleBinSelect = useCallback((id: string) => setSelectedBinId(id), []);
  const handleMapTap = useCallback(() => setSelectedBinId(null), []);
  const selectedBin = bins.find((b) => b.id === selectedBinId) || null;
  // No household yet = scan-first member. They belong on the waitlist home
  // (scan + progress + invite), never in the map/sorter collection UI.
  const onWaitlist = !household || !isCollecting(household.binStatus);

  if (loading || !user) {
    return (
      <div className="h-dvh flex items-center justify-center bg-white">
        <div className="text-slate-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (onWaitlist) {
    return (
      <div className="min-h-dvh relative bg-white">
        <div className="fixed z-30" style={{ top: "calc(env(safe-area-inset-top, 16px) + 0.5rem)", left: "1rem" }}>
          <AccountButton onClick={() => setShowAccount(true)} />
        </div>
        <WaitlistHome
          household={household}
          nextPickup={nextPickup}
          pickupConfirmed={pickupConfirmed}
          onScanPress={() => setShowScanner(true)}
        />
        {showScanner && (
          <Scanner onClose={() => setShowScanner(false)} onScanComplete={handleScanComplete} onBatchComplete={handleBatchComplete} />
        )}
        <AccountPanel user={user} open={showAccount} onClose={() => { setShowAccount(false); refreshData(); }} />
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
        household={household}
        nextPickup={nextPickup}
        onBinOut={async () => {
          if (!household) return;
          const next = !household.binIsOut;
          await fetch(apiUrl(`/api/households/${household.id}/bin-out`), {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ out: next }),
          }).catch(() => null);
          setHousehold({ ...household, binIsOut: next });
        }}
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
