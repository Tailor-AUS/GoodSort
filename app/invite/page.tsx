"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, ChevronRight } from "lucide-react";
import { apiUrl, authHeaders, readStoredProfileId } from "@/lib/config";
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
  const inviteUrl = streetInviteUrl({ suburb, day: binDay, profileId });

  useEffect(() => {
    setProfileId(readStoredProfileId());
    const profile = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
    if (!profile.householdId) { router.replace("/onboard"); return; }
    Promise.all([
      fetch(apiUrl(`/api/households/${profile.householdId}`), { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)),
      fetch(apiUrl("/api/growth/brisbane")).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([hh, g]) => {
        if (residentialNeedsStreet(hh)) {
          router.replace("/onboard");
          return;
        }
        if (hh?.suburb) setSuburb(hh.suburb);
        if (hh?.councilCollectionDay != null) setBinDay(hh.councilCollectionDay);
        setBuilding(hh?.type === "unit_complex");
        const match = g?.suburbs?.find((s: GrowthSuburb) => sameSuburb(s.suburb, hh?.suburb));
        if (match) setGrowth(match);
      })
      .catch(() => {});
  }, [router]);

  const cluster = streetStatsForViewer(growth, binDay, !building);
  const needed = cluster.needed;
  const waiting = cluster.households;
  const dayLive = cluster.live;
  const message = inviteMessage(inviteUrl, suburb, {
    dayName: cluster?.dayName,
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
            ? (dayLive ? `${titleSuburb(suburb ?? "")} houses can unlock` : "Invite houses on your street")
            : (dayLive ? `${titleSuburb(suburb ?? "")} ${cluster?.dayName ?? ""} can unlock` : "Get your street on the list")}
        </h1>
        <p className="text-[14px] text-slate-500 text-center mb-6">
          {building
            ? (dayLive
              ? "Houses on a recycling day have hit 12. Common-area pickups are still phase 2. Invite more houses so the first night is dense."
              : `${waiting} house${waiting === 1 ? "" : "s"} on ${cluster?.dayName ?? "a recycling day"} in ${suburb ? titleSuburb(suburb) : "your suburb"}. You do not count toward the 12.`)
            : (dayLive
            ? "Enough neighbours on your recycling day have joined. We'll tell you when purple bins are on the way. Invite the rest of the street so the first run is dense."
            : `${waiting} household${waiting === 1 ? "" : "s"} on ${cluster?.dayName ?? "your recycling day"} in ${suburb ? titleSuburb(suburb) : "your suburb"}. ${needed} more on that day and we order bins.`)}
        </p>
        <div className="mb-3">
          <InviteActions url={inviteUrl} message={message} />
        </div>
        <p className="text-[12px] text-slate-400 text-center mb-8">
          Same recycling day is the unlock. Send this to three houses that put their bin out on {cluster?.dayName ?? "your day"}. We email you when a neighbour joins. $1 pending — cash-out after we start collecting.
        </p>
        <button onClick={() => router.push("/sort")}
          className="w-full text-green-700 font-semibold text-[14px] py-3 flex items-center justify-center gap-1">
          Continue to your waitlist <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
