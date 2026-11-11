"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  Sparkles,
  QrCode,
  Truck,
  Trophy,
  Flame,
  Users,
  MapPin,
  ArrowRight,
  ShieldCheck,
  Coins,
  Layers,
  Zap,
} from "lucide-react";
import { MapView, type RunCentroid } from "@/app/components/shared/map-view";
import {
  getMarketplaceOverview,
  getLeaderboard,
} from "@/lib/marketplace-api";
import {
  LEVEL_INFO,
  PRICING_TIER_INFO,
  BAG_STREAMS,
  type MarketplaceOverview,
  type LeaderboardEntry,
  type BagStream,
} from "@/lib/marketplace";
import { hasValidToken } from "@/lib/config";

interface PreviewDrop {
  id: string;
  suburb: string;
  lat: number;
  lng: number;
  containers: number;
  bags: number;
  runnerBountyCents: number;
  sorterPoolCents: number;
  tier: number;
}

const SAMPLE_PREVIEW_DROPS: PreviewDrop[] = [
  {
    id: "preview-moorooka",
    suburb: "MOOROOKA (EXAMPLE)",
    lat: -27.536,
    lng: 153.025,
    containers: 1240,
    bags: 9,
    runnerBountyCents: 3720,
    sorterPoolCents: 12400,
    tier: 4,
  },
  {
    id: "preview-yeronga",
    suburb: "YERONGA (EXAMPLE)",
    lat: -27.523,
    lng: 153.018,
    containers: 920,
    bags: 7,
    runnerBountyCents: 3000,
    sorterPoolCents: 9200,
    tier: 3,
  },
  {
    id: "preview-tarragindi",
    suburb: "TARRAGINDI (EXAMPLE)",
    lat: -27.529,
    lng: 153.046,
    containers: 1510,
    bags: 11,
    runnerBountyCents: 4530,
    sorterPoolCents: 15100,
    tier: 5,
  },
];

export default function MarketplacePage() {
  const [overview, setOverview] = useState<MarketplaceOverview | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"bounties" | "pools" | "economics" | "leaderboard">("bounties");
  const [showSamplePreview, setShowSamplePreview] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  const loadMarketplace = useCallback(async () => {
    const [ov, lb] = await Promise.all([
      getMarketplaceOverview(),
      getLeaderboard("all", 10),
    ]);
    setOverview(ov);
    setLeaderboard(lb);
    setLoading(false);
  }, []);

  useEffect(() => {
    setSignedIn(hasValidToken());
    loadMarketplace();
    const timer = setInterval(loadMarketplace, 25000);
    return () => clearInterval(timer);
  }, [loadMarketplace]);

  const liveCentroids = useMemo<RunCentroid[]>(() => {
    const pins: RunCentroid[] = [];
    if (overview) {
      for (const r of overview.availableRuns) {
        pins.push({
          id: `run-${r.id}`,
          lat: r.centroidLat,
          lng: r.centroidLng,
          label: `${r.areaName} · $${(r.estimatedPayoutCents / 100).toFixed(0)}`,
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
    }
    if (pins.length === 0 && showSamplePreview) {
      return SAMPLE_PREVIEW_DROPS.map((d) => ({
        id: d.id,
        lat: d.lat,
        lng: d.lng,
        label: d.suburb,
        containers: d.containers,
        pricingTier: d.tier,
      }));
    }
    return pins;
  }, [overview, showSamplePreview]);

  const noop = useCallback(() => {}, []);

  const hasLiveDrops =
    (overview?.availableRuns.length ?? 0) > 0 || (overview?.suburbPools.length ?? 0) > 0;

  return (
    <div className="min-h-dvh bg-slate-950 text-white">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link href={signedIn ? "/sort" : "/"} className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-emerald-500 text-slate-950 font-black text-sm flex items-center justify-center shadow-lg shadow-emerald-500/25">
              GS
            </span>
            <div>
              <span className="font-display font-extrabold text-sm tracking-tight block leading-none">
                The Good Sort Marketplace
              </span>
              <span className="text-[11px] text-emerald-400 font-semibold">
                Sorters &amp; Runners · Brisbane
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <Link
              href="/bags"
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition-colors flex items-center gap-1.5"
            >
              <QrCode size={14} />
              <span className="hidden sm:inline">QR Bag Tags</span>
              <span className="sm:hidden">Bags</span>
            </Link>
            <Link
              href="/scan"
              className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold transition-colors"
            >
              Scan Cans
            </Link>
            <Link
              href={signedIn ? "/runner" : "/runner/signup"}
              className="px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold transition-colors"
            >
              Run Drops
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Hero Banner */}
        <section className="rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-emerald-950/80 via-slate-900 to-slate-950 p-6 sm:p-8 shadow-2xl">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-xs font-bold">
              <Sparkles size={13} /> Two-Sided Container Marketplace
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-400/30 text-amber-300 text-xs font-bold">
              {overview?.crpActive
                ? "LIVE: 17.68¢ COEX CRP Rate Active"
                : "Building to Full-Scale 17.68¢ COEX Secondary-Sorted CRP"}
            </span>
          </div>

          <h1 className="font-display font-black text-2xl sm:text-4xl tracking-tight text-white max-w-3xl leading-tight">
            Turn Brisbane&apos;s drink containers into real street bounties.
          </h1>
          <p className="text-slate-300 text-sm sm:text-base mt-2 max-w-2xl leading-relaxed">
            <strong>Sorters</strong> scan &amp; pre-sort containers at home into 4 QR-tagged bags. When a suburb pool hits{" "}
            <strong>1,000 containers</strong>, a bounty drop spawns on the map for local <strong>Runners</strong> to collect and cash in.
          </p>

          {/* Two Role Cards: Sorters vs Runners */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            {/* Sorter Class Card */}
            <div className="rounded-2xl bg-slate-900/90 border border-emerald-500/30 p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-400">
                    Role 1 · Home Sorter
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-black">
                    {overview?.crpActive ? "10¢ / can" : "10¢ first 200 · 5¢ base"}
                  </span>
                </div>
                <h2 className="font-display font-extrabold text-xl text-white">
                  Scan, Bag &amp; Build Your Container Mafia
                </h2>
                <ul className="mt-3 space-y-1.5 text-xs text-slate-300">
                  <li className="flex items-start gap-2">
                    <QrCode size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                    <span>Seal 4-stream QR bag tags (Aluminium, Clear PET, Coloured, Glass) for 5-second kerbside pickup.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Users size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                    <span>Recruit neighbours into your <strong>Container Mafia</strong>: earn $1 signup + <strong>1¢/can</strong> override on every pickup.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Coins size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                    <span>Target <strong>10¢/can uncapped</strong> once COEX Secondary-Sorted CRP approval is live · Cash out via PayID or BSB.</span>
                  </li>
                </ul>
              </div>
              <div className="flex flex-wrap gap-2 mt-5">
                <Link
                  href="/scan"
                  className="flex-1 min-w-[140px] py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs text-center flex items-center justify-center gap-1.5 transition-colors"
                >
                  Start Sorting <ArrowRight size={14} />
                </Link>
                <Link
                  href="/bags"
                  className="py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs text-center flex items-center justify-center gap-1.5 transition-colors"
                >
                  <QrCode size={14} /> Print / Seal QR Bags
                </Link>
              </div>
            </div>

            {/* Runner Class Card */}
            <div className="rounded-2xl bg-slate-900/90 border border-amber-400/30 p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
                    Role 2 · Suburb Runner
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 text-xs font-black">
                    3¢–5¢ / can · $30–$60+ / run
                  </span>
                </div>
                <h2 className="font-display font-extrabold text-xl text-white">
                  Claim Suburb Drops, Scan QR Bags &amp; Get Paid
                </h2>
                <ul className="mt-3 space-y-1.5 text-xs text-slate-300">
                  <li className="flex items-start gap-2">
                    <Truck size={14} className="text-amber-400 shrink-0 mt-0.5" />
                    <span>Claim dense single-suburb runs (car, ute, or cargo bike) with optimised OSRM stop order.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Zap size={14} className="text-amber-400 shrink-0 mt-0.5" />
                    <span>Scan household QR bag tags at the kerb, flag any mixed/contaminated bags, and drop straight at the CRP depot.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Flame size={14} className="text-amber-400 shrink-0 mt-0.5" />
                    <span>Level up Bronze → Platinum (+1¢ to +2¢/can bonus), build daily streaks, and withdraw via PayID or ABA.</span>
                  </li>
                </ul>
              </div>
              <div className="flex flex-wrap gap-2 mt-5">
                <Link
                  href={signedIn ? "/runner" : "/runner/signup"}
                  className="flex-1 min-w-[140px] py-2.5 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs text-center flex items-center justify-center gap-1.5 transition-colors"
                >
                  {signedIn ? "Open Runner Radar" : "Register as Runner"} <ArrowRight size={14} />
                </Link>
                <button
                  type="button"
                  onClick={() => setActiveTab("leaderboard")}
                  className="py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs text-center flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Trophy size={14} /> Leaderboard
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* LiveBrisbane Radar Map + Stats Strip */}
        <section className="rounded-3xl border border-white/10 bg-slate-900 overflow-hidden shadow-xl">
          <div className="p-4 sm:px-6 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <h2 className="font-display font-bold text-base text-white">
                  Brisbane Suburb Bounty Radar
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {hasLiveDrops
                  ? `${overview?.stats.availableRunsCount ?? 0} claimable runs · ${overview?.stats.formingSuburbsCount ?? 0} suburb pools building toward 1,000 cans`
                  : "0 active drops right now — scan containers in your suburb to spawn Run #1 (suburb pins rounded to ~1.1km for privacy)"}
              </p>
            </div>

            {!hasLiveDrops && (
              <button
                type="button"
                onClick={() => setShowSamplePreview((v) => !v)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                  showSamplePreview
                    ? "bg-amber-400/20 border-amber-400/50 text-amber-300"
                    : "bg-white/5 border-white/15 text-slate-300 hover:bg-white/10"
                }`}
              >
                {showSamplePreview ? "Hide Example Drops" : "Preview Example Suburb Drops"}
              </button>
            )}
          </div>

          <div className="relative h-72 sm:h-80 w-full">
            <MapView
              mode="collect"
              bins={[]}
              depot={null}
              onMapTap={noop}
              runCentroids={liveCentroids}
            />
            {showSamplePreview && !hasLiveDrops && (
              <div className="absolute top-3 left-3 z-20 px-3 py-1.5 rounded-xl bg-slate-950/90 border border-amber-400/40 text-[11px] font-bold text-amber-300">
                Illustrative Example Pins — Real runs spawn automatically at 1,000 suburb cans
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/10 bg-slate-950/60">
            <div className="p-3.5 text-center">
              <p className="text-[11px] text-slate-400 uppercase font-bold">Claimable Runs</p>
              <p className="font-display font-black text-xl text-emerald-400 mt-0.5">
                {loading ? "—" : overview?.stats.availableRunsCount ?? 0}
              </p>
            </div>
            <div className="p-3.5 text-center">
              <p className="text-[11px] text-slate-400 uppercase font-bold">Forming Suburbs</p>
              <p className="font-display font-black text-xl text-white mt-0.5">
                {loading ? "—" : overview?.stats.formingSuburbsCount ?? 0}
              </p>
            </div>
            <div className="p-3.5 text-center">
              <p className="text-[11px] text-slate-400 uppercase font-bold">QR Bags On Kerb</p>
              <p className="font-display font-black text-xl text-amber-400 mt-0.5">
                {loading ? "—" : overview?.stats.bagsOnKerb ?? 0}
              </p>
            </div>
            <div className="p-3.5 text-center">
              <p className="text-[11px] text-slate-400 uppercase font-bold">Registered Runners</p>
              <p className="font-display font-black text-xl text-sky-400 mt-0.5">
                {loading ? "—" : overview?.stats.registeredRunners ?? 0}
              </p>
            </div>
          </div>
        </section>

        {/* Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[
            { id: "bounties", label: `Run Bounties (${overview?.availableRuns.length ?? 0})` },
            { id: "pools", label: `Suburb Pools (${overview?.suburbPools.length ?? 0})` },
            { id: "economics", label: "4-Stream & 17.68¢ CRP Split" },
            { id: "leaderboard", label: "Runner Leaderboard" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id as typeof activeTab)}
              className={`px-4 py-2 rounded-xl text-xs font-extrabold whitespace-nowrap transition-colors ${
                activeTab === t.id
                  ? "bg-emerald-500 text-slate-950"
                  : "bg-slate-900 text-slate-300 border border-white/10 hover:bg-slate-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab 1: Active Run Bounties */}
        {activeTab === "bounties" && (
          <section className="space-y-3">
            {(overview?.availableRuns.length ?? 0) === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-slate-900 p-6 text-center">
                <Truck size={32} className="text-amber-400 mx-auto mb-2" />
                <h3 className="font-display font-bold text-base text-white">
                  No unclaimed Run Bounties on the board right now
                </h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
                  Runs spawn automatically as soon as a Brisbane suburb cluster crosses 1,000 scanned containers (or Sorters flag full QR bags on kerb). Register as a Runner now to get first claim.
                </p>
                <div className="flex justify-center gap-3 mt-4">
                  <Link
                    href={signedIn ? "/runner" : "/runner/signup"}
                    className="px-4 py-2 rounded-xl bg-amber-400 text-slate-950 font-extrabold text-xs"
                  >
                    {signedIn ? "Open Runner Console" : "Register as Runner"}
                  </Link>
                  <Link
                    href="/scan"
                    className="px-4 py-2 rounded-xl bg-white/10 text-white font-bold text-xs"
                  >
                    Scan Cans as Sorter
                  </Link>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {overview!.availableRuns.map((run) => {
                  const tier = PRICING_TIER_INFO[run.pricingTier] ?? PRICING_TIER_INFO[2];
                  return (
                    <div
                      key={run.id}
                      className="rounded-2xl border border-white/10 bg-slate-900 p-4 flex items-center justify-between gap-4"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <MapPin size={15} className="text-emerald-400" />
                          <span className="font-display font-extrabold text-base text-white">
                            {run.areaName}
                          </span>
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full bg-white/10 ${tier.color}`}>
                            {tier.label}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          {run.stopCount} stops · ~{run.estimatedContainers} cans · {run.estimatedDistanceKm.toFixed(1)} km · ~{run.estimatedDurationMin} min
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-display font-black text-xl text-emerald-400">
                          ${(run.estimatedPayoutCents / 100).toFixed(2)}
                        </p>
                        <p className="text-[11px] text-slate-400">{run.perContainerCents}¢/can</p>
                        <Link
                          href={signedIn ? "/runner" : "/runner/signup"}
                          className="inline-block mt-1.5 px-3 py-1 rounded-lg bg-amber-400 text-slate-950 font-extrabold text-[11px]"
                        >
                          Claim Run
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Tab 2: Forming Suburb Pools */}
        {activeTab === "pools" && (
          <section className="space-y-3">
            {(overview?.suburbPools.length ?? 0) === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-slate-900 p-6 text-center">
                <Layers size={32} className="text-emerald-400 mx-auto mb-2" />
                <h3 className="font-display font-bold text-base text-white">
                  Be the founding Sorter in your Brisbane suburb
                </h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
                  Scan your first cans and invite 5–10 neighbours on your street. Once your suburb reaches 1,000 containers, GoodSort dispatches a Runner straight to your kerb.
                </p>
                <Link
                  href="/scan"
                  className="inline-block mt-4 px-5 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-extrabold text-xs"
                >
                  Scan First Container
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {overview!.suburbPools.map((pool) => (
                  <div
                    key={pool.suburb}
                    className="rounded-2xl border border-white/10 bg-slate-900 p-4 space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-display font-extrabold text-base text-white">
                          {pool.suburb}
                        </h3>
                        <p className="text-xs text-slate-400">
                          {pool.sortersCount} {pool.sortersCount === 1 ? "household" : "households"} · {pool.bagsSealed} QR bags sealed
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-extrabold text-amber-400 block">
                          ~${(pool.estimatedRunnerBountyCents / 100).toFixed(0)} Runner Drop
                        </span>
                        <span className="text-[11px] text-emerald-400 font-semibold">
                          {pool.progressPct}% to spawn
                        </span>
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-amber-400 rounded-full"
                        style={{ width: `${Math.max(4, pool.progressPct)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>{pool.pendingContainers.toLocaleString()} / {pool.targetContainers.toLocaleString()} cans</span>
                      <span>{pool.readyForRun ? "Ready for Runner dispatch!" : "Building density"}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Tab 3: 4-Stream & 17.68¢ COEX CRP Unit Economics */}
        {activeTab === "economics" && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-white/10 bg-slate-900 p-5 space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-extrabold uppercase">
                <ShieldCheck size={15} /> COEX Secondary-Sorted CRP Stack (SEQ)
              </div>
              <h3 className="font-display font-bold text-lg text-white">
                How every 17.68¢ container powers the Marketplace
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Under a Queensland COEX Container Collection Agreement (CCA) for Secondary-Sorted Container Refund Points, pre-sorted streams earn the <strong>10.00¢</strong> refund plus the <strong>7.68¢</strong> SEQ handling fee (<strong>17.68¢/can</strong> total):
              </p>
              <div className="space-y-2 pt-1 text-xs">
                <div className="flex justify-between p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <span className="font-bold text-emerald-300">Home Sorter (4-Stream QR Bagged)</span>
                  <span className="font-black text-emerald-300">10.00¢ / can</span>
                </div>
                <div className="flex justify-between p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20">
                  <span className="font-bold text-purple-300">Container Mafia Street Referrer</span>
                  <span className="font-black text-purple-300">1.00¢ / can</span>
                </div>
                <div className="flex justify-between p-2.5 rounded-xl bg-amber-400/10 border border-amber-400/20">
                  <span className="font-bold text-amber-300">Suburb Runner (Kerbside → CRP)</span>
                  <span className="font-black text-amber-300">3.00¢ / can</span>
                </div>
                <div className="flex justify-between p-2.5 rounded-xl bg-white/5 border border-white/10">
                  <span className="font-bold text-slate-300">GoodSort Platform, QR Tags &amp; Audit Ops</span>
                  <span className="font-black text-slate-200">3.68¢ / can</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900 p-5 space-y-3">
              <div className="flex items-center gap-2 text-sky-400 text-xs font-extrabold uppercase">
                <QrCode size={15} /> 4 Secondary-Sorted Bag Streams
              </div>
              <h3 className="font-display font-bold text-lg text-white">
                Why Sorters separate into 4 QR-tagged bags
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                {(Object.keys(BAG_STREAMS) as BagStream[]).map((key) => {
                  const s = BAG_STREAMS[key];
                  return (
                    <div key={key} className="p-3 rounded-xl bg-slate-950/70 border border-white/10">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-xs text-white">{s.shortLabel}</span>
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-white/10 text-slate-300">
                          GSB-{s.codePrefix}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-snug">{s.rule}</p>
                    </div>
                  );
                })}
              </div>
              <Link
                href="/bags"
                className="inline-flex items-center gap-1.5 text-xs font-extrabold text-emerald-400 hover:text-emerald-300 pt-1"
              >
                Open 4-Stream QR Bag Tag Generator <ArrowRight size={13} />
              </Link>
            </div>
          </section>
        )}

        {/* Tab 4: Leaderboard */}
        {activeTab === "leaderboard" && (
          <section className="rounded-2xl border border-white/10 bg-slate-900 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Trophy size={18} className="text-amber-400" />
                <h3 className="font-display font-bold text-base text-white">
                  Top Brisbane Runners
                </h3>
              </div>
              <Link
                href={signedIn ? "/runner" : "/runner/signup"}
                className="text-xs font-bold text-amber-400 hover:text-amber-300"
              >
                Join Leaderboard →
              </Link>
            </div>
            {leaderboard.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">
                Run #1 is up for grabs — complete the first Brisbane suburb run to claim Rank #1!
              </p>
            ) : (
              <div className="space-y-2">
                {leaderboard.map((entry) => {
                  const lvl = LEVEL_INFO[entry.level] ?? LEVEL_INFO.bronze;
                  return (
                    <div
                      key={entry.runnerId}
                      className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-white/5"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-6 text-center font-display font-black text-sm text-amber-400">
                          #{entry.rank}
                        </span>
                        <div>
                          <p className="font-bold text-sm text-white">{entry.name}</p>
                          <p className="text-[11px] text-slate-400">
                            {entry.totalRuns} runs · {lvl.label}
                          </p>
                        </div>
                      </div>
                      <span className="font-display font-extrabold text-sm text-emerald-400">
                        {entry.totalContainers.toLocaleString()} cans
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
