"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiUrl } from "@/lib/config";
import { LIVE_HOUSEHOLD_THRESHOLD, clusterForDay, rankByUnlockProximity, streetInvitePath, titleSuburb, type GrowthSuburb } from "@/lib/brisbane";

export function DensityBoard() {
  const [suburbs, setSuburbs] = useState<GrowthSuburb[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    fetch(apiUrl("/api/growth/brisbane"))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.suburbs) {
          setSuburbs(d.suburbs);
          setState("ready");
        } else {
          setState("unavailable");
        }
      })
      .catch(() => setState("unavailable"));
  }, []);

  const closest = rankByUnlockProximity(suburbs)
    .filter((s) => (clusterForDay(s)?.households ?? 0) > 0)
    .slice(0, 8);

  if (state === "loading") {
    return <p className="text-[13px] text-slate-400 mb-8">Checking which streets are closest to a run…</p>;
  }

  if (state === "unavailable") {
    return (
      <p className="text-[13px] text-slate-400 mb-8">
        Street counts load when the waitlist API is reachable. {LIVE_HOUSEHOLD_THRESHOLD} houses on the same recycling day unlock a run — city-wide totals never do.
      </p>
    );
  }

  if (closest.length === 0) {
    return (
      <p className="text-[13px] text-slate-400 mb-8">
        No streets on the list yet. Join your suburb — {LIVE_HOUSEHOLD_THRESHOLD} houses on the same recycling day unlock a run.
      </p>
    );
  }

  return (
    <div className="mb-10">
      <h2 className="text-[12px] uppercase tracking-wider text-slate-400 font-semibold mb-3">Closest to a run</h2>
      <ul className="space-y-2">
        {closest.map((s) => {
          const day = clusterForDay(s);
          const label = day?.dayName
            ? `${titleSuburb(s.suburb)} · ${day.dayName}`
            : titleSuburb(s.suburb);
          const have = day?.households ?? 0;
          return (
            <li key={s.suburb}>
              <Link href={streetInvitePath({ suburb: s.suburb, day: day?.day, dayName: day?.dayName })} className="flex items-center justify-between border border-slate-200 rounded-xl px-3 py-3 hover:border-violet-400">
                <span className="text-[14px] font-semibold text-slate-900">{label}</span>
                <span className="text-[12px] text-slate-500">
                  {day?.live ? "Ready to order" : `${have}/${LIVE_HOUSEHOLD_THRESHOLD}`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
