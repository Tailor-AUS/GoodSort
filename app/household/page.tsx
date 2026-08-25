"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Home, Package, Users, Weight, Truck, Recycle } from "lucide-react";
import { apiUrl, authHeaders } from "@/lib/config";
import { formatCents } from "@/lib/store";
import { isCollecting, sameSuburb, streetStatsForViewer, type GrowthSuburb } from "@/lib/brisbane";
import { WaitlistCard } from "@/app/components/shared/waitlist-card";

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

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Member { id: string; email: string | null; name: string; totalContainers: number; }

export default function HouseholdPage() {
  const [hh, setHh] = useState<HouseholdDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [nextPickup, setNextPickup] = useState<string | null>(null);
  const [growth, setGrowth] = useState<{ households: number; needed: number; live: boolean; dayName?: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const profile = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
    if (!profile.householdId) { setErr("You haven't set up a household yet."); return; }
    fetch(apiUrl(`/api/households/${profile.householdId}`), { headers: authHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setHh)
      .catch(() => setErr("Couldn't load household."));
    fetch(apiUrl(`/api/households/${profile.householdId}/next-pickup`), { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.nextPickup) setNextPickup(d.nextPickup); })
      .catch(() => {});
    fetch(apiUrl("/api/growth/brisbane"))
      .then(r => r.ok ? r.json() : null)
      .then(g => {
        if (!g?.suburbs) return;
        return fetch(apiUrl(`/api/households/${profile.householdId}`), { headers: authHeaders() })
          .then(r => r.ok ? r.json() : null)
          .then(house => {
            const match = g.suburbs.find((s: GrowthSuburb) => sameSuburb(s.suburb, house?.suburb));
            setGrowth(streetStatsForViewer(match, house?.councilCollectionDay, house?.type !== "unit_complex"));
          });
      })
      .catch(() => {});
    setMembers([{ id: profile.id, email: profile.email, name: profile.name, totalContainers: profile.totalContainers ?? 0 }]);
  }, []);

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="max-w-sm mx-auto px-6 py-6">
        <Link href="/sort" className="inline-flex items-center gap-1 text-[13px] text-slate-500 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-1 flex items-center gap-2">
          <Home className="w-6 h-6 text-green-600" /> Household
        </h1>
        {err && <p className="text-[13px] text-red-600 mt-4">{err}</p>}
        {hh && (
          <>
            <p className="text-[13px] text-slate-500 mb-6">{hh.name} · {hh.address}</p>

            {hh && !isCollecting(hh.binStatus) && (
              <WaitlistCard
                suburb={hh.suburb}
                households={growth?.households ?? (hh.type === "unit_complex" ? 0 : 1)}
                needed={growth?.needed ?? 12}
                live={!!growth?.live}
                binStatus={hh.binStatus}
                dayName={growth?.dayName}
                day={hh.councilCollectionDay}
                building={hh.type === "unit_complex"}
              />
            )}

            {isCollecting(hh.binStatus) && (
              <BinOutToggle hh={hh} onChange={(v) => setHh({ ...hh, binIsOut: v })} />
            )}

            {nextPickup && isCollecting(hh.binStatus) && (
              <div className="bg-gradient-to-br from-green-500 to-green-600 text-white rounded-2xl p-5 mb-6 shadow-lg shadow-green-600/25">
                <div className="flex items-start gap-3">
                  <Truck className="w-6 h-6 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-[11px] uppercase tracking-wider text-white/70 mb-1">Next pickup</p>
                    <p className="text-xl font-display font-extrabold">
                      {new Date(nextPickup).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" })}
                    </p>
                    <p className="text-[12px] text-white/80 mt-1">
                      We'll collect your purple bin the night before council recycling ({hh.councilCollectionDay != null ? DAY_NAMES[hh.councilCollectionDay] : ""}).
                      {hh.usesDivider && " Cans and bottles on the CDS side of the divider."}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {!nextPickup && hh.type === "residential" && isCollecting(hh.binStatus) && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-start gap-3">
                <Recycle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[13px] text-amber-900">Set your council collection day in settings so we can schedule pickups.</p>
              </div>
            )}

            {isCollecting(hh.binStatus) && (
            <div className="grid grid-cols-2 gap-3 mb-6">
              <Card icon={Package} label="Containers pending" value={String(hh.pendingContainers)} />
              <Card icon={Users} label="Value" value={formatCents(hh.pendingValueCents)} />
              <Card icon={Weight} label="Weight est." value={`${hh.estimatedWeightKg.toFixed(1)} kg`} />
              <Card icon={Package} label="Bags" value={String(hh.estimatedBags)} />
            </div>
            )}

            {isCollecting(hh.binStatus) && hh.materials && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
                <p className="text-[11px] uppercase tracking-wider text-slate-400 mb-3">By material</p>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <Mat label="Cans" n={hh.materials.aluminium} />
                  <Mat label="PET" n={hh.materials.pet} />
                  <Mat label="Glass" n={hh.materials.glass} />
                  <Mat label="Other" n={hh.materials.other} />
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl border border-slate-200">
              <div className="px-4 py-3 border-b border-slate-100 text-[13px] font-semibold text-slate-900">Members</div>
              <div className="divide-y divide-slate-100">
                {members.map(m => (
                  <div key={m.id} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-[13px] font-medium text-slate-900">{m.name}</p>
                      <p className="text-[11px] text-slate-400">{m.email}</p>
                    </div>
                    <p className="text-[13px] font-display font-extrabold text-slate-900">{m.totalContainers}</p>
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
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <Icon className="w-4 h-4 text-green-600/70 mb-2" />
      <p className="text-xl font-display font-extrabold text-slate-900">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}

function BinOutToggle({ hh, onChange }: { hh: HouseholdDetail; onChange: (v: boolean) => void }) {
  const [saving, setSaving] = useState(false);
  async function toggle() {
    setSaving(true);
    const next = !hh.binIsOut;
    try {
      await fetch(apiUrl(`/api/households/${hh.id}/bin-out`), {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ out: next }),
      });
      onChange(next);
    } finally { setSaving(false); }
  }
  return (
    <button onClick={toggle} disabled={saving}
      className={`w-full rounded-2xl p-4 mb-4 border-2 flex items-center justify-between transition-colors ${hh.binIsOut ? "bg-green-50 border-green-500" : "bg-white border-slate-300"}`}>
      <div className="text-left">
        <p className={`text-[14px] font-semibold ${hh.binIsOut ? "text-green-800" : "text-slate-900"}`}>
          {hh.binIsOut ? "Purple bin is on the kerb ✓" : "Put your purple bin on the kerb?"}
        </p>
        <p className="text-[12px] text-slate-500 mt-0.5">
          {hh.binIsOut ? "Tap to mark bin as back inside." : "Tap once your bin is out so the runner knows it's ready."}
        </p>
      </div>
      <div className={`w-12 h-6 rounded-full relative transition-colors ${hh.binIsOut ? "bg-green-500" : "bg-slate-300"}`}>
        <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${hh.binIsOut ? "translate-x-6" : "translate-x-0.5"}`} />
      </div>
    </button>
  );
}

function Mat({ label, n }: { label: string; n: number }) {
  return (
    <div>
      <p className="text-lg font-display font-extrabold text-slate-900">{n}</p>
      <p className="text-[10px] uppercase tracking-wider text-slate-400">{label}</p>
    </div>
  );
}
