"use client";

import { useEffect, useState } from "react";
import { LIVE_VOLUME_THRESHOLD, inviteMessage, streetInviteUrl, titleSuburb, canonicalSuburb } from "@/lib/brisbane";
import { readStoredProfileId } from "@/lib/config";
import { InviteActions } from "@/app/components/shared/invite-actions";

type WaitlistCardProps = {
  suburb?: string | null;
  households: number;
  needed: number;
  live: boolean;
  binStatus?: string | null;
  dayName?: string | null;
  day?: number | null;
  building?: boolean;
  hideInvite?: boolean;
  containers?: number;
};

export function WaitlistCard({ suburb, households, needed, live, binStatus, dayName, day, building, hideInvite, containers }: WaitlistCardProps) {
  const place = suburb ? titleSuburb(suburb) : "your suburb";
  const ordered = binStatus === "allocated";
  const arriving = binStatus === "delivered" || binStatus === "collecting";
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  useEffect(() => { setProfileId(readStoredProfileId()); }, []);
  const inviteUrl = streetInviteUrl({ suburb, day, dayName, profileId });
  const volume = containers ?? 0;
  const message = inviteMessage(inviteUrl, suburb, { dayName, containers: volume, households, needed, live });

  // No usable suburb means the server is not counting this member at all.
  // Saying "0/1000 containers in your suburb" reads as on-track and is not
  // true — there is no suburb, so nothing is accruing anywhere.
  const noSuburb = !building && canonicalSuburb(suburb) === null;

  let title = building ? `Building list in ${place}` : `Keep scanning in ${place}`;
  let body = building
    ? `${volume} container${volume === 1 ? "" : "s"} scanned on the street so far. You do not count toward suburb volume. Invite a house to scan.`
    : `${volume}/${LIVE_VOLUME_THRESHOLD} containers in ${place}. ${needed} more and we run a driver trip to the refund point. Invite neighbours to scan.`;
  if (noSuburb) {
    title = "We do not know your suburb yet";
    body = "Your scans are safe, but they are not building toward a run until we know where to collect. Add your suburb to start counting.";
  } else if (arriving) {
    title = `${place} is collecting`;
    body = "Bag out your sorted containers when we collect. We take them to a refund point or depot.";
  } else if (ordered) {
    title = `${place} unlocked — volume run is on`;
    body = "We'll tell you when to bag out. Invite neighbours to scan so the first trip is full.";
  } else if (live) {
    title = `${place} has enough volume`;
    body = `We've hit about ${LIVE_VOLUME_THRESHOLD} scanned containers — enough for one driver trip. We'll tell you when to bag out.`;
  }

  return (
    <div className="bg-violet-50 border border-violet-200 rounded-2xl px-4 py-3 mb-3">
      <p className="text-[11px] uppercase tracking-wider text-violet-700/70 mb-1">Suburb</p>
      <p className="text-[15px] font-display font-extrabold text-slate-900">{title}</p>
      <p className="text-[12px] text-slate-600 mt-1">{body}</p>
      {noSuburb && (
        <a href="/onboard" className="mt-2 inline-block text-[12px] font-semibold text-violet-800 underline">
          Add your suburb →
        </a>
      )}
      {/* With no suburb, streetInvitePath falls back to "/" — so sharing here
          would send the bare city-wide link that 2a8ea09 removed. */}
      {!arriving && !hideInvite && !noSuburb && (
        <div className="mt-3">
          <InviteActions url={inviteUrl} message={message} compact />
        </div>
      )}
    </div>
  );
}
