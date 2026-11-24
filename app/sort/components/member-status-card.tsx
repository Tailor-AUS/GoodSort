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
 * Frequent Sorter Reward Preference selector — lets members keep live 10c
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
    <div className="rounded-2xl bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <p className="text-[15px] font-display font-bold text-slate-900">
            Good Sort Points &amp; payouts
          </p>
          <p className="text-[12px] text-slate-500">
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
              ? "bg-emerald-50/70 border-emerald-500 ring-1 ring-emerald-500/20"
              : "bg-[#f4f5f7] border-transparent hover:bg-slate-100"
          }`}
        >
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <Wallet className="w-4 h-4 text-emerald-600" />
            <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[10px] font-bold">
              Live
            </span>
          </div>
          <p className="text-[14px] font-bold text-slate-900">10¢ Cash</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Direct to PayID / bank</p>
        </button>

        <button
          type="button"
          onClick={() => togglePointsInterest(true)}
          className={`rounded-2xl p-3.5 text-left border transition-all ${
            pointsSwapVoted
              ? "bg-slate-900 text-white border-slate-900"
              : "bg-[#f4f5f7] border-transparent hover:bg-slate-100 text-slate-900"
          }`}
        >
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <Plane className={`w-4 h-4 ${pointsSwapVoted ? "text-rose-400" : "text-rose-600"}`} />
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                pointsSwapVoted ? "bg-rose-500/25 text-rose-200" : "bg-white text-slate-600"
              }`}
            >
              {pointsSwapVoted ? "Voted" : "Soon"}
            </span>
          </div>
          <p className="text-[14px] font-bold">Points Swap</p>
          <p className={`text-[11px] mt-0.5 ${pointsSwapVoted ? "text-slate-300" : "text-slate-500"}`}>
            Airline points · 10 pts/can
          </p>
        </button>
      </div>

      {pointsSwapVoted ? (
        <p className="mt-3 flex items-start gap-2 text-[12px] text-slate-600 leading-snug bg-[#f4f5f7] rounded-xl p-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span>
            Vote saved — member demand unlocks Australian frequent flyer points swaps. Your 10¢ PayID cash payouts stay active until launched.
          </span>
        </p>
      ) : onOpenPayouts ? (
        <button
          type="button"
          onClick={onOpenPayouts}
          className="mt-3 w-full text-left text-[13px] font-semibold text-emerald-700 hover:text-emerald-900 py-1"
        >
          Manage PayID &amp; bank details →
        </button>
      ) : null}
    </div>
  );
}
