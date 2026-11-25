"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users, ChevronRight, ArrowLeft } from "lucide-react";
import { apiUrl, authHeaders, clearAuth, hasValidToken, readStoredProfile, readStoredProfileId } from "@/lib/config";
import { inviteMessage, residentialNeedsStreet, sameSuburb, streetInviteUrl, streetStatsForViewer, titleSuburb, type GrowthSuburb } from "@/lib/brisbane";
import { Logo } from "@/app/components/shared/logo";
import { InviteActions } from "@/app/components/shared/invite-actions";
import { GlassBackdrop } from "@/app/components/shared/glass-backdrop";

export default function InvitePage() {
  const router = useRouter();
  const [suburb, setSuburb] = useState<string | null>(null);
  const [binDay, setBinDay] = useState<number | null>(null);
  const [growth, setGrowth] = useState<GrowthSuburb | null>(null);
  const [building, setBuilding] = useState(false);
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  const [network, setNetwork] = useState<{ sortersCount: number; referredContainers: number; totalNetworkPoints?: number } | null>(null);
  const inviteUrl = streetInviteUrl({ suburb, day: binDay, profileId });

  useEffect(() => {
    const pid = readStoredProfileId();
    setProfileId(pid);
    if (pid) {
      fetch(apiUrl(`/api/profiles/${pid}/network`), { headers: authHeaders() })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d) setNetwork(d); })
        .catch(() => {});
    }
    async function loadInviteContext() {
      const profile = readStoredProfile();
      let hhId = typeof profile.householdId === "string" && profile.householdId ? profile.householdId : "";
      if (!hhId && hasValidToken()) {
        const meRes = await fetch(apiUrl("/api/profiles/me/payout"), { headers: authHeaders() }).catch(() => null);
        if (meRes?.status === 401) {
          clearAuth();
          router.replace("/login");
          return;
        }
        const me = meRes && meRes.ok ? await meRes.json().catch(() => null) : null;
        if (me && typeof me.householdId === "string" && me.householdId) {
          hhId = me.householdId;
          profile.householdId = hhId;
          try { localStorage.setItem("goodsort_profile", JSON.stringify(profile)); } catch { /* ignore */ }
        }
      }
      if (!hhId) {
        router.replace(hasValidToken() ? "/onboard" : "/login");
        return;
      }
      try {
        const [hhRes, g] = await Promise.all([
          fetch(apiUrl(`/api/households/${hhId}`), { headers: authHeaders() }),
          fetch(apiUrl("/api/growth/brisbane")).then((r) => (r.ok ? r.json() : null)),
        ]);
        if (hhRes.status === 401) {
          clearAuth();
          router.replace("/login");
          return;
        }
        const hh = hhRes.ok ? await hhRes.json().catch(() => null) : null;
        if (residentialNeedsStreet(hh)) {
          router.replace("/onboard");
          return;
        }
        if (hh?.suburb) setSuburb(hh.suburb);
        if (hh?.councilCollectionDay != null) setBinDay(hh.councilCollectionDay);
        setBuilding(hh?.type === "unit_complex");
        const match = g?.suburbs?.find((s: GrowthSuburb) => sameSuburb(s.suburb, hh?.suburb));
        if (match) setGrowth(match);
      } catch {
        /* ignore */
      }
    }
    void loadInviteContext();
  }, [router]);

  const cluster = streetStatsForViewer(growth, binDay, !building);
  const needed = cluster.needed;
  const waiting = cluster.households;
  const dayLive = cluster.live;
  const message = inviteMessage(inviteUrl, suburb, {
    dayName: cluster?.dayName,
    containers: cluster.containers,
    households: waiting,
    needed,
    live: dayLive,
  });

  return (
    <div className="relative min-h-dvh overflow-x-clip flex flex-col items-center justify-center px-5 py-8 text-white">
      <GlassBackdrop />
      <div className="relative z-10 w-full max-w-sm">
        <div className="flex items-center justify-between mb-5">
          <Link
            href="/sort"
            className="inline-flex items-center gap-1.5 min-h-[44px] rounded-full liquid-glass-pill px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-white/25"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
          <Logo size="sm" dark />
        </div>

        <div className="rounded-[28px] liquid-glass p-6">
          <div className="w-14 h-14 rounded-2xl bg-emerald-400/25 border border-emerald-200/50 flex items-center justify-center mx-auto mb-4 shadow-inner">
            <Users className="w-7 h-7 text-emerald-100" />
          </div>
          <h1 className="text-2xl font-display font-extrabold text-white glass-text-shadow text-center mb-2">
            {building
              ? (dayLive ? `${titleSuburb(suburb ?? "")} volume can unlock` : "Invite houses to scan")
              : (dayLive ? `${titleSuburb(suburb ?? "")} can unlock` : "Build suburb volume")}
          </h1>
          <p className="text-[14px] text-white/85 text-center leading-relaxed mb-6">
            {building
              ? (dayLive
                ? "Street volume has hit a driver trip. Common-area pickups are still phase 2. Invite more houses to scan so the first trip is full."
                : `${waiting} house${waiting === 1 ? "" : "s"} scanning near ${suburb ? titleSuburb(suburb) : "your suburb"}. You do not count toward suburb volume.`)
              : (dayLive
              ? "Enough scanned containers for a driver trip. We'll tell you when to bag out. Invite neighbours to scan so the first run is full."
              : `${cluster.containers} container${cluster.containers === 1 ? "" : "s"} toward a volume run in ${suburb ? titleSuburb(suburb) : "your suburb"}. ${needed} more and we run to the refund point.`)}
          </p>
          <div className="mb-3">
            <InviteActions url={inviteUrl} message={message} />
          </div>
          {network && (
            <div className="mb-4 rounded-2xl liquid-glass-emerald px-3.5 py-2.5 text-center text-[12px] font-semibold text-white">
              Your neighbour network: {network.sortersCount} sorter{network.sortersCount === 1 ? "" : "s"} · {network.referredContainers} container{network.referredContainers === 1 ? "" : "s"} ·{" "}
              <span className="whitespace-nowrap text-emerald-200 font-bold">
                +{(network.totalNetworkPoints ?? network.sortersCount * 100 + network.referredContainers).toLocaleString()} PTS
              </span>
            </div>
          )}
          <p className="text-[12px] text-white/75 text-center leading-relaxed mb-4">
            Grow your neighbour network: earn 100 Good Sort Points when a neighbour joins plus 1 bonus point on every container they sort. Send this to three neighbours to build suburb volume.
          </p>
          <Link
            href="/flyer"
            className="flex items-center justify-center min-h-[44px] rounded-full liquid-glass-pill px-4 py-2 text-center text-[13px] font-semibold text-white hover:bg-white/25 mb-3"
          >
            Print Home Sorting Guide &amp; Street Flyer →
          </Link>
          <button
            type="button"
            onClick={() => router.push("/sort")}
            className="w-full min-h-[44px] text-white/90 hover:text-white font-semibold text-[14px] py-2.5 flex items-center justify-center gap-1"
          >
            Continue to scan <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
