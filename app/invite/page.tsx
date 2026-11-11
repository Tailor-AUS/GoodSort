"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, ChevronRight } from "lucide-react";
import { apiUrl, authHeaders, hasValidToken, readStoredProfile, readStoredProfileId } from "@/lib/config";
import { formatCredit } from "@/lib/credit";
import { inviteMessage, residentialNeedsStreet, sameSuburb, streetInviteUrl, streetStatsForViewer, titleSuburb, type GrowthSuburb } from "@/lib/brisbane";
import { Logo } from "@/app/components/shared/logo";
import { InviteActions } from "@/app/components/shared/invite-actions";

export default function InvitePage() {
  const router = useRouter();
  const [suburb, setSuburb] = useState<string | null>(null);
  const [binDay, setBinDay] = useState<number | null>(null);
  const [growth, setGrowth] = useState<GrowthSuburb | null>(null);
  const [building, setBuilding] = useState(false);
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  const [network, setNetwork] = useState<{ sortersCount: number; referredContainers: number; totalNetworkCents: number } | null>(null);
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
        const me = await fetch(apiUrl("/api/profiles/me/payout"), { headers: authHeaders() })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (me && typeof me.householdId === "string" && me.householdId) {
          hhId = me.householdId;
          profile.householdId = hhId;
          try { localStorage.setItem("goodsort_profile", JSON.stringify(profile)); } catch { /* ignore */ }
        }
      }
      if (!hhId) {
        router.replace("/onboard");
        return;
      }
      try {
        const [hh, g] = await Promise.all([
          fetch(apiUrl(`/api/households/${hhId}`), { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)),
          fetch(apiUrl("/api/growth/brisbane")).then((r) => (r.ok ? r.json() : null)),
        ]);
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
    <div className="min-h-dvh bg-white flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6"><Logo size="lg" /></div>
        <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Users className="w-7 h-7 text-green-600" />
        </div>
        <h1 className="text-2xl font-display font-extrabold text-slate-900 text-center mb-2">
          {building
            ? (dayLive ? `${titleSuburb(suburb ?? "")} volume can unlock` : "Invite houses to scan")
            : (dayLive ? `${titleSuburb(suburb ?? "")} can unlock` : "Build suburb volume")}
        </h1>
        <p className="text-[14px] text-slate-500 text-center mb-6">
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
          <div className="mb-4 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-center text-[12px] font-semibold text-emerald-900">
            Your Container Mafia: {network.sortersCount} sorter{network.sortersCount === 1 ? "" : "s"} · {network.referredContainers} container{network.referredContainers === 1 ? "" : "s"} · +{formatCredit(network.totalNetworkCents)}
          </div>
        )}
        <p className="text-[12px] text-slate-400 text-center mb-3">
          Build your Container Mafia: earn $1 when a neighbour joins plus a 1¢ cut on every container they sort. Send this to three neighbours to build suburb volume.
        </p>
        <a
          href="/flyer"
          className="block text-center text-[12px] font-semibold text-emerald-700 hover:text-emerald-900 mb-6"
        >
          Print Home Sorting Guide &amp; Street Flyer →
        </a>
        <button onClick={() => router.push("/sort")}
          className="w-full text-green-700 font-semibold text-[14px] py-3 flex items-center justify-center gap-1">
          Continue to scan <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
