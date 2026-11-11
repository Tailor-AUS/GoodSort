"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Home,
  Recycle,
  Banknote,
  QrCode,
  Truck,
  MapPin,
} from "lucide-react";
import { Logo } from "@/app/components/shared/logo";
import { MapView, type RunCentroid } from "@/app/components/shared/map-view";
import { SuburbFinder } from "@/app/components/marketing/suburb-finder";
import { DensityBoard } from "@/app/components/marketing/density-board";
import { getMarketplaceOverview } from "@/lib/marketplace-api";
import { type MarketplaceOverview } from "@/lib/marketplace";
import { LAUNCH_BONUS_CONTAINERS, launchBonusHeadline } from "@/lib/credit";
import { LIVE_VOLUME_THRESHOLD } from "@/lib/brisbane";
import { hasValidToken } from "@/lib/config";

export default function MarketplacePage() {
  const [overview, setOverview] = useState<MarketplaceOverview | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [isRunner, setIsRunner] = useState(false);

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
        label: r.areaName,
        containers: r.estimatedContainers,
        pricingTier: r.pricingTier,
      });
    }
    for (const p of overview.suburbPools) {
      pins.push({
        id: `pool-${p.suburb}`,
        lat: p.centroidLat,
        lng: p.centroidLng,
        label: p.suburb,
        containers: p.pendingContainers,
        pricingTier: p.readyForRun ? 5 : Math.max(1, Math.ceil(p.progressPct / 25)),
      });
    }
    return pins;
  }, [overview]);

  const noop = useCallback(() => {}, []);
  const bonusCap = overview?.rateCard?.launchBonusCap ?? LAUNCH_BONUS_CONTAINERS;
  const bonusText = launchBonusHeadline(bonusCap);

  return (
    <div
      className="min-h-dvh bg-white text-slate-900 overflow-y-auto overscroll-none"
      style={{ paddingTop: "env(safe-area-inset-top,0)" }}
    >
      {/* Clean Header */}
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="max-w-4xl mx-auto px-5 py-3.5 flex items-center justify-between gap-3">
          <Link href={signedIn ? "/sort" : "/"} aria-label="The Good Sort home">
            <Logo size="sm" />
          </Link>
          <div className="flex items-center gap-2">
            {signedIn && (
              <Link
                href="/sort"
                className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
              >
                My home
              </Link>
            )}
            <Link
              href="/scan"
              className="px-4 py-2 rounded-xl bg-gradient-to-b from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white text-xs font-extrabold transition-all flex items-center gap-1"
            >
              Scan to earn <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero (<= 3 elements: Headline, 1 plain sentence, Primary CTA) */}
      <section className="px-5 py-12 sm:py-16 bg-gradient-to-br from-white via-violet-50/70 to-emerald-50/70 border-b border-slate-100">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-[36px] sm:text-[52px] leading-[1.02] font-display font-extrabold text-slate-950 mb-4">
            Scan at home. Earn from every can.
          </h1>
          <p className="text-slate-600 text-[16px] sm:text-[18px] leading-relaxed mb-6 max-w-xl mx-auto">
            Point your phone at drink cans and bottles for 10¢ each, keep 4 bags at home, and skip the depot — we collect from your front kerb once your Brisbane suburb hits {LIVE_VOLUME_THRESHOLD.toLocaleString()} containers.
          </p>
          <div className="max-w-xs mx-auto">
            <Link
              href="/scan"
              className="w-full bg-gradient-to-b from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-extrabold py-4 px-6 rounded-2xl text-[16px] min-h-[52px] flex items-center justify-center gap-1.5 shadow-lg shadow-green-600/20 active:scale-[0.98] transition-all"
            >
              Scan a container <ChevronRight className="w-5 h-5" />
            </Link>
            {bonusText && (
              <p className="mt-3 text-[12px] font-semibold text-violet-800">
                {bonusText}
              </p>
            )}
          </div>
        </div>
      </section>

      <main className="max-w-4xl mx-auto px-5 py-10 space-y-12">
        {/* Simple 3-step domestic home flow */}
        <section>
          <h2 className="text-center text-[12px] text-slate-400 font-semibold uppercase tracking-[0.15em] mb-6">
            How Brisbane homes earn
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="w-10 h-10 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center mb-3">
                <Home className="w-5 h-5" />
              </div>
              <h3 className="font-display font-bold text-[15px] text-slate-900 mb-1">
                1. Scan in your kitchen
              </h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">
                Snap a quick photo or barcode before tossing a drink container in a bag. 10¢ pending credit straight away — plus 1¢/can when neighbours you invite scan.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-3">
                <Recycle className="w-5 h-5" />
              </div>
              <h3 className="font-display font-bold text-[15px] text-slate-900 mb-1">
                2. Fill your 4 home bags
              </h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">
                Keep cans, clear plastic, coloured plastic, and glass separate in your own bags.{" "}
                <Link href="/bags" className="font-semibold text-emerald-700 underline">
                  Tag full bags
                </Link>{" "}
                with a QR sticker or marker code.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center mb-3">
                <Banknote className="w-5 h-5" />
              </div>
              <h3 className="font-display font-bold text-[15px] text-slate-900 mb-1">
                3. Kerb pickup &amp; payout
              </h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">
                At ~{LIVE_VOLUME_THRESHOLD.toLocaleString()} containers in your suburb, a local driver collects from your kerb. Credits clear after pickup to PayID or bank transfer ($20 min).
              </p>
            </div>
          </div>
        </section>

        {/* Check Your Suburb + Live Brisbane Map */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-5">
            <h2 className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.15em] mb-3">
              Check your Brisbane suburb
            </h2>
            <SuburbFinder />
            <DensityBoard />
          </div>

          <div className="lg:col-span-7 rounded-2xl border border-slate-200 overflow-hidden bg-slate-50 shadow-sm">
            <div className="px-4 py-3 bg-white border-b border-slate-100 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-600" />
                <span className="text-[13px] font-bold text-slate-900">
                  Brisbane Suburb Map
                </span>
              </div>
              <Link
                href="/bags"
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-violet-700 hover:text-violet-900"
              >
                <QrCode className="w-3.5 h-3.5" />
                Home bag tags
              </Link>
            </div>
            <div className="relative h-72 sm:h-80 w-full">
              <MapView
                mode="collect"
                bins={[]}
                depot={null}
                onMapTap={noop}
                runCentroids={liveCentroids}
              />
            </div>
            <p className="px-4 py-2.5 text-[11px] text-slate-500 bg-white border-t border-slate-100">
              Suburb pins show neighbourhood progress toward a {LIVE_VOLUME_THRESHOLD.toLocaleString()}-container pickup run (rounded to ~1 km so individual homes stay private).
            </p>
          </div>
        </section>

        {/* Quiet local driver note at bottom */}
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-700 shrink-0 mt-0.5">
              <Truck className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[14px] font-bold text-slate-900">
                Have a ute, van, or car in Brisbane?
              </p>
              <p className="text-[12px] text-slate-500">
                Collect bagged containers from streets near you once a suburb unlocks a pickup run.
              </p>
            </div>
          </div>
          <Link
            href={isRunner ? "/runner" : "/runner/signup"}
            className="px-4 py-2.5 rounded-xl bg-white border border-slate-300 hover:border-slate-400 text-slate-800 font-bold text-xs whitespace-nowrap text-center transition-colors"
          >
            {isRunner ? "Open driver view →" : "Drive a suburb run →"}
          </Link>
        </section>
      </main>

      <footer className="px-5 py-8 text-center border-t border-slate-100">
        <div className="flex justify-center mb-3">
          <Logo size="sm" />
        </div>
        <p className="text-[11px] text-slate-400 max-w-lg mx-auto">
          Not a live city-wide pickup. Sorting credits are a private reward, not the 10¢ Containers for Change refund.
        </p>
        <div className="flex justify-center gap-4 mt-2">
          <Link href="/" className="text-[11px] text-slate-400 hover:text-slate-600 transition-colors">
            Home
          </Link>
          <Link href="/brisbane" className="text-[11px] text-slate-400 hover:text-slate-600 transition-colors">
            Brisbane suburbs
          </Link>
          <Link href="/terms" className="text-[11px] text-slate-400 hover:text-slate-600 transition-colors">
            Terms
          </Link>
          <Link href="/privacy" className="text-[11px] text-slate-400 hover:text-slate-600 transition-colors">
            Privacy
          </Link>
        </div>
      </footer>
    </div>
  );
}
