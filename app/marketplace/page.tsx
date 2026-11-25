"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  LocateFixed,
  Package,
  ScanBarcode,
  Truck,
  X,
} from "lucide-react";
import { MapView, type RunCentroid } from "@/app/components/shared/map-view";
import { getMarketplaceOverview } from "@/lib/marketplace-api";
import { formatVagueContainerBand, type MarketplaceOverview } from "@/lib/marketplace";
import { LIVE_VOLUME_THRESHOLD, titleSuburb } from "@/lib/brisbane";
import { hasValidToken } from "@/lib/config";

function suburbSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const MAP_FIT_PADDING = { top: 96, bottom: 210, left: 48, right: 48 };

export default function MarketplacePage() {
  const [overview, setOverview] = useState<MarketplaceOverview | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [isRunner, setIsRunner] = useState(false);
  const [selectedCentroidId, setSelectedCentroidId] = useState<string | null>(null);
  const [resetTrigger, setResetTrigger] = useState(0);

  const loadOverview = useCallback(async () => {
    const ov = await getMarketplaceOverview();
    setOverview(ov);
  }, []);

  useEffect(() => {
    const valid = hasValidToken();
    setSignedIn(valid);
    if (valid) {
      try {
        const stored = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
        setIsRunner(stored?.role === "driver" || stored?.role === "both");
      } catch {
        setIsRunner(false);
      }
    } else {
      setIsRunner(false);
    }
    loadOverview();
  }, [loadOverview]);

  const liveCentroids = useMemo<RunCentroid[]>(() => {
    const pins: RunCentroid[] = [];
    if (!overview) return pins;

    for (const r of overview.availableRuns) {
      pins.push({
        id: `run-${r.id}`,
        lat: r.centroidLat,
        lng: r.centroidLng,
        label: titleSuburb(r.areaName),
        containers: r.estimatedContainers,
        vagueCountLabel: formatVagueContainerBand(r.estimatedContainers),
        pricingTier: r.pricingTier,
        progressPct: 100,
      });
    }
    for (const p of overview.suburbPools) {
      const label = titleSuburb(p.suburb);
      pins.push({
        id: `pool-${p.suburb}`,
        lat: p.centroidLat,
        lng: p.centroidLng,
        label,
        containers: p.pendingContainers,
        vagueCountLabel: formatVagueContainerBand(p.pendingContainers),
        pricingTier: p.readyForRun ? 5 : Math.max(1, Math.ceil(p.progressPct / 25)),
        progressPct: p.progressPct,
        slug: suburbSlug(p.suburb),
      });
    }
    return pins;
  }, [overview]);

  const selectedCentroid = useMemo(
    () => liveCentroids.find((c) => c.id === selectedCentroidId) ?? null,
    [liveCentroids, selectedCentroidId],
  );
  const handleSelectCentroid = useCallback((c: RunCentroid) => setSelectedCentroidId(c.id), []);
  const handleMapTap = useCallback(() => setSelectedCentroidId(null), []);
  const handleRecentre = useCallback(() => {
    setSelectedCentroidId(null);
    setResetTrigger((n) => n + 1);
  }, []);

  const activeAreasCount = liveCentroids.length;

  return (
    <main
      id="suburb-map"
      className="tgs-fullscreen-map relative h-dvh w-full overflow-hidden bg-slate-100 text-slate-900 select-none"
    >
      {/* Full-bleed edge-to-edge interactive map (Google Maps app canvas) */}
      <MapView
        mode="collect"
        bins={[]}
        depot={null}
        onMapTap={handleMapTap}
        runCentroids={liveCentroids}
        disableAutoLocate
        focusedCentroidId={selectedCentroidId}
        onCentroidSelect={handleSelectCentroid}
        fitPadding={MAP_FIT_PADDING}
        resetViewTrigger={resetTrigger}
      />

      {/* Floating Google Maps Top Pill Bar */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-20 px-3"
        style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
      >
        <div className="pointer-events-auto mx-auto max-w-md flex items-center justify-between gap-2 rounded-full bg-white/95 backdrop-blur-xl border border-white shadow-[0_4px_20px_rgba(15,23,42,0.14)] px-2 py-1.5">
          <Link
            href={signedIn ? "/sort" : "/"}
            aria-label={signedIn ? "Back to dashboard" : "Back to home"}
            className="h-9 w-9 rounded-full flex items-center justify-center text-slate-700 hover:bg-slate-100 active:scale-95 transition-all shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>

          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/tgs-glass-icon.webp"
              alt=""
              aria-hidden="true"
              width={22}
              height={22}
              className="h-[22px] w-[22px] rounded-[6px] shrink-0"
            />
            <div className="min-w-0">
              <p className="text-[14px] font-display font-bold text-slate-900 leading-tight truncate">
                Brisbane
              </p>
              <p className="text-[11px] text-slate-500 leading-tight truncate">
                {activeAreasCount > 0
                  ? `${activeAreasCount} active ${activeAreasCount === 1 ? "suburb" : "suburbs"} · tap a pin`
                  : "Live suburb volume map"}
              </p>
            </div>
          </div>

          <Link
            href="/scan"
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-bold px-3.5 py-2 shadow-sm active:scale-95 transition-all shrink-0"
          >
            <ScanBarcode className="w-3.5 h-3.5" />
            Scan
          </Link>
        </div>
      </div>

      {/* Floating Google Maps Recentre FAB (right edge, cleanly above bottom sheet) */}
      <button
        type="button"
        onClick={handleRecentre}
        aria-label="Recentre Brisbane map"
        className="fixed right-3.5 bottom-[196px] z-20 h-11 w-11 rounded-full bg-white/95 backdrop-blur border border-slate-200/80 shadow-[0_4px_16px_rgba(15,23,42,0.16)] flex items-center justify-center text-slate-700 hover:text-slate-950 active:scale-95 transition-all"
      >
        <LocateFixed className="w-5 h-5" />
      </button>

      {/* Google Maps Bottom Sheet */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-0 sm:px-4 sm:pb-4"
      >
        <div
          className="pointer-events-auto mx-auto max-w-md rounded-t-[26px] sm:rounded-[26px] bg-white/97 backdrop-blur-xl border-t sm:border border-slate-200/80 shadow-[0_-8px_32px_rgba(15,23,42,0.14)] px-5 pt-2.5"
          style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
        >
          {/* Grab handle */}
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" />

          {selectedCentroid ? (
            <div>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <h1 className="text-[19px] font-display font-bold text-slate-900 leading-tight truncate">
                    {selectedCentroid.label}
                  </h1>
                  <p className="text-[12px] text-slate-600 mt-0.5">
                    Area volume:{" "}
                    <strong className="text-emerald-700">
                      {selectedCentroid.vagueCountLabel}
                    </strong>
                    {typeof selectedCentroid.progressPct === "number"
                      ? ` · ${selectedCentroid.progressPct}% of ${LIVE_VOLUME_THRESHOLD.toLocaleString()}-can run`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCentroidId(null)}
                  aria-label="Close suburb details"
                  className="h-8 w-8 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 flex items-center justify-center shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {typeof selectedCentroid.progressPct === "number" && (
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mb-3.5">
                  <div
                    className="h-full rounded-full bg-emerald-600 transition-all"
                    style={{
                      width: `${Math.max(selectedCentroid.progressPct, selectedCentroid.containers > 0 ? 4 : 0)}%`,
                    }}
                  />
                </div>
              )}

              <div className="flex items-center gap-2">
                {selectedCentroid.slug && (
                  <Link
                    href={`/brisbane/${selectedCentroid.slug}`}
                    className="flex-1 inline-flex items-center justify-center rounded-full bg-slate-900 hover:bg-slate-800 text-white text-[13px] font-bold py-2.5 px-4 transition-colors"
                  >
                    Open suburb
                  </Link>
                )}
                <Link
                  href="/scan"
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-bold py-2.5 px-4 transition-colors"
                >
                  <ScanBarcode className="w-4 h-4" />
                  Scan cans
                </Link>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-baseline justify-between gap-2 mb-3">
                <h1 className="text-[17px] font-display font-bold text-slate-900">
                  Brisbane container volume
                </h1>
                <span className="text-[11px] font-semibold text-emerald-700">
                  ~1 km privacy radius
                </span>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <Link
                  href="/scan"
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-bold py-2.5 px-3.5 shadow-sm transition-colors"
                >
                  <ScanBarcode className="w-4 h-4" />
                  Scan
                </Link>
                <Link
                  href="/bags"
                  className="inline-flex items-center justify-center gap-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-800 text-[13px] font-semibold py-2.5 px-3.5 transition-colors"
                >
                  <Package className="w-4 h-4" />
                  Bags
                </Link>
                <Link
                  href={isRunner ? "/runner" : "/runner/signup"}
                  className="inline-flex items-center justify-center gap-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-800 text-[13px] font-semibold py-2.5 px-3.5 transition-colors"
                >
                  <Truck className="w-4 h-4" />
                  Drive
                </Link>
              </div>

              <p className="text-[10px] text-slate-400 leading-snug">
                Tap any area bubble for suburb progress toward a {LIVE_VOLUME_THRESHOLD.toLocaleString()}-can pickup. Private sorting credit — not a Containers for Change refund point.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
