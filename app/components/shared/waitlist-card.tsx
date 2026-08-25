"use client";

import { useEffect, useState } from "react";
import { LIVE_HOUSEHOLD_THRESHOLD, inviteMessage, streetInviteUrl, titleSuburb } from "@/lib/brisbane";
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
};

export function WaitlistCard({ suburb, households, needed, live, binStatus, dayName, day, building }: WaitlistCardProps) {
  const place = suburb ? titleSuburb(suburb) : "your suburb";
  const dayLabel = dayName ?? "your recycling day";
  const ordered = binStatus === "allocated";
  const arriving = binStatus === "delivered" || binStatus === "collecting";
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  useEffect(() => { setProfileId(readStoredProfileId()); }, []);
  const inviteUrl = streetInviteUrl({ suburb, day, dayName, profileId });
  const message = inviteMessage(inviteUrl, suburb, { dayName, households, needed, live });

  let title = building ? `Building list in ${place}` : `You're on the list in ${place}`;
  let body = building
    ? `${households} house${households === 1 ? "" : "s"} on ${dayLabel} so far. You do not count toward the 12. Invite a house on the street.`
    : `${households} household${households === 1 ? "" : "s"} on ${dayLabel}. ${needed} more on that day and we order purple bins. We'll email you when a neighbour joins.`;
  if (arriving) {
    title = `${place} is collecting`;
    body = "Put your purple The Good Sort bin on the kerb the night before council recycling.";
  } else if (ordered) {
    title = `${place} unlocked — bins on order`;
    body = "We'll email you when your purple bin is on the way. Invite the rest of the street so the first run is dense.";
  } else if (live) {
    title = `${place} ${dayLabel} has enough neighbours`;
    body = `We've hit ${LIVE_HOUSEHOLD_THRESHOLD} households on the same recycling day. We'll tell you when your purple bin is coming.`;
  }

  return (
    <div className="bg-violet-50 border border-violet-200 rounded-2xl px-4 py-3 mb-3">
      <p className="text-[11px] uppercase tracking-wider text-violet-700/70 mb-1">Waitlist</p>
      <p className="text-[15px] font-display font-extrabold text-slate-900">{title}</p>
      <p className="text-[12px] text-slate-600 mt-1">{body}</p>
      {!arriving && (
        <div className="mt-3">
          <InviteActions url={inviteUrl} message={message} compact />
        </div>
      )}
    </div>
  );
}
