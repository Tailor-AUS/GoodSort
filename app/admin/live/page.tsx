"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Eye,
  Home,
  Mail,
  MousePointerClick,
  Package,
  Pause,
  Play,
  Radio,
  RefreshCw,
  ScanLine,
  Sparkles,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import { apiUrl } from "@/lib/config";
import { titleSuburb } from "@/lib/brisbane";

type WindowMinutes = 15 | 60 | 360 | 1440;
type StreamFilter = "all" | "people" | "scanner" | "pages" | "errors";
type MobileTab = "stream" | "testers" | "funnel";

interface LivePulse {
  eventsLast15m: number;
  interactionsLast5m: number;
  pageViews: number;
  ctaTaps: number;
  otpsSent: number;
  otpsVerified: number;
  newSignups: number;
  cameraOpens: number;
  cameraDenied: number;
  scansCaptured: number;
  visionCalls: number;
  visionSucceeded: number;
  visionFailed: number;
  avgVisionMs: number;
  scansCredited: number;
  householdsCreated: number;
  bagsTagged: number;
}

interface LiveStreamItem {
  id: string;
  kind: "page" | "cta" | "otp" | "signup" | "camera" | "vision" | "scan" | "household" | "bag" | "cashout" | "error";
  severity: "info" | "success" | "warn" | "error";
  timestamp: string;
  actor: string;
  userId: string | null;
  suburb: string | null;
  path: string | null;
  title: string;
  detail: string;
}

interface TesterJourney {
  key: string;
  userId: string | null;
  email: string | null;
  name: string;
  suburb: string | null;
  status: "activated" | "scanned_no_address" | "address_no_scan" | "verified_no_scan" | "otp_pending";
  milestones: {
    otpSent: boolean;
    otpVerified: boolean;
    scanned: boolean;
    hasAddress: boolean;
    hasPayout: boolean;
    hasBag: boolean;
  };
  otpAttempts: number;
  scansCount: number;
  pendingCents: number;
  visionCalls: number;
  visionErrors: number;
  createdAt: string;
  lastSeenAt: string;
  recentSteps: Array<{ timestamp: string; label: string; tone: "ok" | "info" | "warn" | "err" }>;
}

interface LiveFeedResponse {
  serverTimeUtc: string;
  windowMinutes: number;
  pulse: LivePulse;
  funnel: Array<{ key: string; label: string; count: number }>;
  topSuburbs: Array<{ suburb: string; events: number }>;
  testers: TesterJourney[];
  stream: LiveStreamItem[];
}

const POLL_INTERVAL_MS = 3000;

function formatBrisbaneClock(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Brisbane",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function formatAge(iso: string, nowMs: number): string {
  const diffSec = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function playSoftPing() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
    setTimeout(() => { void ctx.close().catch(() => {}); }, 300);
  } catch {
    /* audio optional */
  }
}

function statusPill(status: TesterJourney["status"]) {
  switch (status) {
    case "activated":
      return { label: "Activated", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-400/30" };
    case "scanned_no_address":
      return { label: "Scanned · needs address", cls: "bg-sky-500/20 text-sky-200 border-sky-400/30" };
    case "address_no_scan":
      return { label: "Address · no scan yet", cls: "bg-indigo-500/20 text-indigo-200 border-indigo-400/30" };
    case "verified_no_scan":
      return { label: "Verified · no scan yet", cls: "bg-amber-500/20 text-amber-200 border-amber-400/30" };
    case "otp_pending":
      return { label: "Waiting for OTP", cls: "bg-violet-500/20 text-violet-200 border-violet-400/30" };
  }
}

function matchesFilter(item: LiveStreamItem, filter: StreamFilter): boolean {
  if (filter === "all") return true;
  if (filter === "people") return item.kind === "otp" || item.kind === "signup" || item.kind === "household" || item.kind === "cashout";
  if (filter === "scanner") return item.kind === "camera" || item.kind === "vision" || item.kind === "scan" || item.kind === "bag";
  if (filter === "pages") return item.kind === "page" || item.kind === "cta";
  if (filter === "errors") return item.kind === "error" || item.severity === "error" || item.severity === "warn";
  return true;
}

export default function AdminLiveRadarPage() {
  const [data, setData] = useState<LiveFeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [paused, setPaused] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [windowMinutes, setWindowMinutes] = useState<WindowMinutes>(60);
  const [filter, setFilter] = useState<StreamFilter>("all");
  const [mobileTab, setMobileTab] = useState<MobileTab>("stream");
  const [lastUpdatedMs, setLastUpdatedMs] = useState<number>(Date.now());
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const [freshIds, setFreshIds] = useState<Record<string, number>>({});

  const seenIdsRef = useRef<Set<string>>(new Set());
  const hydratedRef = useRef(false);
  const inFlightRef = useRef(false);
  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;

  const fetchFeed = useCallback(async (mins: WindowMinutes) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const token = localStorage.getItem("goodsort_token");
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(apiUrl(`/api/admin/live-feed?minutes=${mins}&limit=150`), {
        headers,
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 403) {
        setDenied(true);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setErrorMsg(`Live feed HTTP ${res.status}`);
        setLoading(false);
        return;
      }
      const next = (await res.json()) as LiveFeedResponse;
      setDenied(false);
      setErrorMsg("");

      const now = Date.now();
      const incomingFresh: Record<string, number> = {};
      let highSignalNew = false;

      if (hydratedRef.current) {
        for (const item of next.stream) {
          if (!seenIdsRef.current.has(item.id)) {
            incomingFresh[item.id] = now;
            if (item.kind === "otp" || item.kind === "signup" || item.kind === "scan" || item.kind === "vision" || item.kind === "household" || item.kind === "error") {
              highSignalNew = true;
            }
          }
        }
      }
      for (const item of next.stream) {
        seenIdsRef.current.add(item.id);
      }
      hydratedRef.current = true;

      if (Object.keys(incomingFresh).length > 0) {
        setFreshIds((prev) => {
          const merged: Record<string, number> = {};
          for (const [k, ts] of Object.entries(prev)) {
            if (now - ts < 15000) merged[k] = ts;
          }
          return { ...merged, ...incomingFresh };
        });
        if (highSignalNew && soundOnRef.current) {
          playSoftPing();
        }
      }

      setData(next);
      setLastUpdatedMs(now);
      setLoading(false);
    } catch {
      setErrorMsg("Network hiccup — retrying automatically");
      setLoading(false);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    seenIdsRef.current = new Set();
    hydratedRef.current = false;
    void fetchFeed(windowMinutes);
  }, [fetchFeed, windowMinutes]);

  useEffect(() => {
    if (paused) return;
    const poll = setInterval(() => {
      void fetchFeed(windowMinutes);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(poll);
  }, [paused, fetchFeed, windowMinutes]);

  useEffect(() => {
    const tick = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const filteredStream = useMemo(() => {
    if (!data) return [];
    return data.stream.filter((item) => matchesFilter(item, filter));
  }, [data, filter]);

  const secondsSinceUpdate = Math.max(0, Math.floor((nowTick - lastUpdatedMs) / 1000));
  const funnelMax = useMemo(() => {
    if (!data || data.funnel.length === 0) return 1;
    return Math.max(1, ...data.funnel.map((s) => s.count));
  }, [data]);

  const pulse = data?.pulse;
  const frictionCount = (pulse?.cameraDenied ?? 0) + (pulse?.visionFailed ?? 0);

  if (loading && !data) {
    return (
      <div className="min-h-dvh bg-slate-950 text-white flex items-center justify-center">
        <div className="flex items-center gap-2.5 text-sm text-slate-300">
          <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
          Connecting to live interaction radar…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100 pb-12">
      {/* Top mission-control bar */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/admin"
              aria-label="Back to admin dashboard"
              className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  {!paused && !denied && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  )}
                  <span
                    className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                      denied ? "bg-amber-400" : paused ? "bg-slate-500" : "bg-emerald-400"
                    }`}
                  />
                </span>
                <h1 className="text-base sm:text-lg font-display font-extrabold tracking-tight text-white truncate">
                  Live Interactions Radar
                </h1>
              </div>
              <p className="text-[11px] text-slate-400 tabular-nums">
                {paused ? "Paused" : `LIVE · 3s auto-refresh · updated ${secondsSinceUpdate}s ago`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Window pills */}
            <div className="inline-flex rounded-xl bg-white/5 border border-white/10 p-0.5">
              {([
                [15, "15m"],
                [60, "1h"],
                [360, "6h"],
                [1440, "24h"],
              ] as Array<[WindowMinutes, string]>).map(([mins, label]) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setWindowMinutes(mins)}
                  className={`px-2.5 py-1.5 min-h-[36px] rounded-lg text-xs font-bold transition-colors ${
                    windowMinutes === mins
                      ? "bg-emerald-500 text-slate-950"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? "Resume live stream" : "Pause live stream"}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-slate-200"
            >
              {paused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5 text-amber-300" />}
              <span className="hidden sm:inline">{paused ? "Resume" : "Pause"}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const next = !soundOn;
                setSoundOn(next);
                if (next) playSoftPing();
              }}
              aria-label={soundOn ? "Mute live activity chime" : "Enable live activity chime"}
              className={`inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-xl border text-xs font-bold ${
                soundOn
                  ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-200"
                  : "bg-white/5 hover:bg-white/10 border-white/10 text-slate-300"
              }`}
            >
              {soundOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{soundOn ? "Chime on" : "Chime off"}</span>
            </button>

            <button
              type="button"
              onClick={() => void fetchFeed(windowMinutes)}
              aria-label="Refresh live feed now"
              className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 space-y-5">
        {denied && (
          <div className="rounded-2xl bg-amber-500/15 border border-amber-400/35 p-4 text-sm text-amber-100 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold">Admin sign-in required</p>
              <p className="text-xs text-amber-200/85 mt-0.5">
                Sign in with your Good Sort admin email to stream live user interactions.
              </p>
            </div>
            <Link
              href="/login?next=/admin/live"
              className="inline-flex items-center min-h-[40px] px-4 rounded-xl bg-amber-400 text-slate-950 text-xs font-extrabold"
            >
              Sign in as Admin
            </Link>
          </div>
        )}

        {errorMsg && !denied && (
          <div className="rounded-xl bg-rose-500/15 border border-rose-400/30 px-4 py-2.5 text-xs text-rose-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {errorMsg}
          </div>
        )}

        {/* 6 Live Pulse KPI cards */}
        {pulse && (
          <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <PulseCard
              label="Last 15m"
              value={String(pulse.eventsLast15m)}
              sub={`${pulse.interactionsLast5m} in last 5m`}
              tone={pulse.interactionsLast5m > 0 ? "emerald" : "slate"}
            />
            <PulseCard
              label="OTPs · Signups"
              value={`${pulse.otpsVerified}/${pulse.otpsSent}`}
              sub={`${pulse.newSignups} new profile${pulse.newSignups === 1 ? "" : "s"}`}
              tone="violet"
            />
            <PulseCard
              label="Camera → Snap"
              value={`${pulse.cameraOpens} → ${pulse.scansCaptured}`}
              sub={`${pulse.pageViews} views · ${pulse.ctaTaps} CTAs`}
              tone="sky"
            />
            <PulseCard
              label="AI Vision"
              value={`${pulse.visionSucceeded}/${pulse.visionCalls}`}
              sub={pulse.avgVisionMs > 0 ? `avg ${pulse.avgVisionMs}ms` : "no photo calls"}
              tone={pulse.visionFailed > 0 ? "rose" : "emerald"}
            />
            <PulseCard
              label="Cans Credited"
              value={String(pulse.scansCredited)}
              sub={`${pulse.householdsCreated} home${pulse.householdsCreated === 1 ? "" : "s"} · ${pulse.bagsTagged} bag${pulse.bagsTagged === 1 ? "" : "s"}`}
              tone="emerald"
            />
            <PulseCard
              label="Friction / Errors"
              value={String(frictionCount)}
              sub={`${pulse.cameraDenied} cam denied · ${pulse.visionFailed} AI err`}
              tone={frictionCount > 0 ? "rose" : "slate"}
            />
          </section>
        )}

        {/* Mobile section switcher */}
        <div className="grid grid-cols-3 gap-1.5 lg:hidden rounded-2xl bg-white/5 border border-white/10 p-1">
          {([
            ["stream", `Stream (${filteredStream.length})`],
            ["testers", `Testers (${data?.testers.length ?? 0})`],
            ["funnel", "Funnel"],
          ] as Array<[MobileTab, string]>).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setMobileTab(tab)}
              className={`min-h-[40px] rounded-xl text-xs font-bold transition-colors ${
                mobileTab === tab ? "bg-emerald-500 text-slate-950" : "text-slate-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Main 2-column mission-control grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT: Real-Time Interaction Stream */}
          <section className={`lg:col-span-7 space-y-3 ${mobileTab === "stream" ? "block" : "hidden lg:block"}`}>
            <div className="rounded-2xl bg-slate-900/80 border border-white/10 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-sm font-bold text-white">Real-Time Event Stream</h2>
                  <span className="text-[11px] font-semibold text-slate-400 tabular-nums">
                    ({filteredStream.length})
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {([
                    ["all", "All"],
                    ["people", "People"],
                    ["scanner", "Scanner & AI"],
                    ["pages", "Pages"],
                    ["errors", "Errors"],
                  ] as Array<[StreamFilter, string]>).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setFilter(key)}
                      className={`px-2.5 py-1 min-h-[32px] rounded-lg text-[11px] font-bold transition-colors ${
                        filter === key
                          ? "bg-white text-slate-950"
                          : "bg-white/5 text-slate-300 hover:bg-white/10"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {filteredStream.length === 0 ? (
                <div className="p-10 text-center text-sm text-slate-400">
                  No interactions in this window yet — watching live every 3 seconds…
                </div>
              ) : (
                <ul className="divide-y divide-white/5 max-h-[72vh] overflow-y-auto">
                  {filteredStream.map((item) => {
                    const isFresh = Boolean(freshIds[item.id] && nowTick - freshIds[item.id] < 12000);
                    return (
                      <li
                        key={item.id}
                        className={`px-4 py-3 flex items-start gap-3 transition-colors ${
                          isFresh
                            ? "bg-emerald-500/15"
                            : item.severity === "error"
                              ? "bg-rose-500/10"
                              : "hover:bg-white/[0.03]"
                        }`}
                      >
                        <div className="mt-0.5 p-2 rounded-xl bg-white/5 border border-white/10">
                          <StreamIcon kind={item.kind} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="text-[13px] font-bold text-white">{item.title}</span>
                            {isFresh && (
                              <span className="px-1.5 py-0.5 rounded-md bg-emerald-400 text-slate-950 text-[9px] font-extrabold uppercase tracking-wider">
                                Live
                              </span>
                            )}
                            {item.suburb && (
                              <span className="px-2 py-0.5 rounded-full bg-white/10 text-slate-200 text-[10px] font-semibold">
                                {titleSuburb(item.suburb)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-300 mt-0.5 break-words">{item.detail}</p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 mt-1">
                            <span className="font-medium text-slate-400 truncate max-w-[220px]">{item.actor}</span>
                            {item.path && (
                              <>
                                <span>·</span>
                                <span className="font-mono text-[10px] text-slate-400">{item.path}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0 tabular-nums">
                          <p className="text-[11px] font-mono text-slate-300">{formatBrisbaneClock(item.timestamp)}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">{formatAge(item.timestamp, nowTick)}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* RIGHT: Tester Journeys + Live Funnel */}
          <div className="lg:col-span-5 space-y-5">
            {/* Tester Journeys */}
            <section
              className={`rounded-2xl bg-slate-900/80 border border-white/10 overflow-hidden ${
                mobileTab === "testers" ? "block" : "hidden lg:block"
              }`}
            >
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-sm font-bold text-white">Live Tester Journeys</h2>
                </div>
                <Link href="/admin/users" className="text-xs font-semibold text-emerald-400 hover:text-emerald-300">
                  Full CRM →
                </Link>
              </div>

              {!data || data.testers.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  No signups or OTP attempts yet.
                </div>
              ) : (
                <div className="divide-y divide-white/5 max-h-[46vh] overflow-y-auto">
                  {data.testers.map((tester) => {
                    const pill = statusPill(tester.status);
                    return (
                      <div key={tester.key} className="p-4 space-y-2.5 hover:bg-white/[0.02]">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[13px] font-bold text-white truncate">
                              {tester.email || tester.name}
                            </p>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              {tester.suburb ? titleSuburb(tester.suburb) : "No suburb yet"}
                              {" · "}
                              {tester.scansCount} {tester.scansCount === 1 ? "can" : "cans"}
                              {tester.pendingCents > 0 ? ` (${tester.pendingCents}¢)` : ""}
                              {tester.visionErrors > 0 ? ` · ${tester.visionErrors} AI err` : ""}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${pill.cls}`}>
                              {pill.label}
                            </span>
                            <p className="text-[10px] text-slate-500 mt-1 tabular-nums">
                              {formatAge(tester.lastSeenAt, nowTick)}
                            </p>
                          </div>
                        </div>

                        {/* Milestone progress pills */}
                        <div className="flex flex-wrap gap-1">
                          <MilestonePill label="OTP" done={tester.milestones.otpSent} />
                          <MilestonePill label="Verified" done={tester.milestones.otpVerified} />
                          <MilestonePill label="Scanned" done={tester.milestones.scanned} />
                          <MilestonePill label="Address" done={tester.milestones.hasAddress} />
                          <MilestonePill label="PayID" done={tester.milestones.hasPayout} />
                          <MilestonePill label="Bag" done={tester.milestones.hasBag} />
                        </div>

                        {/* Step-by-step trace */}
                        {tester.recentSteps.length > 0 && (
                          <div className="rounded-xl bg-black/30 border border-white/5 px-3 py-2 space-y-1">
                            {tester.recentSteps.slice(0, 4).map((st, idx) => (
                              <div key={`${tester.key}-${idx}`} className="flex items-center justify-between gap-2 text-[11px]">
                                <span
                                  className={`truncate ${
                                    st.tone === "err"
                                      ? "text-rose-300 font-semibold"
                                      : st.tone === "warn"
                                        ? "text-amber-300"
                                        : st.tone === "ok"
                                          ? "text-emerald-200"
                                          : "text-slate-300"
                                  }`}
                                >
                                  {st.label}
                                </span>
                                <span className="font-mono text-[10px] text-slate-500 shrink-0 tabular-nums">
                                  {formatBrisbaneClock(st.timestamp)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Live Funnel + Top Suburbs */}
            <section
              className={`rounded-2xl bg-slate-900/80 border border-white/10 p-4 space-y-4 ${
                mobileTab === "funnel" ? "block" : "hidden lg:block"
              }`}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Live Funnel ({windowMinutes >= 60 ? `${windowMinutes / 60}h` : `${windowMinutes}m`})
                </h2>
                <span className="text-[11px] text-slate-400">Drop-off radar</span>
              </div>

              <div className="space-y-2">
                {(data?.funnel ?? []).map((stage) => {
                  const pct = Math.min(100, Math.round((stage.count / funnelMax) * 100));
                  return (
                    <div key={stage.key} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-300 font-medium">{stage.label}</span>
                        <span className="font-bold text-white tabular-nums">{stage.count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-300 transition-all duration-500"
                          style={{ width: `${stage.count > 0 ? Math.max(4, pct) : 0}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {data && data.topSuburbs.length > 0 && (
                <div className="pt-3 border-t border-white/10">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Active Suburbs Right Now
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.topSuburbs.map((s) => (
                      <span
                        key={s.suburb}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-slate-200"
                      >
                        <span className="font-semibold">{titleSuburb(s.suburb)}</span>
                        <span className="text-emerald-400 font-bold tabular-nums">{s.events}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

function PulseCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "emerald" | "violet" | "sky" | "rose" | "slate";
}) {
  const toneCls = {
    emerald: "bg-emerald-500/10 border-emerald-400/25 text-emerald-300",
    violet: "bg-violet-500/10 border-violet-400/25 text-violet-200",
    sky: "bg-sky-500/10 border-sky-400/25 text-sky-200",
    rose: "bg-rose-500/15 border-rose-400/40 text-rose-200",
    slate: "bg-slate-900/80 border-white/10 text-slate-200",
  }[tone];

  return (
    <div className={`rounded-2xl border p-3.5 ${toneCls}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-75">{label}</p>
      <p className="text-xl font-display font-extrabold text-white tabular-nums mt-0.5">{value}</p>
      <p className="text-[11px] opacity-75 truncate mt-0.5">{sub}</p>
    </div>
  );
}

function MilestonePill({ label, done }: { label: string; done: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
        done
          ? "bg-emerald-500/20 border-emerald-400/35 text-emerald-200"
          : "bg-white/5 border-white/10 text-slate-500"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${done ? "bg-emerald-400" : "bg-slate-600"}`} />
      {label}
    </span>
  );
}

function StreamIcon({ kind }: { kind: LiveStreamItem["kind"] }) {
  const base = "w-4 h-4 shrink-0";
  switch (kind) {
    case "otp":
      return <Mail className={`${base} text-violet-300`} />;
    case "signup":
      return <UserPlus className={`${base} text-emerald-300`} />;
    case "camera":
      return <Camera className={`${base} text-sky-300`} />;
    case "vision":
      return <Sparkles className={`${base} text-amber-300`} />;
    case "scan":
      return <ScanLine className={`${base} text-emerald-300`} />;
    case "household":
      return <Home className={`${base} text-emerald-300`} />;
    case "bag":
      return <Package className={`${base} text-violet-300`} />;
    case "cta":
      return <MousePointerClick className={`${base} text-sky-300`} />;
    case "error":
      return <AlertTriangle className={`${base} text-rose-400`} />;
    default:
      return <Eye className={`${base} text-slate-400`} />;
  }
}
