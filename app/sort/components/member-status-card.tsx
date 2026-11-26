"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Plane, Wallet } from "lucide-react";
import { track } from "@/lib/analytics";

const POINTS_INTEREST_KEY = "goodsort_points_swap_interest";

interface RewardPreferenceCardProps {
  suburbLabel: string | null;
  onOpenPayouts?: () => void;
}

/**
 * Frequent Sorter Reward Preference selector — lets members keep live 8c
 * cash via PayID/bank or register demand for future Australian frequent
 * flyer points swaps (Good Sort Points / Points Swap) without claiming any
 * unexecuted third-party airline partnership.
 */
export function MemberStatusCard({ suburbLabel, onOpenPayouts }: RewardPreferenceCardProps) {
  const [pointsSwapVoted, setPointsSwapVoted] = useState(false);

  useEffect(() => {
    try {
      setPointsSwapVoted(localStorage.getItem(POINTS_INTEREST_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  function togglePointsInterest(wantPoints: boolean) {
    setPointsSwapVoted(wantPoints);
    try {
      localStorage.setItem(POINTS_INTEREST_KEY, wantPoints ? "1" : "0");
    } catch {
      /* ignore */
    }
    track(wantPoints ? "points_swap_voted" : "cash_payout_selected", { suburb: suburbLabel });
  }

  return (
    <div className="rounded-[24px] liquid-glass p-4 text-white">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <p className="text-[15px] font-display font-bold text-white">
            Good Sort Points &amp; payouts
          </p>
          <p className="text-[12px] text-white/80">
            Frequent Sorter payout mode · choose cash or vote for points
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => togglePointsInterest(false)}
          className={`rounded-2xl p-3.5 text-left border transition-all ${
            !pointsSwapVoted
              ? "bg-emerald-400/25 border-emerald-200/70 ring-1 ring-emerald-200/40"
              : "bg-white/10 border-white/20 hover:bg-white/15"
          }`}
        >
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <Wallet className="w-4 h-4 text-emerald-200" />
            <span className="rounded-full bg-emerald-400/90 text-slate-950 px-2 py-0.5 text-[10px] font-bold">
              Live
            </span>
          </div>
          <p className="text-[14px] font-bold text-white">8¢ Cash</p>
          <p className="text-[11px] text-white/80 mt-0.5">Direct to PayID / bank</p>
        </button>

        <button
          type="button"
          onClick={() => togglePointsInterest(true)}
          className={`rounded-2xl p-3.5 text-left border transition-all ${
            pointsSwapVoted
              ? "bg-white/95 text-slate-950 border-white shadow-md"
              : "bg-white/10 border-white/20 hover:bg-white/15 text-white"
          }`}
        >
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <Plane className={`w-4 h-4 ${pointsSwapVoted ? "text-rose-600" : "text-rose-300"}`} />
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                pointsSwapVoted ? "bg-rose-100 text-rose-800" : "bg-white/15 text-white/90"
              }`}
            >
              {pointsSwapVoted ? "Voted" : "Soon"}
            </span>
          </div>
          <p className="text-[14px] font-bold">Points Swap</p>
          <p className={`text-[11px] mt-0.5 ${pointsSwapVoted ? "text-slate-600" : "text-white/80"}`}>
            Airline points · 10 pts/can
          </p>
        </button>
      </div>

      {pointsSwapVoted ? (
        <p className="mt-3 flex items-start gap-2 text-[12px] text-white/90 leading-snug bg-white/12 border border-white/20 rounded-xl p-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
          <span>
            Vote saved — member demand unlocks Australian frequent flyer points swaps. Your 8¢ PayID cash payouts stay active until launched.
          </span>
        </p>
      ) : onOpenPayouts ? (
        <button
          type="button"
          onClick={onOpenPayouts}
          className="mt-2 w-full min-h-[44px] inline-flex items-center text-left text-[13px] font-semibold text-emerald-200 hover:text-white py-2.5"
        >
          Manage PayID &amp; bank details →
        </button>
      ) : null}
    </div>
  );
}
