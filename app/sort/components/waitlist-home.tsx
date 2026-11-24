"use client";

import { useEffect, useState } from "react";
import { ScanBarcode } from "lucide-react";
import { LIVE_VOLUME_THRESHOLD, inviteMessage, residentialNeedsStreet, streetInviteUrl, titleSuburb, canonicalSuburb } from "@/lib/brisbane";
import { formatCredit } from "@/lib/credit";
import { apiUrl, authHeaders, readStoredProfileId } from "@/lib/config";
import type { User } from "@/lib/store";
import { countStreamsFromScans, bucketScanMaterial } from "@/lib/sorter-loyalty";
import { Logo } from "@/app/components/shared/logo";
import { WaitlistCard } from "@/app/components/shared/waitlist-card";
import { CollectionNightCard } from "@/app/components/shared/collection-night-card";
import { InviteActions } from "@/app/components/shared/invite-actions";
import { MemberStatusCard } from "./member-status-card";
import type { HouseholdStatus } from "./sorter-sheet";

const STREAMS = [
  { key: "aluminium" as const, label: "Cans", hint: "Aluminium (GSB-ALU)", color: "bg-blue-500", dot: "bg-blue-500" },
  { key: "clearPet" as const, label: "Clear PET", hint: "Clear plastic (GSB-CLR)", color: "bg-teal-500", dot: "bg-teal-500" },
  { key: "coloured" as const, label: "Coloured / Poppers", hint: "Coloured PET & cartons (GSB-COL)", color: "bg-amber-500", dot: "bg-amber-500" },
  { key: "glass" as const, label: "Glass", hint: "Bottles incl. wine & spirits (GSB-GLS)", color: "bg-emerald-600", dot: "bg-emerald-600" },
];

const STREAM_DOT_BY_KEY = {
  aluminium: "bg-blue-500",
  clearPet: "bg-teal-500",
  coloured: "bg-amber-500",
  glass: "bg-emerald-600",
} as const;

export function WaitlistHome({
  user,
  household,
  nextPickup,
  pickupConfirmed,
  onScanPress,
}: {
  user: User;
  household: HouseholdStatus | null;
  nextPickup: string | null;
  pickupConfirmed?: boolean;
  onScanPress?: () => void;
}) {
  const suburb = household?.suburb;
  const building = household?.type === "unit_complex";
  const have = household?.households ?? (building ? 0 : 1);
  const containers = household?.containers ?? 0;
  const needed = household?.needed ?? Math.max(0, LIVE_VOLUME_THRESHOLD - containers);
  const live = !!household?.areaLive;
  const dayName = household?.dayName;
  const pct = Math.min(100, Math.round((containers / LIVE_VOLUME_THRESHOLD) * 100));
  const place = suburb ? titleSuburb(suburb) : "your suburb";
  const streamCounts = countStreamsFromScans(user.scans || []);
  const recentScans = (user.scans || []).slice(0, 5);
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  const [network, setNetwork] = useState<{ sortersCount: number; referredContainers: number; totalNetworkCents: number } | null>(null);
  const [hasPayoutDetails, setHasPayoutDetails] = useState<boolean | null>(null);
  useEffect(() => {
    const pid = readStoredProfileId();
    setProfileId(pid);
    if (pid) {
      fetch(apiUrl(`/api/profiles/${pid}/network`), { headers: authHeaders() })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d) setNetwork(d); })
        .catch(() => {});
      fetch(apiUrl("/api/profiles/me/payout"), { headers: authHeaders() })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d && typeof d.hasPayoutDetails === "boolean") setHasPayoutDetails(d.hasPayoutDetails); })
        .catch(() => {});
    }
  }, []);
  const inviteUrl = streetInviteUrl({ suburb, day: household?.councilCollectionDay, dayName, profileId });
  const message = inviteMessage(inviteUrl, suburb, { dayName, containers, households: have, needed, live });

  return (
    <div className="min-h-dvh bg-white px-6 py-10 flex flex-col items-center" style={{ paddingTop: "max(5.5rem, calc(env(safe-area-inset-top) + 4.5rem))" }}>
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-5"><Logo size="md" /></div>

        {/* Frequent Sorter Personal Member Dashboard */}
        <MemberStatusCard
          user={user}
          suburbLabel={suburb ? titleSuburb(suburb) : null}
          network={network}
        />

        {onScanPress && (
          <button
            type="button"
            onClick={onScanPress}
            className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-2xl text-[14px] mb-3 flex items-center justify-center gap-2 min-h-[48px] shadow-lg shadow-green-600/20"
          >
            <ScanBarcode className="w-4 h-4" />
            Scan a container · +10¢ / +10 pts
          </button>
        )}

        <div className="grid grid-cols-2 gap-2 mb-5">
          <a
            href="/bags"
            className="rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 py-2.5 px-3 text-center text-[12px] font-bold text-emerald-900 transition-colors"
          >
            Tag home bags
          </a>
          <a
            href="/marketplace"
            className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 py-2.5 px-3 text-center text-[12px] font-bold text-slate-700 transition-colors"
          >
            Suburb map
          </a>
        </div>

        <CollectionNightCard
          nextPickup={nextPickup}
          confirmed={pickupConfirmed}
          unlocked={live || household?.binStatus === "allocated"}
          dayName={dayName}
        />

        {/* Your 4 Home Streams with live personal counts */}
        <div className="mb-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">
            Your 4 home streams
          </p>
          <div className="grid grid-cols-4 gap-2">
            {STREAMS.map((s) => (
              <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-2.5 text-center">
                <div className={`w-6 h-6 ${s.color} rounded-lg mx-auto mb-1.5 flex items-center justify-center text-[11px] font-extrabold text-white tabular-nums`}>
                  {streamCounts[s.key]}
                </div>
                <p className="text-[11px] font-display font-extrabold text-slate-900 leading-tight">{s.label}</p>
                <p className="text-[9px] text-slate-400 leading-tight mt-0.5">{s.hint}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Scans Activity */}
        {recentScans.length > 0 && (
          <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-3.5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                Recent scans
              </p>
              <span className="text-[11px] font-semibold text-slate-400">
                {user.totalContainers.toLocaleString()} total
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {recentScans.map((scan) => {
                const streamKey = bucketScanMaterial(scan.material);
                return (
                  <div key={scan.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${STREAM_DOT_BY_KEY[streamKey]}`} />
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold text-slate-800 truncate">
                          {scan.containerName || "Eligible container"}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {new Date(scan.timestamp).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700 tabular-nums">
                      +{scan.refundCents || 10}¢ · +10 pts
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Suburb 1,000-container pickup unlock tracker */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 mb-5">
          <p className="text-[11px] uppercase tracking-[0.14em] text-violet-700/80 font-bold mb-1">
            {building ? `Building list · ${place}` : `Suburb pool · ${place}`}
          </p>
          <div className="h-2.5 bg-violet-100 rounded-full overflow-hidden mt-2">
            <div className="h-full bg-violet-600 rounded-full" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[12px] font-semibold text-slate-800 mt-2">
            {building
              ? live
                ? "Street volume has hit a driver trip. You do not count toward suburb volume."
                : `${containers} containers scanned near ${place}. You do not count toward suburb volume.`
              : live
                ? `${containers} containers — enough for a driver trip`
                : `${containers}/${LIVE_VOLUME_THRESHOLD} containers${needed > 0 ? ` · ${needed} more to unlock a run` : ""}`}
          </p>
        </div>

        {/* No suburb means streetInvitePath resolves to "/" — the bare
            city-wide link 2a8ea09 removed. Prompt for the suburb instead. */}
        {!live && !pickupConfirmed && (building || canonicalSuburb(suburb) !== null) && (
          <div className="mb-5">
            <p className="text-[15px] font-display font-extrabold text-slate-900 mb-1">
              {building ? "Invite a house to scan · earn 1¢/can" : "Grow your neighbour network · earn 1¢/can"}
            </p>
            <p className="text-[12px] text-slate-500 mb-3">
              Earn $1 when a neighbour joins your suburb plus a 1¢ bonus on every container they sort. Their scans also unlock your suburb&apos;s {LIVE_VOLUME_THRESHOLD}-container run faster.
            </p>
            {network && network.sortersCount > 0 && (
              <div className="mb-3 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-[12px] font-semibold text-emerald-900">
                Your neighbour network: {network.sortersCount} sorter{network.sortersCount === 1 ? "" : "s"} · {network.referredContainers} container{network.referredContainers === 1 ? "" : "s"} · +{formatCredit(network.totalNetworkCents)}
              </div>
            )}
            <InviteActions url={inviteUrl} message={message} />
            <a
              href="/flyer"
              className="mt-2.5 block text-center text-[12px] font-semibold text-emerald-700 hover:text-emerald-900"
            >
              Print Home Sorting Guide &amp; Street Flyer →
            </a>
          </div>
        )}

        {residentialNeedsStreet(household) ? (
          <a href="/onboard" className="block mb-4 text-center text-[13px] font-semibold text-violet-800 bg-violet-50 border border-violet-200 rounded-xl py-3 px-3">
            Add your home address &amp; payout details so we can collect &amp; pay you →
          </a>
        ) : hasPayoutDetails === false ? (
          <a href="/onboard" className="block mb-4 text-center text-[13px] font-semibold text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-xl py-3 px-3">
            Add your PayID or bank details so we can pay you →
          </a>
        ) : null}
        <WaitlistCard
          suburb={suburb}
          households={have}
          containers={containers}
          needed={needed}
          live={live}
          binStatus={household?.binStatus ?? "waitlisted"}
          dayName={dayName}
          day={household?.councilCollectionDay}
          building={building}
          hideInvite={!live && !pickupConfirmed}
        />
        <p className="text-[12px] text-slate-400 text-center mt-4">
          Credits clear after we collect and a refund point or depot verifies the containers.
        </p>
      </div>
    </div>
  );
}
