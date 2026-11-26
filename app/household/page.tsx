"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Home, Package, Users, Weight, Recycle } from "lucide-react";
import { apiUrl, authHeaders, hasValidToken, readStoredProfile } from "@/lib/config";
import { getUserApi } from "@/lib/store-api";
import { formatCents } from "@/lib/store";
import { DAY_NAMES, isCollecting, LIVE_VOLUME_THRESHOLD, sameSuburb, streetStatsForViewer, type GrowthSuburb, householdCountsTowardUnlock } from "@/lib/brisbane";
import { WaitlistCard } from "@/app/components/shared/waitlist-card";
import { CollectionNightCard } from "@/app/components/shared/collection-night-card";
import { GlassBackdrop } from "@/app/components/shared/glass-backdrop";

interface HouseholdDetail {
  id: string;
  name: string;
  address: string;
  type: string;
  councilCollectionDay: number | null;
  usesDivider: boolean;
  binIsOut: boolean;
  binStatus?: string;
  suburb?: string | null;
  pendingContainers: number;
  pendingValueCents: number;
  materials?: { aluminium: number; pet: number; glass: number; other: number };
  estimatedWeightKg: number;
  estimatedBags: number;
  lastScanAt?: string | null;
}

interface Member { id: string; email: string | null; name: string; totalContainers: number; }

export default function HouseholdPage() {
  const [hh, setHh] = useState<HouseholdDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [nextPickup, setNextPickup] = useState<string | null>(null);
  const [pickupConfirmed, setPickupConfirmed] = useState(false);
  const [growth, setGrowth] = useState<{ households: number; containers: number; needed: number; live: boolean; dayName?: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const authed = hasValidToken();
    setSignedIn(authed);
    if (!authed) {
      setErr("Sign in to view or set up your household.");
      return;
    }
    async function loadHousehold() {
      const profile = readStoredProfile();
      let hhId = typeof profile.householdId === "string" && profile.householdId ? profile.householdId : "";
      if (!hhId) {
        const me = await fetch(apiUrl("/api/profiles/me/payout"), { headers: authHeaders() })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (me && typeof me.householdId === "string" && me.householdId) {
          hhId = me.householdId;
          profile.householdId = hhId;
          if (typeof me.profileName === "string" && me.profileName) profile.name = me.profileName;
          try { localStorage.setItem("goodsort_profile", JSON.stringify(profile)); } catch { /* ignore */ }
        }
      }
      if (!hhId) {
        setErr("You haven't set up a household yet.");
        return;
      }
      try {
        const [house, pickup, g, liveUser] = await Promise.all([
          fetch(apiUrl(`/api/households/${hhId}`), { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)),
          fetch(apiUrl(`/api/households/${hhId}/next-pickup`), { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch(apiUrl("/api/growth/brisbane")).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          getUserApi().catch(() => null),
        ]);
        if (!house) {
          setErr("Couldn't load household.");
          return;
        }
        setHh(house);
        if (pickup?.nextPickup) setNextPickup(pickup.nextPickup);
        setPickupConfirmed(!!pickup?.confirmed);
        if (g?.suburbs) {
          const match = g.suburbs.find((s: GrowthSuburb) => sameSuburb(s.suburb, house.suburb));
          setGrowth(streetStatsForViewer(match, house.councilCollectionDay, householdCountsTowardUnlock(house)));
        }
        setMembers([
          {
            id: liveUser?.id || (typeof profile.id === "string" ? profile.id : "me"),
            email: typeof profile.email === "string" ? profile.email : null,
            name: liveUser?.name || (typeof profile.name === "string" && profile.name ? profile.name : "You"),
            totalContainers:
              typeof liveUser?.totalContainers === "number"
                ? liveUser.totalContainers
                : typeof profile.totalContainers === "number"
                  ? profile.totalContainers
                  : 0,
          },
        ]);
      } catch {
        setErr("Couldn't load household.");
      }
    }
    void loadHousehold();
  }, []);

  return (
    <div className="relative min-h-dvh overflow-x-clip text-white">
      <GlassBackdrop />
      <div className="relative z-10 max-w-sm mx-auto px-5 py-6 pb-12">
        <Link
          href="/sort"
          className="inline-flex items-center gap-1.5 min-h-[44px] rounded-full liquid-glass-pill px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-white/25 mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <h1 className="text-3xl font-display font-extrabold text-white glass-text-shadow mb-1 flex items-center gap-2.5">
          <span className="h-9 w-9 rounded-2xl bg-emerald-400/25 border border-emerald-200/50 flex items-center justify-center">
            <Home className="w-5 h-5 text-emerald-100" />
          </span>
          Household
        </h1>
        {err && (
          <div className="mt-4 rounded-[26px] liquid-glass p-5 space-y-3">
            <p className="text-[14px] font-semibold text-white">{err}</p>
            <p className="text-[12px] text-white/80 leading-relaxed">
              Add your home pickup address and payout details so we can count your 8¢ scans toward a 1,000-container suburb run and pay you when we collect.
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <Link
                href={signedIn ? "/onboard" : "/login"}
                className="w-full bg-gradient-to-b from-emerald-500 to-emerald-600 text-white font-bold py-3 rounded-xl text-[13px] text-center shadow-lg shadow-emerald-950/25 min-h-[44px] flex items-center justify-center"
              >
                {signedIn ? "Add home address & payout details →" : "Sign in to set up household"}
              </Link>
              <Link
                href="/scan"
                className="w-full text-center text-[13px] font-semibold text-white/80 hover:text-white py-2"
              >
                Scan a container first
              </Link>
            </div>
          </div>
        )}
        {hh && (
          <>
            <p className="text-[13px] text-white/85 glass-text-shadow mb-5">{hh.name} · {hh.address}</p>

            {hh && !isCollecting(hh.binStatus) && (
              <div className="mb-3">
                <WaitlistCard
                  suburb={hh.suburb}
                  households={growth?.households ?? (hh.type === "unit_complex" ? 0 : 1)}
                  containers={growth?.containers ?? 0}
                  needed={growth?.needed ?? LIVE_VOLUME_THRESHOLD}
                  live={!!growth?.live}
                  binStatus={hh.binStatus}
                  dayName={growth?.dayName}
                  day={hh.councilCollectionDay}
                  building={hh.type === "unit_complex"}
                />
              </div>
            )}

            {isCollecting(hh.binStatus) && (
              <BinOutToggle hh={hh} onChange={(v) => setHh({ ...hh, binIsOut: v })} />
            )}

            <div className="text-slate-900">
              <CollectionNightCard
                nextPickup={nextPickup}
                confirmed={pickupConfirmed || isCollecting(hh.binStatus)}
                unlocked={!!growth?.live || hh.binStatus === "allocated"}
                dayName={hh.councilCollectionDay != null ? DAY_NAMES[hh.councilCollectionDay] : growth?.dayName}
                tone="green"
              />
            </div>
            {!hh.suburb && hh.type === "residential" && (
              <div className="liquid-glass-amber rounded-2xl p-4 mb-5 flex items-start gap-3">
                <Recycle className="w-5 h-5 text-amber-100 shrink-0 mt-0.5" />
                <p className="text-[13px] text-white">
                  Add your Brisbane street address on{" "}
                  <Link href="/onboard" className="font-semibold underline text-amber-100">onboarding</Link>{" "}
                  so your scans count toward your suburb&apos;s {LIVE_VOLUME_THRESHOLD.toLocaleString()}-container volume run.
                </p>
              </div>
            )}

            {isCollecting(hh.binStatus) && (
            <div className="grid grid-cols-2 gap-3 mb-5">
              <Card icon={Package} label="Containers pending" value={String(hh.pendingContainers)} />
              <Card icon={Users} label="Value" value={formatCents(hh.pendingValueCents)} />
              <Card icon={Weight} label="Weight est." value={`${hh.estimatedWeightKg.toFixed(1)} kg`} />
              <Card icon={Package} label="Bags" value={String(hh.estimatedBags)} />
            </div>
            )}

            {isCollecting(hh.binStatus) && hh.materials && (
              <div className="rounded-[24px] liquid-glass p-4 mb-5">
                <p className="text-[11px] uppercase tracking-wider text-white/75 font-semibold mb-3">By material</p>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <Mat label="Cans" n={hh.materials.aluminium} />
                  <Mat label="PET" n={hh.materials.pet} />
                  <Mat label="Glass" n={hh.materials.glass} />
                  <Mat label="Other" n={hh.materials.other} />
                </div>
              </div>
            )}

            <div className="rounded-[24px] liquid-glass overflow-hidden">
              <div className="px-4 py-3 border-b border-white/20 text-[13px] font-semibold text-white">Members</div>
              <div className="divide-y divide-white/15">
                {members.map(m => (
                  <div key={m.id} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-[13px] font-semibold text-white">{m.name}</p>
                      <p className="text-[11px] text-white/70">{m.email}</p>
                    </div>
                    <p className="text-[14px] font-display font-extrabold text-white tabular-nums">{m.totalContainers}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Card({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="rounded-[22px] liquid-glass p-4">
      <Icon className="w-4 h-4 text-emerald-200 mb-2" />
      <p className="text-xl font-display font-extrabold text-white tabular-nums">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-white/75 mt-0.5">{label}</p>
    </div>
  );
}

function BinOutToggle({ hh, onChange }: { hh: HouseholdDetail; onChange: (v: boolean) => void }) {
  const [saving, setSaving] = useState(false);
  async function toggle() {
    setSaving(true);
    const next = !hh.binIsOut;
    try {
      const res = await fetch(apiUrl(`/api/households/${hh.id}/bin-out`), {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ out: next }),
      });
      if (res.ok) onChange(next);
    } catch { /* keep previous state when offline */ }
    finally { setSaving(false); }
  }
  return (
    <button type="button" role="switch" aria-checked={hh.binIsOut} onClick={toggle} disabled={saving}
      className={`w-full rounded-[24px] p-4 mb-4 flex items-center justify-between transition-all ${hh.binIsOut ? "liquid-glass-emerald" : "liquid-glass"}`}>
      <div className="text-left pr-3">
        <p className="text-[14px] font-semibold text-white">
          {hh.binIsOut ? "Bags on kerb ✓" : "Bag out sorted containers?"}
        </p>
        <p className="text-[12px] text-white/80 mt-0.5">
          {hh.binIsOut ? "Tap to mark bags as back inside." : "Tap once your bags are on the kerb so the runner knows they're ready."}
        </p>
      </div>
      <div className={`w-12 h-6 rounded-full relative transition-colors shrink-0 ${hh.binIsOut ? "bg-emerald-400" : "bg-white/30"}`}>
        <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 shadow transition-transform ${hh.binIsOut ? "translate-x-6" : "translate-x-0.5"}`} />
      </div>
    </button>
  );
}

function Mat({ label, n }: { label: string; n: number }) {
  return (
    <div>
      <p className="text-lg font-display font-extrabold text-white tabular-nums">{n}</p>
      <p className="text-[10px] uppercase tracking-wider text-white/75">{label}</p>
    </div>
  );
}
