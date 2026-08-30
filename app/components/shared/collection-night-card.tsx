"use client";

import { Truck } from "lucide-react";
import { formatCollectionNight } from "@/lib/brisbane";

function pickupCopy(confirmed: boolean | undefined, unlocked: boolean | undefined) {
  if (confirmed) return "Bag out your sorted containers. We take them to a refund point or depot.";
  if (unlocked) return "Suburb volume is enough for a driver trip. We'll confirm when to bag out. Keep scanning.";
  return "A volume run starts once your suburb has enough scanned containers for one driver trip. Scan today — 5¢ each.";
}

export function CollectionNightCard({
  nextPickup,
  confirmed,
  unlocked,
  dayName: _dayName,
  tone = "light",
}: {
  nextPickup: string | null;
  confirmed?: boolean;
  unlocked?: boolean;
  dayName?: string | null;
  tone?: "light" | "green";
}) {
  const date = formatCollectionNight(nextPickup);
  if (!date) return null;

  if (tone === "green") {
    return (
      <div className="bg-gradient-to-br from-green-500 to-green-600 text-white rounded-2xl p-5 mb-6 shadow-lg shadow-green-600/25">
        <div className="flex items-start gap-3">
          <Truck className="w-6 h-6 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[11px] uppercase tracking-wider text-white/70 mb-1">
              {confirmed ? "Bag out" : "Next pickup"}
            </p>
            <p className="text-xl font-display font-extrabold">{date}</p>
            <p className="text-[12px] text-white/80 mt-1">{pickupCopy(confirmed, unlocked)}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${confirmed ? "bg-green-50 border-green-200" : "bg-violet-50 border-violet-200"} border rounded-2xl px-4 py-3 mb-3 flex items-start gap-3`}>
      <Truck className={`w-5 h-5 shrink-0 mt-0.5 ${confirmed ? "text-green-700" : "text-violet-700"}`} />
      <div>
        <p className={`text-[11px] uppercase tracking-wider ${confirmed ? "text-green-700/70" : "text-violet-700/70"}`}>
          {confirmed ? "Bag out" : "We'll collect"}
        </p>
        <p className="text-[15px] font-display font-extrabold text-slate-900">{date}</p>
        <p className="text-[12px] text-slate-500 mt-0.5">{pickupCopy(confirmed, unlocked)}</p>
      </div>
    </div>
  );
}
