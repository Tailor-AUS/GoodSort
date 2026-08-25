"use client";

import { useState } from "react";
import { apiUrl, writeDayHint, writePlaceHint } from "@/lib/config";
import { track } from "@/lib/analytics";
import { BCC_BIN_DAY_DATASET, DAY_NAMES, findSuburb, streetInvitePath, titleSuburb } from "@/lib/brisbane";
import { AddressAutocomplete } from "@/app/components/shared/address-autocomplete";

type Props = {
  suburbName?: string;
  onResolved?: (result: { day: number | null; suburb: string | null }) => void;
};

export function BinDayFinder({ suburbName, onResolved }: Props) {
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "found" | "miss">("idle");
  const [day, setDay] = useState<number | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);

  async function lookup(sel: { address: string; lat: number; lng: number; suburb?: string }) {
    setAddress(sel.address);
    setStatus("loading");
    const suburb = sel.suburb ? (findSuburb(sel.suburb)?.name ?? sel.suburb) : suburbName ?? null;
    writePlaceHint({ address: sel.address, lat: sel.lat, lng: sel.lng, suburb });
    if (suburb) {
      try { sessionStorage.setItem("goodsort_suburb_hint", suburb); } catch { /* ignore */ }
    }
    try {
      const res = await fetch(apiUrl("/api/households/lookup-bin-day"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: sel.lat, lng: sel.lng, address: sel.address }),
      });
      const data = await res.json().catch(() => ({} as { found?: boolean; dayOfWeek?: number; source?: string; councilArea?: string }));
      if (data.found && typeof data.dayOfWeek === "number") {
        const councilArea = typeof data.councilArea === "string" ? data.councilArea : null;
        setDay(data.dayOfWeek);
        setPlace(suburb);
        setSource(typeof data.source === "string" ? data.source : null);
        writeDayHint(data.dayOfWeek);
        writePlaceHint({ address: sel.address, lat: sel.lat, lng: sel.lng, suburb, councilArea });
        track("bin_day_looked_up", { suburb });
        onResolved?.({ day: data.dayOfWeek, suburb });
        setStatus("found");
        return;
      }
    } catch { /* miss */ }
    setPlace(suburb);
    onResolved?.({ day: null, suburb });
    setStatus("miss");
  }

  const known = place ? findSuburb(place) : undefined;
  const href = known && day != null ? streetInvitePath({ suburb: known.name, day }) : null;

  return (
    <div className="w-full max-w-md mb-6">
      <p className="text-[12px] font-semibold text-slate-600 mb-2">
        {suburbName ? `What is your ${suburbName} recycling day?` : "What is your recycling day?"}
      </p>
      <AddressAutocomplete
        value={address}
        onChange={(text) => {
          setAddress(text);
          setStatus("idle");
          setDay(null);
        }}
        onSelect={lookup}
        placeholder={suburbName ? `Start typing your ${suburbName} address…` : "Start typing your Brisbane address…"}
      />
      {status === "loading" && (
        <p className="text-[12px] text-slate-500 mt-2">Checking Brisbane City Council open data…</p>
      )}
      {status === "found" && day != null && (
        <p className="text-[13px] text-slate-700 mt-2">
          <span className="font-semibold">{place ? `${titleSuburb(place)} · ` : ""}{DAY_NAMES[day]}</span>
          {" "}from{" "}
          <a href={BCC_BIN_DAY_DATASET} target="_blank" rel="noopener noreferrer" className="underline text-violet-800">
            Brisbane City Council open data
          </a>
          {source?.includes("suburb") ? " (street split — confirm when you join)." : "."}
          {href && !suburbName && (
            <>
              {" "}
              <a href={href} className="font-semibold text-violet-800 underline">Start sorting there</a>
            </>
          )}
        </p>
      )}
      {status === "miss" && (
        <p className="text-[12px] text-slate-500 mt-2">
          No match in the{" "}
          <a href={BCC_BIN_DAY_DATASET} target="_blank" rel="noopener noreferrer" className="underline">
            council dataset
          </a>
          . Pick the day when you join — we only unlock houses on the same night.
        </p>
      )}
    </div>
  );
}
