"use client";

import { Truck } from "lucide-react";
import { formatCollectionNight } from "@/lib/brisbane";

const CONFIRMED_COPY = "Bag out your sorted containers. We take them to a refund point or depot.";

/**
 * Only render a pickup date card when the server has confirmed an active
 * GoodSort pickup (`confirmed === true`).
 *
 * For unconfirmed/waitlisted households, `nextPickup` from the API is merely
 * `NextRunnerLocalDate(councilCollectionDay)` — the night before council
 * yellow-lid bin day. Showing that calendar date on `/sort` or `/household`
 * misleads households at < 1,000 suburb containers into expecting a scheduled
 * Thursday/council-eve pickup (violating AGENTS.md §3: scan-first, 1,000-container
 * suburb pool trigger, no yellow-lid bins or night-before rules).
 */
export function CollectionNightCard({
  nextPickup,
  confirmed,
  tone = "light",
}: {
  nextPickup: string | null;
  confirmed?: boolean;
  unlocked?: boolean;
  dayName?: string | null;
  tone?: "light" | "green";
}) {
  if (!confirmed) return null;
  const date = formatCollectionNight(nextPickup);
  if (!date) return null;

  if (tone === "green") {
    return (
      <div className="bg-gradient-to-br from-green-500 to-green-600 text-white rounded-2xl p-5 mb-6 shadow-lg shadow-green-600/25">
        <div className="flex items-start gap-3">
          <Truck className="w-6 h-6 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[11px] uppercase tracking-wider text-white/70 mb-1">
              Bag out
            </p>
            <p className="text-xl font-display font-extrabold">{date}</p>
            <p className="text-[12px] text-white/80 mt-1">{CONFIRMED_COPY}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-green-50 border-green-200 border rounded-2xl px-4 py-3 mb-3 flex items-start gap-3">
      <Truck className="w-5 h-5 shrink-0 mt-0.5 text-green-700" />
      <div>
        <p className="text-[11px] uppercase tracking-wider text-green-700/70">
          Bag out
        </p>
        <p className="text-[15px] font-display font-extrabold text-slate-900">{date}</p>
        <p className="text-[12px] text-slate-500 mt-0.5">{CONFIRMED_COPY}</p>
      </div>
    </div>
  );
}
