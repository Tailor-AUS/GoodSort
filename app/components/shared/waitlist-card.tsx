"use client";

import { useEffect, useState } from "react";
import { inviteMessage, streetInviteUrl, titleSuburb, canonicalSuburb } from "@/lib/brisbane";
import {
  PENDING_READINESS_CONFIG,
  normaliseReadiness,
  readinessCopy,
  type CollectionReadinessConfig,
  type SuburbReadiness,
} from "@/lib/collection-readiness";
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
  readiness?: SuburbReadiness;
  readinessConfig?: CollectionReadinessConfig;
};

export function WaitlistCard({
  suburb,
  households,
  needed,
  live,
  binStatus,
  dayName,
  day,
  building,
  hideInvite,
  containers,
  readiness: rawReadiness,
  readinessConfig: rawConfig,
}: WaitlistCardProps) {
  const place = suburb ? titleSuburb(suburb) : "your suburb";
  const ordered = binStatus === "allocated";
  const arriving = binStatus === "delivered" || binStatus === "collecting";
  const readiness = rawReadiness ?? normaliseReadiness(undefined);
  const readinessConfig = rawConfig ?? PENDING_READINESS_CONFIG;
  const committed = ordered || readiness.status === "ops_committed";
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  useEffect(() => { setProfileId(readStoredProfileId()); }, []);
  const inviteUrl = streetInviteUrl({ suburb, day, dayName, profileId });
  const volume = containers ?? 0;
  const message = inviteMessage(inviteUrl, suburb, {
    dayName,
    containers: volume,
    households,
    needed,
    live,
    committed,
    aluminium: readiness.aluminiumContainers,
    aluminiumThreshold: readiness.aluminiumThreshold,
  });

  // No usable suburb means the server is not counting this member at all.
  const noSuburb = !building && canonicalSuburb(suburb) === null;
  const copy = readinessCopy(readiness, readinessConfig, place);

  let title = building ? `Building list in ${place}` : copy.title;
  let body = building
    ? `${volume} container${volume === 1 ? "" : "s"} scanned on the street so far. You do not count toward suburb volume. Invite a house to scan.`
    : copy.body;
  if (noSuburb) {
    title = "We do not know your suburb yet";
    body = "Your scans are safe, but they are not building toward a run until we know where to collect. Add your suburb to start counting.";
  } else if (arriving) {
    title = `${place} is collecting`;
    body = "Bag out your sorted containers when we collect. We take them to a refund point or depot.";
  } else if (ordered) {
    title = `${place} unlocked — volume run is on`;
    body = "We'll tell you when to bag out. Invite neighbours to scan so the first trip is full.";
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
