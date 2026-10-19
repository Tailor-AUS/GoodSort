"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiUrl } from "@/lib/config";
import { clusterForDay, rankByUnlockProximity, streetInvitePath, titleSuburb, wedgeSuburbs, type GrowthSuburb } from "@/lib/brisbane";
import { normaliseReadiness } from "@/lib/collection-readiness";

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
    .filter((s) => (clusterForDay(s)?.containers ?? clusterForDay(s)?.households ?? 0) > 0)
    .slice(0, 8);

  if (state === "loading") {
    return <p className="text-[13px] text-slate-400 mb-8">Checking suburb aluminium volume…</p>;
  }

  if (state === "unavailable") {
    return (
      <p className="text-[13px] text-slate-400 mb-8">
        Suburb aluminium volume loads when the API is reachable. Collection runs happen only when suburb aluminium volume warrants a trip and ops confirm. City-wide totals never unlock a run.
      </p>
    );
  }

  if (closest.length === 0) {
    const wedge = wedgeSuburbs().slice(0, 8);
    return (
      <div className="mb-10">
        <p className="text-[13px] text-slate-500 mb-3">
          No scanned volume yet. Be the first scan — every aluminium can builds suburb volume toward an operator-confirmed run.
        </p>
        <div className="flex flex-wrap gap-2">
          {wedge.map((s) => (
            <Link
              key={s.slug}
              href={`/brisbane/${s.slug}`}
              className="text-[13px] font-semibold text-violet-800 bg-violet-50 border border-violet-200 rounded-full px-3 py-1.5 hover:border-violet-400"
            >
              {s.name}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-10">
      <h2 className="text-[12px] uppercase tracking-wider text-slate-400 font-semibold mb-3">Suburb aluminium activity</h2>
      <ul className="space-y-2">
        {closest.map((s) => {
          const day = clusterForDay(s);
          const label = titleSuburb(s.suburb);
          const r = normaliseReadiness(s.readiness, s.aluminiumContainers ?? 0);
          const badge =
            r.status === "ops_committed"
              ? "Ops committed"
              : r.status === "aluminium_volume_reached_awaiting_ops"
                ? `${r.aluminiumContainers}/${r.aluminiumThreshold} cans · awaiting ops`
                : r.aluminiumThreshold != null
                  ? `${r.aluminiumContainers}/${r.aluminiumThreshold} cans`
                  : `${r.aluminiumContainers} can${r.aluminiumContainers === 1 ? "" : "s"}`;
          return (
            <li key={s.suburb}>
              <Link href={streetInvitePath({ suburb: s.suburb, day: day?.day, dayName: day?.dayName })} className="flex items-center justify-between border border-slate-200 rounded-xl px-3 py-3 hover:border-violet-400">
                <span className="text-[14px] font-semibold text-slate-900">{label}</span>
                <span className="text-[12px] text-slate-500">{badge}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
