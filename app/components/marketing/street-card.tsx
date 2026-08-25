"use client";

import { useSearchParams } from "next/navigation";
import {
  DAY_NAMES,
  LIVE_HOUSEHOLD_THRESHOLD,
  parseDayParam,
  streetInviteUrl,
  titleSuburb,
} from "@/lib/brisbane";

export function StreetCard({ suburbName, suburbSlug }: { suburbName: string; suburbSlug: string }) {
  const params = useSearchParams();
  const day = parseDayParam(params.get("day"));
  const dayName = day != null ? DAY_NAMES[day] : null;
  const joinUrl = streetInviteUrl({ suburb: suburbName, day, dayName });
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=8&data=${encodeURIComponent(joinUrl)}`;
  const place = titleSuburb(suburbName);

  return (
    <div className="min-h-dvh bg-slate-100 px-4 py-6 print:bg-white print:min-h-0 print:p-0">
      <style>{`
        @media print {
          @page { size: A6 portrait; margin: 8mm; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="no-print max-w-sm mx-auto mb-4">
        <p className="text-[13px] text-slate-600 mb-3">
          Print this and drop it in letterboxes on the same recycling day. It is not a city-wide pickup.
        </p>
        <button
          type="button"
          onClick={() => window.print()}
          className="w-full bg-violet-700 text-white font-bold py-3 rounded-xl text-[15px] min-h-[44px]"
        >
          Print letterbox card
        </button>
        <a href={`/brisbane/${suburbSlug}${dayName ? `?day=${dayName.toLowerCase()}` : ""}`} className="block text-center text-[13px] text-violet-800 font-semibold mt-3">
          Back to {place}
        </a>
      </div>

      <article className="max-w-[105mm] mx-auto bg-white border border-violet-200 rounded-2xl px-5 py-6 text-center print:border-0 print:rounded-none print:max-w-none">
        <p className="text-[11px] uppercase tracking-[0.14em] text-violet-700 font-semibold mb-2">The Good Sort</p>
        <h1 className="text-[22px] font-display font-extrabold text-slate-900 leading-tight mb-2">
          Starting on this street in {place}
        </h1>
        <p className="text-[14px] text-slate-600 leading-relaxed mb-4">
          Sort eligible cans and bottles at home today — four bags. They collect the night before
          {dayName ? ` ${dayName}` : " your"} recycling.
          {" "}{LIVE_HOUSEHOLD_THRESHOLD} houses on that day and the night starts.
        </p>
        <p className="text-[13px] text-slate-500 mb-4">
          5¢ sorting credit. Not the 10¢ scheme refund. No depot trip. They do not rummage the yellow bin.
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt={`Join The Good Sort in ${place}`} width={140} height={140} className="mx-auto mb-3" />
        <p className="text-[13px] font-semibold text-slate-900 break-all">
          thegoodsort.org/brisbane/{suburbSlug}
        </p>
        {dayName && <p className="text-[12px] text-violet-800 font-semibold mt-1">{dayName} recycling</p>}
      </article>
    </div>
  );
}
