"use client";

import { useState } from "react";
import { CheckCircle, SkipForward, Truck, Navigation, Camera } from "lucide-react";
import { formatCents } from "@/lib/store";
import type { RunDetail, RunStopDetail } from "@/lib/marketplace";

interface RunActiveProps {
  run: RunDetail;
  onStart: () => void;
  onArrive: (stopId: string) => void;
  onPickup: (stopId: string, count: number, photoUrl?: string) => void;
  onSkip: (stopId: string) => void;
  onDeliver: () => void;
  onComplete: () => void;
}

export function RunActive({ run, onStart, onArrive, onPickup, onSkip, onDeliver, onComplete }: RunActiveProps) {
  const [pickupCount, setPickupCount] = useState<Record<string, number>>({});

  const currentStop = run.stops.find((s) => s.status === "pending" || s.status === "arrived");
  const completedStops = run.stops.filter((s) => s.status === "picked_up").length;
  const totalStops = run.stops.length;
  const allDone = run.stops.every((s) => s.status === "picked_up" || s.status === "skipped");

  function openNavigation(stop: RunStopDetail) {
    // Deep link to Google Maps — address is only visible there, not in our app
    const url = `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving`;
    window.open(url, "_blank");
  }

  // ═══════ CLAIMED — Ready to start ═══════
  if (run.status === "claimed") {
    return (
      <>
        <div className="mb-5">
          <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Run claimed</p>
          <p className="text-xl font-display font-extrabold text-slate-900 mt-1">
            {run.stops.length} stops · {formatCents(run.estimatedPayoutCents)}
          </p>
          <p className="text-[13px] text-slate-400 mt-0.5">
            ~{run.estimatedDurationMin} min · {run.perContainerCents}c/container
          </p>
        </div>

        <div className="space-y-1.5 mb-5">
          {run.stops.map((stop, i) => (
            <div key={stop.id} className="flex items-center gap-3 py-2.5 px-3 glass rounded-xl border border-white/40">
              <span className="w-6 h-6 rounded-full bg-slate-200 text-[11px] font-bold text-slate-500 flex items-center justify-center flex-shrink-0">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-slate-700 font-medium truncate">
                  {stop.pickupInstruction || `Stop ${i + 1}`}
                </p>
                <p className="text-[11px] text-slate-400">~{stop.estimatedContainers} containers</p>
              </div>
              <button
                onClick={() => openNavigation(stop)}
                className="p-2 rounded-lg bg-blue-50 text-blue-600"
              >
                <Navigation className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={onStart}
          className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-4 rounded-2xl text-[15px] shadow-lg shadow-green-600/20 min-h-[48px] active:scale-[0.98] transition-transform"
        >
          Start Collection
        </button>
      </>
    );
  }

  // ═══════ IN PROGRESS — Stop by stop ═══════
  if (run.status === "in_progress" && currentStop) {
    const count = pickupCount[currentStop.id] ?? currentStop.estimatedContainers;

    return (
      <>
        {/* Progress bar */}
        <div className="flex items-center gap-2 mb-5">
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-400 to-green-600 rounded-full transition-all duration-500"
              style={{ width: `${totalStops > 0 ? (completedStops / totalStops) * 100 : 0}%` }}
            />
          </div>
          <span className="text-[12px] text-slate-400 font-bold">{completedStops}/{totalStops}</span>
        </div>

        <div className="mb-4">
          <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">
            {currentStop.status === "arrived" ? "At pickup" : "Next pickup"}
          </p>
          <p className="text-xl font-display font-extrabold text-slate-900 mt-1">
            {currentStop.pickupInstruction || `Stop ${currentStop.sequence + 1}`}
          </p>
          <p className="text-[12px] text-slate-500 mt-1.5">
            ~{currentStop.estimatedContainers} containers
          </p>
        </div>

        {/* Navigate button */}
        {currentStop.status === "pending" && (
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => openNavigation(currentStop)}
              className="flex-1 py-2.5 glass border border-blue-200 text-blue-600 font-bold rounded-xl text-[13px] flex items-center justify-center gap-2 min-h-[44px]"
            >
              <Navigation className="w-4 h-4" /> Navigate
            </button>
            <button
              onClick={() => onArrive(currentStop.id)}
              className="flex-1 py-2.5 bg-blue-500 text-white font-bold rounded-xl text-[13px] flex items-center justify-center gap-2 min-h-[44px]"
            >
              I&apos;ve Arrived
            </button>
          </div>
        )}

        {/* Pickup controls (shown after arriving) */}
        {currentStop.status === "arrived" && (
          <>
            {/* Container count adjuster */}
            <div className="glass rounded-xl p-3 border border-white/40 mb-4">
              <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-[0.08em] mb-2">Container count</p>
              <div className="flex items-center gap-3 justify-center">
                <button
                  onClick={() => setPickupCount({ ...pickupCount, [currentStop.id]: Math.max(0, count - 5) })}
                  className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 font-bold text-lg flex items-center justify-center"
                >
                  −
                </button>
                <span className="text-2xl font-display font-extrabold text-slate-900 min-w-[60px] text-center">
                  {count}
                </span>
                <button
                  onClick={() => setPickupCount({ ...pickupCount, [currentStop.id]: count + 5 })}
                  className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 font-bold text-lg flex items-center justify-center"
                >
                  +
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => onPickup(currentStop.id, count)}
                className="flex-1 bg-gradient-to-b from-green-500 to-green-600 text-white font-bold py-3.5 rounded-xl text-[13px] flex items-center justify-center gap-2 shadow-lg shadow-green-600/20 min-h-[44px] active:scale-[0.98] transition-transform"
              >
                <CheckCircle className="w-4 h-4" /> Picked Up
              </button>
              <button
                onClick={() => onSkip(currentStop.id)}
                className="px-4 py-3.5 glass border border-white/40 text-slate-500 font-bold rounded-xl text-[13px] flex items-center gap-1.5 min-h-[44px]"
              >
                <SkipForward className="w-4 h-4" /> Skip
              </button>
            </div>
          </>
        )}
      </>
    );
  }

  // ═══════ ALL STOPS DONE — Head to drop point ═══════
  if (run.status === "in_progress" && allDone) {
    return (
      <div className="text-center py-4">
        <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">All stops complete</p>
        <p className="text-xl font-display font-extrabold text-slate-900 mt-2">Head to Drop Point</p>
        {run.dropPoint && (
          <p className="text-[13px] text-slate-400 mt-1">{run.dropPoint.name}</p>
        )}
        <div className="flex gap-2 mt-4">
          {run.dropPoint && (
            <button
              onClick={() => {
                const url = `https://www.google.com/maps/dir/?api=1&destination=${run.dropPoint!.lat},${run.dropPoint!.lng}&travelmode=driving`;
                window.open(url, "_blank");
              }}
              className="flex-1 py-3 glass border border-blue-200 text-blue-600 font-bold rounded-xl text-[13px] flex items-center justify-center gap-2 min-h-[44px]"
            >
              <Navigation className="w-4 h-4" /> Navigate
            </button>
          )}
          <button
            onClick={onDeliver}
            className="flex-1 bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3 rounded-xl text-[13px] shadow-lg shadow-green-600/20 min-h-[44px] active:scale-[0.98] transition-transform"
          >
            <Truck className="w-4 h-4 inline mr-1" /> Mark Delivering
          </button>
        </div>
      </div>
    );
  }

  // ═══════ DELIVERING — Confirm drop-off ═══════
  if (run.status === "delivering") {
    const collected = run.stops.filter((s) => s.status === "picked_up");
    const totalContainers = collected.reduce((sum, s) => sum + (s.actualContainers ?? s.estimatedContainers), 0);

    return (
      <>
        <div className="mb-5">
          <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Delivering</p>
          <p className="text-xl font-display font-extrabold text-slate-900 mt-1">
            {run.dropPoint?.name || "Drop Point"}
          </p>
        </div>

        <div className="glass rounded-2xl p-4 border border-white/40 shadow-sm mb-5">
          <div className="flex justify-between items-center">
            <span className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Collected</span>
            <span className="text-slate-900 font-bold">{collected.length} of {totalStops} stops</span>
          </div>
          <div className="flex justify-between items-center mt-2">
            <span className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Containers</span>
            <span className="text-slate-900 font-bold">{totalContainers}</span>
          </div>
          <div className="flex justify-between items-center mt-2">
            <span className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Payout</span>
            <span className="text-green-600 font-display font-extrabold text-xl">
              {formatCents(totalContainers * run.perContainerCents)}
            </span>
          </div>
        </div>

        <button
          onClick={onComplete}
          className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-4 rounded-2xl text-[15px] shadow-lg shadow-green-600/20 flex items-center justify-center gap-2 min-h-[48px] active:scale-[0.98] transition-transform"
        >
          <Truck className="w-5 h-5" /> Confirm Drop-off
        </button>
      </>
    );
  }

  return null;
}
