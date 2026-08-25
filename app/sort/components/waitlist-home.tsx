"use client";

import { LIVE_HOUSEHOLD_THRESHOLD, residentialNeedsStreet, titleSuburb } from "@/lib/brisbane";
import { Logo } from "@/app/components/shared/logo";
import { WaitlistCard } from "@/app/components/shared/waitlist-card";
import type { HouseholdStatus } from "./sorter-sheet";

export function WaitlistHome({ household }: { household: HouseholdStatus | null }) {
  const suburb = household?.suburb;
  const building = household?.type === "unit_complex";
  const have = household?.households ?? (building ? 0 : 1);
  const needed = household?.needed ?? Math.max(0, LIVE_HOUSEHOLD_THRESHOLD - have);
  const live = !!household?.areaLive;
  const dayName = household?.dayName;
  const pct = Math.min(100, Math.round((have / LIVE_HOUSEHOLD_THRESHOLD) * 100));
  const place = suburb ? titleSuburb(suburb) : "your street";

  return (
    <div className="min-h-dvh bg-white px-6 py-10 flex flex-col items-center" style={{ paddingTop: "max(5.5rem, calc(env(safe-area-inset-top) + 4.5rem))" }}>
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6"><Logo size="md" /></div>
        <p className="text-[12px] uppercase tracking-wider text-violet-700/70 font-semibold mb-2">
          {building ? "Building waitlist" : "Waitlist"}
        </p>
        <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-2">
          {building
            ? live ? `${place} houses can unlock` : `Invite houses in ${place}`
            : live ? `${place} can unlock` : `Get ${place} to ${LIVE_HOUSEHOLD_THRESHOLD}`}
        </h1>
        <p className="text-[14px] text-slate-500 mb-5">
          {building
            ? live
              ? "Houses on a recycling day have hit 12. Common-area pickups are still phase 2. Invite more houses so the first night is dense."
              : `${have} house${have === 1 ? "" : "s"} on ${dayName ?? "a recycling day"} in ${place}. You are on the building list — you do not count toward the 12.`
            : live
            ? "Enough neighbours on your recycling day have joined. We'll email you when purple bins are on the way."
            : `${have} of ${LIVE_HOUSEHOLD_THRESHOLD} households on ${dayName ?? "your recycling day"}. Invite the street — we email you when a neighbour joins.`}
        </p>
        <div className="mb-5">
          <div className="h-3 bg-violet-100 rounded-full overflow-hidden">
            <div className="h-full bg-violet-600 rounded-full" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[12px] text-slate-500 mt-2">
            {live
              ? `${have} household${have === 1 ? "" : "s"} on ${dayName ?? "that recycling day"} — enough to order bins`
              : `${have}/${LIVE_HOUSEHOLD_THRESHOLD}${needed > 0 ? ` · ${needed} more on that day` : ""}`}
          </p>
        </div>
        {residentialNeedsStreet(household) && (
          <a href="/onboard" className="block mb-4 text-center text-[13px] font-semibold text-violet-800 bg-violet-50 border border-violet-200 rounded-xl py-3">
            Add your suburb and recycling day so neighbours can join your night
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
        />
        <p className="text-[12px] text-slate-400 text-center mt-4">
          Credits start after we collect your purple bin and a depot verifies the containers. Scan is not required to stay on the list.
        </p>
      </div>
    </div>
  );
}
