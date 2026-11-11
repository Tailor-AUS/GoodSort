"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type User, type SortBin, type Depot, getUser } from "@/lib/store";
import { getUserApi, getDepotsApi, getBinsApi } from "@/lib/store-api";
import { apiUrl, authHeaders, hasValidToken, readStoredProfile } from "@/lib/config";
import { isCollecting, LIVE_VOLUME_THRESHOLD, sameSuburb, streetStatsForViewer, type GrowthSuburb, householdCountsTowardUnlock } from "@/lib/brisbane";
import { getDepots } from "@/lib/store";
import { MapView } from "@/app/components/shared/map-view";
import { SorterSheet, type HouseholdStatus } from "./components/sorter-sheet";
import { WaitlistHome } from "./components/waitlist-home";
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

    const profile = readStoredProfile();
    let effectiveHhId =
      (apiUser?.householdId && apiUser.householdId.trim()) ||
      (typeof profile.householdId === "string" && profile.householdId ? profile.householdId : "");

    if (!effectiveHhId && hasValidToken()) {
      const payoutMe = await fetch(apiUrl("/api/profiles/me/payout"), { headers: authHeaders() })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (payoutMe && typeof payoutMe.householdId === "string" && payoutMe.householdId) {
        effectiveHhId = payoutMe.householdId;
        profile.householdId = payoutMe.householdId;
        if (typeof payoutMe.profileName === "string" && payoutMe.profileName) profile.name = payoutMe.profileName;
        try { localStorage.setItem("goodsort_profile", JSON.stringify(profile)); } catch { /* ignore */ }
      }
    }

    if (effectiveHhId) {
      const [hh, pickup] = await Promise.all([
        fetch(apiUrl(`/api/households/${effectiveHhId}`), { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(apiUrl(`/api/households/${effectiveHhId}/next-pickup`), { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
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
          const cluster = streetStatsForViewer(match, hh.councilCollectionDay, householdCountsTowardUnlock(hh));
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
          id: effectiveHhId,
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
      // Deliberately no redirect for an incomplete household. Bouncing to
      // /onboard is the wall removed from the scan path, and it was also half
      // of a loop: if the suburb failed to save, /onboard pushed here and this
      // pushed straight back. WaitlistHome renders its own prompt
      // ("Add your suburb so we can count your scans") — that control only
      // becomes reachable because we stop evicting people before it renders.
      setLoading(false);
    });
  }, [refreshData, router]);

  const handleBinSelect = useCallback((id: string) => setSelectedBinId(id), []);
  const handleMapTap = useCallback(() => setSelectedBinId(null), []);
  const selectedBin = bins.find((b) => b.id === selectedBinId) || null;
  // No household yet = scan-first member. They belong on the waitlist home
  // (scan + progress + invite), never in the map/sorter collection UI.
  const onWaitlist = !household || !isCollecting(household.binStatus);

  if (loading) {
    return (
      <div className="h-dvh flex items-center justify-center bg-white">
        <div className="text-slate-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-white px-6">
        <div className="w-full max-w-sm text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-green-700 mb-2">
            The Good Sort · Brisbane
          </p>
          <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-2">
            Scan cans at home. Earn 10¢.
          </h1>
          <p className="text-[13px] text-slate-500 leading-relaxed mb-6">
            Scan your first eligible container to start banking 10¢ credits, or sign in to view your saved balance and suburb progress.
          </p>
          <Link
            href="/scan"
            className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-4 rounded-2xl text-[15px] shadow-lg shadow-green-600/20 flex items-center justify-center min-h-[48px] mb-3"
          >
            Scan a container
          </Link>
          <Link
            href="/login"
            className="block text-[13px] font-semibold text-slate-500 hover:text-slate-800 py-2.5 min-h-[44px]"
          >
            Sign in to existing account
          </Link>
        </div>
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
          onScanPress={() => router.push("/scan")}
        />
        <AccountPanel user={user} open={showAccount} onRefresh={refreshData} onClose={() => { setShowAccount(false); refreshData(); }} />
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
          const res = await fetch(apiUrl(`/api/households/${household.id}/bin-out`), {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ out: next }),
          }).catch(() => null);
          if (res?.ok) setHousehold({ ...household, binIsOut: next });
        }}
        onScanPress={() => router.push("/scan")}
        onDataUpdate={() => { refreshData(); setSelectedBinId(null); }}
        onDeselectBin={() => setSelectedBinId(null)}
      />

      <AccountPanel user={user} open={showAccount} onRefresh={refreshData} onClose={() => { setShowAccount(false); refreshData(); }} />
    </div>
  );
}
