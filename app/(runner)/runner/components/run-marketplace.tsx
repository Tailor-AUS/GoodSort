"use client";

import { Package, Clock, MapPin, Zap } from "lucide-react";
import { formatCents } from "@/lib/store";
import type { MarketplaceRun } from "@/lib/marketplace";
import { PRICING_TIER_INFO } from "@/lib/marketplace";

interface RunMarketplaceProps {
  runs: MarketplaceRun[];
  onClaim: (runId: string) => void;
  loading?: boolean;
}

export function RunMarketplace({ runs, onClaim, loading }: RunMarketplaceProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="glass rounded-2xl p-4 border border-white/40 shadow-sm animate-pulse">
            <div className="h-5 bg-slate-200 rounded w-1/3 mb-3" />
            <div className="h-4 bg-slate-100 rounded w-2/3 mb-2" />
            <div className="h-10 bg-slate-100 rounded-xl" />
          </div>
        ))}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="glass rounded-2xl p-6 border border-white/40 shadow-sm text-center">
        <Package className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-slate-500 text-[13px] font-medium">No runs available nearby</p>
        <p className="text-slate-400 text-[11px] mt-1">Runs appear when bins reach 50+ containers</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {runs.map((run) => {
        const tier = PRICING_TIER_INFO[run.pricingTier] || PRICING_TIER_INFO[1];
        return (
          <div key={run.id} className="glass rounded-2xl p-4 border border-white/40 shadow-sm">
            <div className="flex justify-between items-start mb-2">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[15px] text-slate-900 font-semibold">{run.areaName}</p>
                  {run.pricingTier >= 4 && (
                    <span className="flex items-center gap-0.5 text-[10px] font-bold text-amber-600 bg-amber-50 rounded-full px-1.5 py-0.5">
                      <Zap className="w-3 h-3" />{tier.label}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="flex items-center gap-1 text-[12px] text-slate-400">
                    <Package className="w-3 h-3" />{run.estimatedContainers}
                  </span>
                  <span className="flex items-center gap-1 text-[12px] text-slate-400">
                    <MapPin className="w-3 h-3" />{run.stopCount} stops
                  </span>
                  <span className="flex items-center gap-1 text-[12px] text-slate-400">
                    <Clock className="w-3 h-3" />~{run.estimatedDurationMin}min
                  </span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-green-600 font-display font-extrabold text-[17px]">
                  {formatCents(run.estimatedPayoutCents)}
                </p>
                <p className={`text-[11px] font-bold ${tier.color}`}>
                  {run.perContainerCents}c/container
                </p>
              </div>
            </div>

            {/* Distance + route estimate */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[11px] text-slate-400">{run.distanceKm.toFixed(1)}km away</span>
              <span className="text-[11px] text-slate-300">·</span>
              <span className="text-[11px] text-slate-400">{run.estimatedDistanceKm.toFixed(1)}km route</span>
            </div>

            <button
              onClick={() => onClaim(run.id)}
              className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-bold py-3 rounded-xl text-[13px] shadow-lg shadow-green-600/20 min-h-[44px] active:scale-[0.98] transition-transform"
            >
              Claim Run · {formatCents(run.estimatedPayoutCents)}
            </button>
          </div>
        );
      })}
    </div>
  );
}
