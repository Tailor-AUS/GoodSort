"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronRight,
  Info,
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
import { track } from "@/lib/analytics";

function suburbSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const MAP_FIT_PADDING = { top: 96, bottom: 188, left: 48, right: 48 };

export default function MarketplacePage() {
  const [overview, setOverview] = useState<MarketplaceOverview | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [isRunner, setIsRunner] = useState(false);
  const [selectedCentroidId, setSelectedCentroidId] = useState<string | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [resetTrigger, setResetTrigger] = useState(0);
  const touchStartYRef = useRef<number | null>(null);

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
    track("map_viewed");
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

  const sortedCentroids = useMemo(
    () => [...liveCentroids].sort((a, b) => b.containers - a.containers || a.label.localeCompare(b.label)),
    [liveCentroids],
  );

  const selectedCentroid = useMemo(
    () => liveCentroids.find((c) => c.id === selectedCentroidId) ?? null,
    [liveCentroids, selectedCentroidId],
  );

  const handleSelectCentroid = useCallback((c: RunCentroid) => {
    setSelectedCentroidId(c.id);
    setSheetExpanded(false);
    setShowInfo(false);
  }, []);

  const handleMapTap = useCallback(() => {
    setSelectedCentroidId(null);
    setSheetExpanded(false);
    setShowInfo(false);
  }, []);

  const handleRecentre = useCallback(() => {
    setSelectedCentroidId(null);
    setSheetExpanded(false);
    setShowInfo(false);
    setResetTrigger((n) => n + 1);
  }, []);

  const handleSheetTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  };

  const handleSheetTouchEnd = (e: React.TouchEvent) => {
    const startY = touchStartYRef.current;
    const endY = e.changedTouches[0]?.clientY ?? null;
    touchStartYRef.current = null;
    if (startY == null || endY == null) return;
    const delta = startY - endY;
    if (delta > 28) {
      setSelectedCentroidId(null);
      setSheetExpanded(true);
    } else if (delta < -28) {
      setSheetExpanded(false);
      setSelectedCentroidId(null);
    }
  };

  const activeAreasCount = liveCentroids.length;

  return (
    <main
      id="suburb-map"
      className="tgs-fullscreen-map relative h-dvh w-full overflow-hidden bg-slate-100 text-slate-900 select-none"
    >
      {/* Full-bleed edge-to-edge interactive map */}
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

      {/* Floating Apple Maps Top Pill Bar */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-20 px-3"
        style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
      >
        <div className="pointer-events-auto mx-auto max-w-md flex items-center justify-between gap-2 rounded-full liquid-glass-light px-2 py-1.5">
          <Link
            href={signedIn ? "/sort" : "/"}
            aria-label={signedIn ? "Back to dashboard" : "Back to home"}
            className="h-10 w-10 rounded-full flex items-center justify-center text-slate-800 hover:bg-slate-100 active:scale-95 transition-all shrink-0"
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
                  ? `${activeAreasCount} active ${activeAreasCount === 1 ? "suburb" : "suburbs"}`
                  : "Live suburb volume"}
              </p>
            </div>
          </div>

          <Link
            href="/scan"
            className="inline-flex items-center justify-center gap-1.5 min-h-[40px] rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-bold px-4 py-2 shadow-sm active:scale-95 transition-all shrink-0"
          >
            <ScanBarcode className="w-3.5 h-3.5" />
            Scan
          </Link>
        </div>
      </div>

      {/* Floating Recentre FAB (hidden softly while bottom sheet is expanded) */}
      <button
        type="button"
        onClick={handleRecentre}
        aria-label="Recentre Brisbane map"
        className={`fixed right-3.5 bottom-[166px] z-20 h-11 w-11 rounded-full liquid-glass-light flex items-center justify-center text-slate-800 hover:text-slate-950 active:scale-95 transition-all duration-200 ${
          sheetExpanded ? "opacity-0 pointer-events-none translate-y-2" : "opacity-100"
        }`}
      >
        <LocateFixed className="w-5 h-5" />
      </button>

      {/* Apple Maps Interactive Bottom Sheet */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-0 sm:px-4 sm:pb-4">
        <div
          onTouchStart={handleSheetTouchStart}
          onTouchEnd={handleSheetTouchEnd}
          className="pointer-events-auto mx-auto max-w-md rounded-t-[26px] sm:rounded-[26px] liquid-glass-light px-5 pt-1 transition-all duration-300"
          style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
        >
          {/* Real interactive grab handle — tap or swipe up/down */}
          <button
            type="button"
            onClick={() => {
              if (selectedCentroid) {
                setSelectedCentroidId(null);
                setSheetExpanded(true);
              } else {
                setSheetExpanded((v) => !v);
              }
            }}
            aria-label={sheetExpanded ? "Collapse suburb list" : "Expand suburb list"}
            aria-expanded={sheetExpanded}
            className="w-full py-2.5 flex items-center justify-center cursor-grab active:cursor-grabbing"
          >
            <span className="h-1 w-10 rounded-full bg-slate-300/90" />
          </button>

          {selectedCentroid ? (
            <div>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <h1 className="text-[19px] font-display font-bold text-slate-900 leading-tight truncate tracking-[-0.02em]">
                    {selectedCentroid.label}
                  </h1>
                  <p className="text-[13px] text-slate-600 mt-0.5">
                    <strong className="text-emerald-700 font-semibold">
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
                  className="h-10 w-10 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 flex items-center justify-center shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {typeof selectedCentroid.progressPct === "number" && (
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mb-4">
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
                    className="flex-1 min-h-[44px] inline-flex items-center justify-center rounded-full bg-slate-900 hover:bg-slate-800 text-white text-[13px] font-bold py-2.5 px-4 transition-colors"
                  >
                    Open suburb
                  </Link>
                )}
                <Link
                  href="/scan"
                  className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-bold py-2.5 px-4 transition-colors"
                >
                  <ScanBarcode className="w-4 h-4" />
                  Scan cans
                </Link>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <h1 className="text-[18px] font-display font-bold text-slate-900 leading-tight tracking-[-0.02em]">
                    Brisbane volume
                  </h1>
                  <p className="text-[12px] text-slate-500 mt-0.5">
                    ~1 km privacy radius · swipe up for suburbs
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInfo((v) => !v)}
                  aria-label="About map privacy and sorting credits"
                  aria-expanded={showInfo}
                  className="h-10 w-10 rounded-full bg-slate-100/90 text-slate-500 hover:text-slate-800 flex items-center justify-center shrink-0 transition-colors"
                >
                  <Info className="w-4 h-4" />
                </button>
              </div>

              {showInfo && (
                <p className="mb-3 rounded-2xl bg-slate-50 border border-slate-200/80 px-3.5 py-2.5 text-[11px] text-slate-600 leading-relaxed">
                  Suburb totals are approximate inside a ~1 km radius so home addresses stay private. About{" "}
                  {LIVE_VOLUME_THRESHOLD.toLocaleString()} containers unlocks a local driver run. Private sorting credit — not a Containers for Change refund point.
                </p>
              )}

              <div className="flex items-center gap-2">
                <Link
                  href="/scan"
                  className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-[14px] font-bold py-2.5 px-4 shadow-sm active:scale-[0.98] transition-all"
                >
                  <ScanBarcode className="w-4 h-4" />
                  Scan
                </Link>
                <Link
                  href="/bags"
                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-900 text-[14px] font-semibold py-2.5 px-5 active:scale-[0.98] transition-all"
                >
                  <Package className="w-4 h-4" />
                  Bags
                </Link>
              </div>

              {sheetExpanded && (
                <div className="mt-4 pt-3.5 border-t border-slate-100 max-h-[42dvh] overflow-y-auto space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                    Active suburbs
                  </p>
                  {sortedCentroids.length === 0 ? (
                    <p className="text-[13px] text-slate-500 py-2">
                      Scan your first container to start a suburb pool.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {sortedCentroids.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handleSelectCentroid(c)}
                          className="w-full min-h-[48px] rounded-2xl bg-slate-50 hover:bg-slate-100 px-3.5 py-2.5 flex items-center justify-between gap-3 text-left transition-colors"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                                c.pricingTier >= 5 ? "bg-emerald-500" : "bg-slate-900"
                              }`}
                            />
                            <div className="min-w-0">
                              <p className="text-[14px] font-semibold text-slate-900 truncate">
                                {c.label}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {c.vagueCountLabel}
                                {typeof c.progressPct === "number" ? ` · ${c.progressPct}%` : ""}
                              </p>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="pt-2 border-t border-slate-100">
                    <Link
                      href={isRunner ? "/runner" : "/runner/signup"}
                      className="w-full min-h-[44px] flex items-center justify-between px-2 text-[13px] font-semibold text-slate-600 hover:text-slate-900"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Truck className="w-4 h-4 text-slate-500" />
                        {isRunner ? "Open Driver Console" : "Drive local pickup runs"}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
