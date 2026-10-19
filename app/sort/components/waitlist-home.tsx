"use client";

import { useEffect, useState } from "react";
import { ScanBarcode } from "lucide-react";
import { LIVE_VOLUME_THRESHOLD, inviteMessage, residentialNeedsStreet, streetInviteUrl, titleSuburb, canonicalSuburb } from "@/lib/brisbane";
import { PENDING_READINESS_CONFIG, normaliseReadiness, readinessCopy } from "@/lib/collection-readiness";
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
  const containers = household?.containers ?? 0;
  const needed = household?.needed ?? Math.max(0, LIVE_VOLUME_THRESHOLD - containers);
  const dayName = household?.dayName;
  const place = suburb ? titleSuburb(suburb) : "your suburb";
  const readiness = household?.readiness ?? normaliseReadiness(undefined);
  const readinessConfig = household?.readinessConfig ?? PENDING_READINESS_CONFIG;
  const allocated = household?.binStatus === "allocated";
  const committed = readiness.status === "ops_committed" || allocated;
  const copy = readinessCopy(readiness, readinessConfig, place);
  const knownSuburb = canonicalSuburb(suburb) !== null;
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  useEffect(() => { setProfileId(readStoredProfileId()); }, []);
  const inviteUrl = streetInviteUrl({ suburb, day: household?.councilCollectionDay, dayName, profileId });
  const message = inviteMessage(inviteUrl, suburb, { dayName, containers, households: have, needed, aluminium: readiness.aluminiumContainers });

  return (
    <div className="min-h-dvh bg-white px-6 py-10 flex flex-col items-center" style={{ paddingTop: "max(5.5rem, calc(env(safe-area-inset-top) + 4.5rem))" }}>
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6"><Logo size="md" /></div>
        <p className="text-[12px] uppercase tracking-wider text-violet-700/70 font-semibold mb-2">
          {building ? "Building list" : "Your suburb"}
        </p>
        <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-2">
          {building ? `Scan in ${place}` : "Scan. Earn 5¢."}
        </h1>
        <p className="text-[14px] text-slate-500 mb-5">
          {building
            ? "Scan eligible containers and sort into four streams. Common-area pickups are phase 2 — invite a house on the street to build suburb volume."
            : "Scan eligible cans and bottles for 5¢ each. Sort into four streams. A driver trip to a recycler happens only when suburb aluminium volume warrants it and ops confirm."}
        </p>

        <CollectionNightCard
          nextPickup={nextPickup}
          confirmed={pickupConfirmed}
          unlocked={committed}
          dayName={dayName}
        />

        {building ? (
          <p className="text-[13px] font-semibold text-slate-800 mb-4">
            {`${containers} containers scanned near ${place}. You do not count toward suburb volume.`}
          </p>
        ) : knownSuburb && !allocated ? (
          <div className="mb-4" data-testid="suburb-readiness">
            <p className="text-[11px] uppercase tracking-wider text-violet-700/70 mb-1">Suburb aluminium</p>
            {copy.progressPct !== null && (
              <div className="h-3 bg-violet-100 rounded-full overflow-hidden mb-2" aria-hidden="true">
                <div className="h-full bg-violet-600 rounded-full" style={{ width: `${copy.progressPct}%` }} />
              </div>
            )}
            <p className="text-[15px] font-display font-extrabold text-slate-900" data-testid="suburb-readiness-title">{copy.title}</p>
            <p className="text-[13px] text-slate-700 mt-1" data-testid="suburb-readiness-body">{copy.body}</p>
            {copy.fixtureNote && (
              <p className="text-[11px] text-amber-700 mt-1" data-testid="suburb-readiness-fixture">{copy.fixtureNote}</p>
            )}
          </div>
        ) : null}

        {/* No suburb means streetInvitePath resolves to "/" — the bare
            city-wide link 2a8ea09 removed. Prompt for the suburb instead. */}
        {!committed && !pickupConfirmed && (building || knownSuburb) && (
          <div className="mb-5">
            <p className="text-[15px] font-display font-extrabold text-slate-900 mb-1">
              {building ? "Invite a house to scan" : "Invite neighbours to scan"}
            </p>
            <p className="text-[12px] text-slate-500 mb-3">
              Every can scanned in {place} adds to suburb aluminium volume.
            </p>
            <InviteActions url={inviteUrl} message={message} />
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
            className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-2xl text-[14px] mb-5 flex items-center justify-center gap-2 min-h-[48px] shadow-lg shadow-green-600/20"
          >
            <ScanBarcode className="w-4 h-4" />
            Scan a container
          </button>
        )}

        {residentialNeedsStreet(household) && (
          <a href="/onboard" className="block mb-4 text-center text-[13px] font-semibold text-violet-800 bg-violet-50 border border-violet-200 rounded-xl py-3">
            Add your suburb so we can count your scans toward suburb volume
          </a>
        )}
        {/* Readiness above replaces the card's legacy 1,000-container copy for a
            known, uncommitted suburb; the card still covers no-suburb, building
            and this household's own allocated state. */}
        {(building || !knownSuburb || allocated) && (
          <WaitlistCard
            suburb={suburb}
            households={have}
            containers={containers}
            needed={needed}
            live={allocated}
            binStatus={household?.binStatus ?? "waitlisted"}
            dayName={dayName}
            day={household?.councilCollectionDay}
            building={building}
            hideInvite={!committed && !pickupConfirmed}
          />
        )}
        <p className="text-[12px] text-slate-400 text-center mt-4">
          Credits clear after we collect and a refund point or depot verifies the containers.
        </p>
      </div>
    </div>
  );
}
