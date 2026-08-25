"use client";

import { useEffect, useState } from "react";
import { ScanBarcode } from "lucide-react";
import { LIVE_HOUSEHOLD_THRESHOLD, inviteMessage, residentialNeedsStreet, streetCardPath, streetInviteUrl, titleSuburb } from "@/lib/brisbane";
import { readStoredProfileId } from "@/lib/config";
import { Logo } from "@/app/components/shared/logo";
import { WaitlistCard } from "@/app/components/shared/waitlist-card";
import { CollectionNightCard } from "@/app/components/shared/collection-night-card";
import { InviteActions } from "@/app/components/shared/invite-actions";
import type { HouseholdStatus } from "./sorter-sheet";

const STREAMS = [
  { label: "Cans", hint: "Aluminium", color: "bg-blue-500" },
  { label: "PET", hint: "Clear plastic bottles", color: "bg-teal-500" },
  { label: "Glass", hint: "Bottles", color: "bg-amber-500" },
  { label: "Other", hint: "Everything else", color: "bg-green-500" },
];

export function WaitlistHome({
  household,
  nextPickup,
  pickupConfirmed,
  onScanPress,
}: {
  household: HouseholdStatus | null;
  nextPickup: string | null;
  pickupConfirmed?: boolean;
  onScanPress?: () => void;
}) {
  const suburb = household?.suburb;
  const building = household?.type === "unit_complex";
  const have = household?.households ?? (building ? 0 : 1);
  const needed = household?.needed ?? Math.max(0, LIVE_HOUSEHOLD_THRESHOLD - have);
  const live = !!household?.areaLive;
  const dayName = household?.dayName;
  const pct = Math.min(100, Math.round((have / LIVE_HOUSEHOLD_THRESHOLD) * 100));
  const place = suburb ? titleSuburb(suburb) : "your street";
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  useEffect(() => { setProfileId(readStoredProfileId()); }, []);
  const inviteUrl = streetInviteUrl({ suburb, day: household?.councilCollectionDay, dayName, profileId });
  const message = inviteMessage(inviteUrl, suburb, { dayName, households: have, needed, live });

  return (
    <div className="min-h-dvh bg-white px-6 py-10 flex flex-col items-center" style={{ paddingTop: "max(5.5rem, calc(env(safe-area-inset-top) + 4.5rem))" }}>
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6"><Logo size="md" /></div>
        <p className="text-[12px] uppercase tracking-wider text-violet-700/70 font-semibold mb-2">
          {building ? "Building list" : "Your street"}
        </p>
        <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-2">
          {building ? `Sort at home in ${place}` : "Start sorting today"}
        </h1>
        <p className="text-[14px] text-slate-500 mb-5">
          {building
            ? "You manage your own four streams. Common-area pickups are phase 2 — invite a house on the street so a collection night can start."
            : `You manage the four streams at home. We tell you the night we collect — the night before ${dayName ?? "your recycling day"}.`}
        </p>

        <CollectionNightCard
          nextPickup={nextPickup}
          confirmed={pickupConfirmed}
          unlocked={live || household?.binStatus === "allocated"}
          dayName={dayName}
        />

        <div className="mb-4">
          <div className="h-3 bg-violet-100 rounded-full overflow-hidden">
            <div className="h-full bg-violet-600 rounded-full" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[13px] font-semibold text-slate-800 mt-2">
            {building
              ? live
                ? "Houses on a recycling day have hit 12. You do not count toward the 12."
                : `${have} house${have === 1 ? "" : "s"} on ${dayName ?? "a recycling day"} in ${place}. You do not count toward the 12.`
              : live
                ? `${have} household${have === 1 ? "" : "s"} on ${dayName ?? "that recycling day"} — enough to start the night`
                : `${have}/${LIVE_HOUSEHOLD_THRESHOLD} on ${dayName ?? "your recycling day"}${needed > 0 ? ` · text ${needed} more ${dayName ?? "same-day"} house${needed === 1 ? "" : "s"}` : ""}`}
          </p>
        </div>

        {!live && !pickupConfirmed && (
          <div className="mb-5">
            <p className="text-[15px] font-display font-extrabold text-slate-900 mb-1">
              {building ? "Invite a house on the street" : `Text 3 ${dayName ?? "same-day"} houses now`}
            </p>
            <p className="text-[12px] text-slate-500 mb-3">
              The collection night starts when {LIVE_HOUSEHOLD_THRESHOLD} houses on the same recycling day join. Same day is the unlock.
            </p>
            <InviteActions url={inviteUrl} message={message} />
            {suburb && (
              <a
                href={streetCardPath({ suburb, day: household?.councilCollectionDay, dayName })}
                className="block mt-2 text-center text-[12px] font-semibold text-violet-800"
              >
                Print a letterbox card
              </a>
            )}
          </div>
        )}

        <div className="grid grid-cols-4 gap-2 mb-4">
          {STREAMS.map((s) => (
            <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-2.5 text-center">
              <div className={`w-6 h-6 ${s.color} rounded-lg mx-auto mb-1.5`} />
              <p className="text-[12px] font-display font-extrabold text-slate-900">{s.label}</p>
              <p className="text-[10px] text-slate-400 leading-tight">{s.hint}</p>
            </div>
          ))}
        </div>

        {onScanPress && (
          <button
            type="button"
            onClick={onScanPress}
            className="w-full bg-white border border-slate-200 text-slate-700 font-semibold py-3 rounded-2xl text-[13px] mb-5 flex items-center justify-center gap-2 min-h-[44px]"
          >
            <ScanBarcode className="w-4 h-4" />
            Optional: photo a container
          </button>
        )}

        {residentialNeedsStreet(household) && (
          <a href="/onboard" className="block mb-4 text-center text-[13px] font-semibold text-violet-800 bg-violet-50 border border-violet-200 rounded-xl py-3">
            Add your suburb and recycling day so we can tell you the collection night
          </a>
        )}
        <WaitlistCard
          suburb={suburb}
          households={have}
          needed={needed}
          live={live}
          binStatus={household?.binStatus ?? "waitlisted"}
          dayName={dayName}
          day={household?.councilCollectionDay}
          building={building}
          hideInvite={!live && !pickupConfirmed}
        />
        <p className="text-[12px] text-slate-400 text-center mt-4">
          Credits start after we collect and a depot verifies the containers. Scan is optional.
        </p>
      </div>
    </div>
  );
}
