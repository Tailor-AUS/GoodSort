"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Users, Package, Truck, DollarSign, Download, MapPin, RotateCcw, Copy, Check, Printer, Building2, Activity, RefreshCw, ChevronRight } from "lucide-react";
import { apiUrl, readStoredProfileId } from "@/lib/config";
import { titleSuburb } from "@/lib/brisbane";

interface FunnelStage {
  key: string;
  label: string;
  count: number;
  conversionFromPrevPct: number | null;
}

interface Funnel {
  since: string;
  windowDays?: number;
  suburb?: string | null;
  note?: string;
  events: Record<string, number>;
  orderedStages?: FunnelStage[];
  suburbs?: Array<{ suburb: string; totalEvents: number }>;
  dailyTrend?: Array<{ date: string; label: string; signups: number; scans: number }>;
}

interface ActivityItem {
  id: string;
  kind: "signup" | "scan" | "bag" | "cashout";
  timestamp: string;
  userId: string | null;
  userEmail: string | null;
  userName: string;
  suburb: string | null;
  summary: string;
  badge: string;
}

interface Stats {
  users: number;
  nonAdminUsers?: number;
  bins: number;
  scans: number;
  routes: number;
  runs: number;
  runsAvailable: number;
  runsInFlight: number;
  runsSettled: number;
  resetBaselineEnabled?: boolean;
  totalContainers: number;
  totalPending: number;
  totalCleared: number;
  vision?: {
    total: number;
    last30d: number;
    last7d: number;
    tailor: number;
    openai: number;
    failed: number;
  };
  activation?: {
    activatedUsers: number;
    activationPct: number;
    householdsWithAddress: number;
    runnersRegistered: number;
  };
}

interface CrpLedgerEntry {
  id: string;
  runId: string;
  areaName: string;
  settlementMode: string;
  coexDocketRef?: string | null;
  verifiedContainers: number;
  bagsVerified: number;
  discrepancyStops: number;
  grossRevenueDollars: number;
  proFormaCoexGrossDollars: number;
  householdPayoutCents: number;
  containerMafiaCents: number;
  runnerPayoutCents: number;
  totalPayoutCents: number;
  netMarginDollars: number;
  proFormaCrpNetMarginDollars: number;
  createdAt: string;
}

interface CrpLedgerData {
  crpActive: boolean;
  activeHouseholdRateCents: number;
  payouts: {
    abaOpen: boolean;
    payIdOpen: boolean;
    pendingAbaCount: number;
    pendingAbaCents: number;
    pendingPayIdCount: number;
    pendingPayIdCents: number;
  };
  bags: {
    totalSealed: number;
    onKerb: number;
  };
  totals: {
    settledRuns: number;
    verifiedContainers: number;
    bagsVerified: number;
    discrepancyStops: number;
    grossRevenueDollars: number;
    proFormaCoexGrossDollars: number;
    householdPayoutCents: number;
    containerMafiaCents: number;
    runnerPayoutCents: number;
    totalPayoutCents: number;
    netMarginDollars: number;
    proFormaCrpNetMarginDollars: number;
  };
  entries: CrpLedgerEntry[];
}

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [funnelDays, setFunnelDays] = useState<1 | 7 | 30>(30);
  const [funnelSuburb, setFunnelSuburb] = useState<string>("");
  const [showRawEvents, setShowRawEvents] = useState(false);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [crpLedger, setCrpLedger] = useState<CrpLedgerData | null>(null);
  const [readyDays, setReadyDays] = useState<{ suburb: string; dayName: string }[]>([]);
  const [stalledHouseholds, setStalledHouseholds] = useState(0);
  const [resetting, setResetting] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [adminProfileId, setAdminProfileId] = useState<string | undefined>(undefined);
  const [cashouts, setCashouts] = useState<Array<{ id: string; status: string; payoutMethod?: string | null; amountCents: number; accountName?: string | null; batchId?: string | null }>>([]);

  const organicUsers = stats?.nonAdminUsers ?? Math.max(0, (stats?.users ?? 1) - 1);
  const organicScans = stats?.scans ?? 0;
  const adminInviteUrl = adminProfileId
    ? `https://thegoodsort.org/scan?r=${adminProfileId}`
    : "https://thegoodsort.org/scan";

  function copyAdminInvite() {
    navigator.clipboard?.writeText(adminInviteUrl).catch(() => {});
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }

  const loadFunnel = useCallback((days: number, suburb: string) => {
    const token = localStorage.getItem("goodsort_token");
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    const params = new URLSearchParams({ days: String(days) });
    if (suburb) params.set("suburb", suburb);
    fetch(apiUrl(`/api/admin/funnel?${params.toString()}`), { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setFunnel(d); })
      .catch(() => {});
  }, []);

  const loadDashboard = useCallback(() => {
    const token = localStorage.getItem("goodsort_token");
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(apiUrl("/api/admin/stats"), { headers })
      .then((r) => {
        if (r.status === 401 || r.status === 403) { setDenied(true); throw new Error(); }
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
    loadFunnel(funnelDays, funnelSuburb);
    fetch(apiUrl("/api/admin/activity?limit=25"), { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.items)) setActivity(d.items); })
      .catch(() => {});
    fetch(apiUrl("/api/admin/crp-ledger"), { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setCrpLedger(d); })
      .catch(() => {});
    fetch(apiUrl("/api/admin/cashouts"), { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d)) setCashouts(d); })
      .catch(() => {});
    fetch(apiUrl("/api/admin/waitlist"), { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const ready: { suburb: string; dayName: string }[] = [];
        let stalled = 0;
        for (const s of d?.suburbs ?? []) {
          // UNKNOWN is members who joined with no usable suburb. They
          // contribute no days and are never readyToOrder, so they were
          // invisible on this dashboard entirely.
          if (s.suburb === "UNKNOWN") stalled += s.households ?? 0;
          for (const day of s.days ?? []) {
            if (day.readyToOrder) ready.push({ suburb: s.suburb, dayName: day.dayName });
          }
        }
        setReadyDays(ready);
        setStalledHouseholds(stalled);
      })
      .catch(() => {});
  }, [funnelDays, funnelSuburb, loadFunnel]);

  useEffect(() => {
    setAdminProfileId(readStoredProfileId());
    loadDashboard();
  }, [loadDashboard]);

  async function resetBaseline() {
    if (!window.confirm("Reset database to a clean startup baseline? This clears pre-launch users, households, scans, vision logs, and funnel events, keeping only hello@thegoodsort.org.")) {
      return;
    }
    setResetting(true);
    try {
      const token = localStorage.getItem("goodsort_token");
      const res = await fetch(apiUrl("/api/admin/reset-baseline"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ confirm: "RESET_BASELINE" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to reset database baseline");
      } else {
        loadDashboard();
      }
    } catch {
      alert("Network error while resetting database baseline");
    } finally {
      setResetting(false);
    }
  }

  async function exportAba() {
    const token = localStorage.getItem("goodsort_token");
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(apiUrl("/api/admin/aba-export"), { method: "POST", headers });
    const contentType = res.headers.get("content-type") || "";
    if (!res.ok) {
      const data = contentType.includes("application/json")
        ? await res.json().catch(() => ({}))
        : {};
      alert(data.error || data.message || `ABA export failed (HTTP ${res.status})`);
      return;
    }
    if (contentType.includes("application/json")) {
      const data = await res.json().catch(() => ({}));
      alert(data.message || data.error || "No pending ABA cashouts to export");
      return;
    }
    const text = await res.text();
    if (!text || text.includes("No pending")) {
      alert("No pending ABA cashouts to export");
      return;
    }
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `goodsort-payouts-${new Date().toISOString().split("T")[0]}.aba`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    loadDashboard();
  }

  async function exportPayIdCsv() {
    const token = localStorage.getItem("goodsort_token");
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(apiUrl("/api/admin/payid-export"), { method: "POST", headers });
    const contentType = res.headers.get("content-type") || "";
    if (!res.ok) {
      const data = contentType.includes("application/json")
        ? await res.json().catch(() => ({}))
        : {};
      alert(data.error || data.message || `PayID CSV export failed (HTTP ${res.status})`);
      return;
    }
    if (contentType.includes("application/json")) {
      const data = await res.json().catch(() => ({}));
      alert(data.message || data.error || "No pending PayID cashouts to export");
      return;
    }
    const text = await res.text();
    if (!text || text.includes("No pending")) {
      alert("No pending PayID cashouts to export");
      return;
    }
    const blob = new Blob([text], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `goodsort-payid-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    loadDashboard();
  }

  if (loading) return <div className="min-h-dvh bg-white flex items-center justify-center"><p className="text-slate-400">Loading...</p></div>;

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-6">Admin Dashboard</h1>
        {denied && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-[13px] text-amber-900 mb-6">
            This login is not an admin. After the waitlist ships, set <code className="font-mono">ADMIN_SEED_EMAIL</code> on the API to your email and sign in once — or use the one-shot bootstrap secret. Zeros below are not household counts.
          </div>
        )}
        {!denied && readyDays.length > 0 && (
          <Link href="/admin/waitlist" className="block bg-violet-50 border border-violet-300 rounded-xl p-4 mb-6">
            <p className="text-[14px] font-bold text-violet-900">
              {readyDays.length} suburb{readyDays.length === 1 ? "" : "s"} ready for a volume run
            </p>
            <p className="text-[12px] text-violet-800 mt-1">
              {readyDays.slice(0, 4).map((d) => `${titleSuburb(d.suburb)} ${d.dayName}`).join(" · ")}
              {readyDays.length > 4 ? " · …" : ""}. Allocate that day only.
            </p>
          </Link>
        )}

        {!denied && stalledHouseholds > 0 && (
          <Link href="/admin/waitlist" className="block bg-amber-50 border border-amber-300 rounded-xl p-4 mb-6">
            <p className="text-[14px] font-bold text-amber-900">
              {stalledHouseholds} {stalledHouseholds === 1 ? "member" : "members"} joined but cannot be counted
            </p>
            <p className="text-[12px] text-amber-800 mt-1">
              No usable suburb, so they build no volume and cannot be collected from. They need a nudge to finish
              onboarding.
            </p>
          </Link>
        )}

        {/* Stats grid */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">First 10 Organic Users &amp; Neighbour Network Goal</p>
              <p className="text-[15px] font-extrabold text-slate-900">
                {organicUsers} / 10 organic users · {organicScans} / 10 organic scans
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copyAdminInvite}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[12px] font-bold text-white hover:bg-emerald-700"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedLink ? "Copied referral link" : "Copy neighbour referral link (+100 PTS + 1 PT/can)"}
              </button>
              <Link
                href="/flyer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-emerald-300 px-3 py-2 text-[12px] font-bold text-emerald-900 hover:bg-emerald-100"
              >
                <Printer className="w-3.5 h-3.5" />
                Printable Home Sorting Guide &amp; Flyer
              </Link>
            </div>
          </div>
          <p className="text-[12px] text-emerald-900">
            Admin login codes, suburb volume ops alerts, and outbound invites run through <code className="font-mono">hello@thegoodsort.org</code>.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <StatCard icon={Users} label="Users" value={stats?.users ?? 0} />
          <StatCard icon={Package} label="Containers" value={stats?.totalContainers ?? 0} />
          {/* "Routes" counted the CollectionRoute table, which nothing writes
              to, so it read 0 forever and hid all real collection activity.
              Runs is the live one. */}
          <StatCard icon={Truck} label="Runs" value={stats?.runs ?? 0} />
          <StatCard icon={DollarSign} label="Pending" value={`$${((stats?.totalPending ?? 0) / 100).toFixed(2)}`} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <p className="text-[11px] text-slate-400 uppercase tracking-wider">Bins</p>
            <p className="text-2xl font-display font-extrabold text-slate-900">{stats?.bins ?? 0}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <p className="text-[11px] text-slate-400 uppercase tracking-wider">Total Scans</p>
            <p className="text-2xl font-display font-extrabold text-slate-900">{stats?.scans ?? 0}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <p className="text-[11px] text-slate-400 uppercase tracking-wider">Cleared Earnings</p>
            <p className="text-2xl font-display font-extrabold text-green-600">${((stats?.totalCleared ?? 0) / 100).toFixed(2)}</p>
          </div>
        </div>

        {/* Activation */}
        {stats?.activation && (
          <div className="bg-white rounded-xl p-4 border border-slate-200 mb-4">
            <p className="text-[11px] text-slate-400 uppercase tracking-wider mb-3">Activation</p>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <p className="text-2xl font-display font-extrabold text-slate-900">{stats.activation.activationPct}%</p>
                <p className="text-[11px] text-slate-400">Activated</p>
              </div>
              <div>
                <p className="text-2xl font-display font-extrabold text-slate-900">{stats.activation.activatedUsers}</p>
                <p className="text-[11px] text-slate-400">Scanned 1+</p>
              </div>
              <div>
                <p className="text-2xl font-display font-extrabold text-slate-900">{stats.activation.householdsWithAddress}</p>
                <p className="text-[11px] text-slate-400">Addresses</p>
              </div>
              <div>
                <p className="text-2xl font-display font-extrabold text-slate-900">{stats.activation.runnersRegistered}</p>
                <p className="text-[11px] text-slate-400">Runners</p>
              </div>
            </div>
          </div>
        )}

        {/* Tailor Vision usage */}
        {stats?.vision && (
          <div className="bg-white rounded-xl p-4 border border-slate-200 mb-8">
            <p className="text-[11px] text-slate-400 uppercase tracking-wider mb-3">Vision API calls</p>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <p className="text-2xl font-display font-extrabold text-slate-900">{stats.vision.last7d}</p>
                <p className="text-[11px] text-slate-400">Last 7d</p>
              </div>
              <div>
                <p className="text-2xl font-display font-extrabold text-slate-900">{stats.vision.last30d}</p>
                <p className="text-[11px] text-slate-400">Last 30d</p>
              </div>
              <div>
                <p className="text-2xl font-display font-extrabold text-slate-900">{stats.vision.total}</p>
                <p className="text-[11px] text-slate-400">All time</p>
              </div>
            </div>
            <div className="flex gap-4 text-[12px] text-slate-500 pt-3 border-t border-slate-100">
              <span>Succeeded: <b className="text-slate-900">{stats.vision.openai + stats.vision.tailor}</b></span>
              <span>Failed: <b className="text-red-600">{stats.vision.failed}</b></span>
            </div>
          </div>
        )}

        {/* Ordered Conversion Funnel + 24h/7d/30d + Suburb Filter */}
        {funnel && (
          <div className="bg-white rounded-2xl p-5 border border-slate-200 mb-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Conversion Funnel</p>
                <p className="text-[12px] text-slate-500 mt-0.5">{funnel.note ?? "Durable across restarts and deploys."}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl bg-slate-100 p-1">
                  {([1, 7, 30] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setFunnelDays(d)}
                      className={`min-h-[32px] px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                        funnelDays === d ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {d === 1 ? "24h" : `${d}d`}
                    </button>
                  ))}
                </div>
                <select
                  aria-label="Filter funnel by suburb"
                  value={funnelSuburb}
                  onChange={(e) => setFunnelSuburb(e.target.value)}
                  className="min-h-[40px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-800"
                >
                  <option value="">All suburbs</option>
                  {(funnel.suburbs ?? []).map((s) => (
                    <option key={s.suburb} value={s.suburb}>
                      {titleSuburb(s.suburb)} ({s.totalEvents})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {funnel.orderedStages && funnel.orderedStages.length > 0 && (() => {
              const maxStage = Math.max(1, ...funnel.orderedStages.map((s) => s.count));
              return (
                <div className="space-y-2 mb-4">
                  {funnel.orderedStages.map((stage, idx) => {
                    const pctWidth = stage.count > 0 ? Math.max(4, Math.round((stage.count / maxStage) * 100)) : 0;
                    return (
                      <div key={stage.key} className="grid grid-cols-[1fr_auto] items-center gap-3">
                        <div>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="font-semibold text-slate-800">
                              <span className="text-slate-400 mr-1.5 tabular-nums">{idx + 1}.</span>
                              {stage.label}
                            </span>
                            {stage.conversionFromPrevPct != null && (
                              <span className="text-[11px] font-semibold text-emerald-700 tabular-nums">
                                {stage.conversionFromPrevPct}% of prev
                              </span>
                            )}
                          </div>
                          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-emerald-600 transition-all"
                              style={{ width: `${pctWidth}%` }}
                            />
                          </div>
                        </div>
                        <span className="w-12 text-right text-sm font-display font-extrabold text-slate-900 tabular-nums">
                          {stage.count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {funnel.dailyTrend && funnel.dailyTrend.length > 0 && (() => {
              const maxDay = Math.max(1, ...funnel.dailyTrend.map((d) => d.scans + d.signups));
              return (
                <div className="pt-3 border-t border-slate-100 mb-3">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mb-2">
                    <span className="font-bold uppercase tracking-wider text-slate-400">Daily Scans &amp; Signups</span>
                    <span>Green = scans · Dark = signups</span>
                  </div>
                  <div className="grid gap-1 items-end h-16" style={{ gridTemplateColumns: `repeat(${funnel.dailyTrend.length}, minmax(0, 1fr))` }}>
                    {funnel.dailyTrend.map((d) => (
                      <div key={d.date} className="flex flex-col items-center gap-0.5 h-full justify-end" title={`${d.label}: ${d.scans} scans, ${d.signups} signups`}>
                        <div className="w-full flex items-end justify-center gap-0.5 h-11">
                          <div
                            className="w-1.5 rounded-t bg-emerald-500"
                            style={{ height: `${d.scans > 0 ? Math.max(12, Math.round((d.scans / maxDay) * 100)) : 4}%`, opacity: d.scans > 0 ? 1 : 0.2 }}
                          />
                          <div
                            className="w-1.5 rounded-t bg-slate-900"
                            style={{ height: `${d.signups > 0 ? Math.max(12, Math.round((d.signups / maxDay) * 100)) : 4}%`, opacity: d.signups > 0 ? 1 : 0.2 }}
                          />
                        </div>
                        <span className="text-[9px] text-slate-400 truncate max-w-full">{d.label.slice(0, 2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <div className="text-[11px] text-slate-500">
                Points Swap votes: <strong className="text-slate-900">{funnel.events?.points_swap_voted ?? 0}</strong> · Flyer prints: <strong className="text-slate-900">{funnel.events?.flyer_printed ?? 0}</strong>
              </div>
              <button
                type="button"
                onClick={() => setShowRawEvents((v) => !v)}
                className="text-xs font-bold text-emerald-700 hover:text-emerald-900 min-h-[36px] px-2"
              >
                {showRawEvents ? "Hide raw events" : `All ${Object.keys(funnel.events ?? {}).length} raw events`}
              </button>
            </div>

            {showRawEvents && (
              <div className="grid grid-cols-3 md:grid-cols-5 gap-3 pt-3 mt-2 border-t border-slate-100">
                {Object.keys(funnel.events ?? {}).map((name) => (
                  <div key={name}>
                    <p className="text-xl font-display font-extrabold text-slate-900 tabular-nums">{funnel.events?.[name] ?? 0}</p>
                    <p className="text-[11px] text-slate-400">{name.replaceAll("_", " ")}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Live Activity Stream */}
        {!denied && (
          <div className="bg-white rounded-2xl p-5 border border-slate-200 mb-8 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-600" />
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Live Activity Stream ({activity.length})
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadDashboard}
                  className="inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-slate-700"
                >
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
                <Link
                  href="/admin/users"
                  className="inline-flex items-center gap-0.5 min-h-[36px] px-2.5 rounded-lg bg-emerald-50 text-emerald-800 text-[11px] font-bold"
                >
                  Users CRM <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
            {activity.length === 0 ? (
              <p className="text-xs text-slate-400 py-2">No recent user activity yet.</p>
            ) : (
              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {activity.map((item) => {
                  const href = item.userId ? `/admin/users?user=${item.userId}` : "/admin/users";
                  const badgeCls =
                    item.kind === "scan"
                      ? "bg-emerald-50 text-emerald-800"
                      : item.kind === "bag"
                        ? "bg-blue-50 text-blue-800"
                        : item.kind === "cashout"
                          ? "bg-violet-50 text-violet-800"
                          : "bg-amber-50 text-amber-800";
                  return (
                    <Link
                      key={item.id}
                      href={href}
                      className="py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 px-2 -mx-2 rounded-xl transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] font-bold text-slate-900 truncate">
                            {item.userEmail || item.userName}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeCls}`}>
                            {item.badge}
                          </span>
                          {item.suburb && (
                            <span className="text-[10px] font-semibold text-slate-400">
                              {titleSuburb(item.suburb)}
                            </span>
                          )}
                        </div>
                        <p className="text-[12px] text-slate-600 truncate mt-0.5">{item.summary}</p>
                      </div>
                      <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">
                        {new Date(item.timestamp).toLocaleString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {crpLedger && (
          <div className="bg-white rounded-xl p-5 border border-violet-200 mb-8 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-violet-700">
                  COEX Secondary-Sorted CRP Settlement Ledger (17.68¢/can)
                </p>
                <p className="text-[14px] font-extrabold text-slate-900">
                  10.00¢ COEX Refund + 7.68¢ Handling = 17.68¢ → {crpLedger.activeHouseholdRateCents}¢ Sorter · 0¢ Referrals (Points) · 3¢ Runner · +4.68¢ CRP Margin
                </p>
              </div>
              <span
                className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                  crpLedger.crpActive
                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                    : "bg-amber-50 text-amber-800 border-amber-200"
                }`}
              >
                {crpLedger.crpActive ? "COEX CRP Active (10¢ Sorter)" : "CRP Building — Pre-CCA Mode (10¢ home sorter + pro-forma 17.68¢)"}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5 mb-4">
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <p className="text-lg font-display font-extrabold text-slate-900">{crpLedger.totals.settledRuns}</p>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">Settled Runs</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <p className="text-lg font-display font-extrabold text-slate-900">{crpLedger.totals.verifiedContainers}</p>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">Verified Cans</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <p className="text-lg font-display font-extrabold text-violet-700">{crpLedger.totals.bagsVerified}</p>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">QR Bags Scanned</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <p className="text-lg font-display font-extrabold text-slate-900">
                  {crpLedger.bags.onKerb} / {crpLedger.bags.totalSealed}
                </p>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">On Kerb / Sealed</p>
              </div>
              <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100">
                <p className="text-lg font-display font-extrabold text-emerald-800">
                  ${crpLedger.totals.proFormaCoexGrossDollars.toFixed(2)}
                </p>
                <p className="text-[10px] text-emerald-700 uppercase tracking-wider">17.68¢ Gross</p>
              </div>
              <div className="bg-violet-50 rounded-lg p-3 border border-violet-100">
                <p className="text-lg font-display font-extrabold text-violet-800">
                  ${crpLedger.totals.proFormaCrpNetMarginDollars.toFixed(2)}
                </p>
                <p className="text-[10px] text-violet-700 uppercase tracking-wider">+4.68¢ Margin</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-4">
              <div className="flex items-center justify-between bg-slate-50 rounded-xl p-3 border border-slate-200">
                <div>
                  <p className="text-[12px] font-bold text-slate-900">
                    Pending ABA Batch: {crpLedger.payouts.pendingAbaCount} ($
                    {(crpLedger.payouts.pendingAbaCents / 100).toFixed(2)})
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {crpLedger.payouts.abaOpen ? "ABA gate open" : "Gate closed (PAYOUTS_ENABLED=false)"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={exportAba}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-bold text-white hover:bg-slate-800"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export .ABA
                </button>
              </div>
              <div className="flex items-center justify-between bg-slate-50 rounded-xl p-3 border border-slate-200">
                <div>
                  <p className="text-[12px] font-bold text-slate-900">
                    Pending NPP PayID Batch: {crpLedger.payouts.pendingPayIdCount} ($
                    {(crpLedger.payouts.pendingPayIdCents / 100).toFixed(2)})
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {crpLedger.payouts.payIdOpen ? "PayID gate open" : "Gate closed (PAYID_PAYOUTS_ENABLED=false)"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={exportPayIdCsv}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-violet-700"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export PayID .CSV
                </button>
              </div>
            </div>

            {crpLedger.entries.length > 0 && (
              <div className="overflow-x-auto border-t border-slate-100 pt-3">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                      <th className="py-1.5 pr-2">Suburb Run</th>
                      <th className="py-1.5 pr-2">Docket</th>
                      <th className="py-1.5 pr-2">Cans</th>
                      <th className="py-1.5 pr-2">Bags</th>
                      <th className="py-1.5 pr-2">Payouts (S/M/R)</th>
                      <th className="py-1.5 text-right">CRP Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {crpLedger.entries.slice(0, 8).map((entry) => (
                      <tr key={entry.id} className="border-b border-slate-50 last:border-0">
                        <td className="py-2 pr-2 font-semibold text-slate-800">{entry.areaName}</td>
                        <td className="py-2 pr-2 font-mono text-[11px] text-slate-500">
                          {entry.coexDocketRef || "—"}
                        </td>
                        <td className="py-2 pr-2 text-slate-700">{entry.verifiedContainers}</td>
                        <td className="py-2 pr-2 text-slate-700">
                          {entry.bagsVerified}
                          {entry.discrepancyStops > 0 ? ` (${entry.discrepancyStops}⚠)` : ""}
                        </td>
                        <td className="py-2 pr-2 text-slate-600">
                          ${(entry.householdPayoutCents / 100).toFixed(2)} / $
                          {(entry.containerMafiaCents / 100).toFixed(2)} / $
                          {(entry.runnerPayoutCents / 100).toFixed(2)}
                        </td>
                        <td className={`py-2 text-right font-bold ${entry.proFormaCrpNetMarginDollars < 0 ? "text-red-600" : "text-violet-700"}`}>
                          {entry.proFormaCrpNetMarginDollars < 0
                            ? `-$${Math.abs(entry.proFormaCrpNetMarginDollars).toFixed(2)}`
                            : `+$${entry.proFormaCrpNetMarginDollars.toFixed(2)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="space-y-3">
          <Link href="/marketplace"
            className="flex items-center gap-3 w-full bg-white rounded-xl p-4 border border-slate-200 hover:border-green-300 transition-colors text-left">
            <MapPin className="w-5 h-5 text-emerald-600" />
            <div>
              <p className="text-[14px] font-semibold text-slate-900">Sorters &amp; Runners Marketplace</p>
              <p className="text-[12px] text-slate-400">Live Brisbane suburb bounties, forming 1,000-can pools, 4-stream rules &amp; leaderboard</p>
            </div>
          </Link>
          <Link href="/bags"
            className="flex items-center gap-3 w-full bg-white rounded-xl p-4 border border-slate-200 hover:border-green-300 transition-colors text-left">
            <Printer className="w-5 h-5 text-violet-600" />
            <div>
              <p className="text-[14px] font-semibold text-slate-900">4-Stream Printable &amp; Mobile QR Bag Tags</p>
              <p className="text-[12px] text-slate-400">Aluminium, Clear PET, Coloured PET &amp; Glass QR tags linked to scanned containers</p>
            </div>
          </Link>
          <Link href="/admin/users"
            className="flex items-center gap-3 w-full bg-white rounded-xl p-4 border border-slate-200 hover:border-green-300 transition-colors text-left">
            <MapPin className="w-5 h-5 text-green-600" />
            <div>
              <p className="text-[14px] font-semibold text-slate-900">Users CRM &amp; Map</p>
              <p className="text-[12px] text-slate-400">Search &amp; filter members, inspect scans/bags/PayID/referrals, export CSV &amp; view households on the map</p>
            </div>
          </Link>
          <Link href="/admin/syndicates"
            className="flex items-center gap-3 w-full bg-white rounded-xl p-4 border border-slate-200 hover:border-emerald-300 transition-colors text-left">
            <Building2 className="w-5 h-5 text-emerald-600" />
            <div>
              <p className="text-[14px] font-semibold text-slate-900">Building Syndicates</p>
              <p className="text-[12px] text-slate-400">Promote detected offices &amp; apartment blocks to Official Syndicates, schedule pickups &amp; moderate anonymous channels</p>
            </div>
          </Link>
          <Link href="/admin/waitlist"
            className="flex items-center gap-3 w-full bg-white rounded-xl p-4 border border-slate-200 hover:border-green-300 transition-colors text-left">
            <Package className="w-5 h-5 text-violet-600" />
            <div>
              <p className="text-[14px] font-semibold text-slate-900">Suburb waitlist</p>
              <p className="text-[12px] text-slate-400">Suburb volume — trigger a run at about 1,000 scanned containers</p>
            </div>
          </Link>
          <Link href="/admin/pickups"
            className="flex items-center gap-3 w-full bg-white rounded-xl p-4 border border-slate-200 hover:border-green-300 transition-colors text-left">
            <Truck className="w-5 h-5 text-green-600" />
            <div>
              <p className="text-[14px] font-semibold text-slate-900">Tomorrow's pickups</p>
              <p className="text-[12px] text-slate-400">Households, runner coverage, manual reminder trigger</p>
            </div>
          </Link>
          <Link href="/admin/bins"
            className="flex items-center gap-3 w-full bg-white rounded-xl p-4 border border-slate-200 hover:border-green-300 transition-colors text-left">
            <Package className="w-5 h-5 text-green-600" />
            <div>
              <p className="text-[14px] font-semibold text-slate-900">Bins</p>
              <p className="text-[12px] text-slate-400">Create and manage collection points</p>
            </div>
          </Link>
          <button type="button" onClick={exportAba}
            className="flex items-center gap-3 w-full bg-white rounded-xl p-4 border border-slate-200 hover:border-green-300 transition-colors text-left">
            <Download className="w-5 h-5 text-green-600" />
            <div>
              <p className="text-[14px] font-semibold text-slate-900">Export ABA File</p>
              <p className="text-[12px] text-slate-400">Download Australian BSB/account batch file (.aba) for pending bank cashouts</p>
            </div>
          </button>
          <button type="button" onClick={exportPayIdCsv}
            className="flex items-center gap-3 w-full bg-white rounded-xl p-4 border border-slate-200 hover:border-violet-300 transition-colors text-left">
            <Download className="w-5 h-5 text-violet-600" />
            <div>
              <p className="text-[14px] font-semibold text-slate-900">Export NPP PayID CSV</p>
              <p className="text-[12px] text-slate-400">Download instant PayID (Email / Phone / ABN) batch CSV for pending cashouts</p>
            </div>
          </button>
          {cashouts.some((c) => c.status === "processing") && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
              <p className="text-[13px] font-bold text-amber-950">Processing Cash-Out Batches ({cashouts.filter((c) => c.status === "processing").length})</p>
              <div className="divide-y divide-amber-200/60">
                {cashouts.filter((c) => c.status === "processing").map((c) => (
                  <div key={c.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-[12px]">
                    <span className="text-amber-950 font-medium">
                      {c.accountName || "Member"} · ${(c.amountCents / 100).toFixed(2)} ({c.payoutMethod || "aba"})
                    </span>
                    <div className="flex items-center gap-1.5">
                      {c.batchId && (() => {
                        const batchId = c.batchId;
                        return (
                          <button
                            type="button"
                            onClick={async () => {
                              const token = localStorage.getItem("goodsort_token");
                              const res = await fetch(apiUrl(`/api/admin/cashouts/batch/${batchId}`), {
                                headers: token ? { Authorization: `Bearer ${token}` } : {},
                              });
                              if (!res.ok) { alert("Could not re-download batch."); return; }
                              const text = await res.text();
                              const isCsv = (res.headers.get("content-type") || "").includes("csv");
                              const blob = new Blob([text], { type: isCsv ? "text/csv" : "text/plain" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `goodsort-batch-${batchId.slice(0, 8)}.${isCsv ? "csv" : "aba"}`;
                              a.click();
                              setTimeout(() => URL.revokeObjectURL(url), 1000);
                            }}
                            className="bg-white border border-amber-300 text-amber-900 font-semibold px-2 py-1 rounded"
                          >
                            Re-download
                          </button>
                        );
                      })()}
                      <button
                        type="button"
                        onClick={async () => {
                          const token = localStorage.getItem("goodsort_token");
                          await fetch(apiUrl(`/api/admin/cashouts/${c.id}/mark-paid`), {
                            method: "POST",
                            headers: token ? { Authorization: `Bearer ${token}` } : {},
                          });
                          loadDashboard();
                        }}
                        className="bg-emerald-700 text-white font-semibold px-2 py-1 rounded"
                      >
                        Mark Paid
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!window.confirm("Cancel this transfer and refund ClearedCents back to the member?")) return;
                          const token = localStorage.getItem("goodsort_token");
                          await fetch(apiUrl(`/api/admin/cashouts/${c.id}/refund`), {
                            method: "POST",
                            headers: token ? { Authorization: `Bearer ${token}` } : {},
                          });
                          loadDashboard();
                        }}
                        className="bg-red-600 text-white font-semibold px-2 py-1 rounded"
                      >
                        Refund
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {stats?.resetBaselineEnabled === true && (
            <button type="button" onClick={resetBaseline} disabled={resetting}
              className="flex items-center gap-3 w-full bg-white rounded-xl p-4 border border-red-200 hover:border-red-400 disabled:opacity-50 transition-colors text-left">
              <RotateCcw className="w-5 h-5 text-red-600" />
              <div>
                <p className="text-[14px] font-semibold text-red-700">{resetting ? "Resetting..." : "Reset Database to Fresh Baseline"}</p>
                <p className="text-[12px] text-slate-400">Clear pre-launch test users, scans, households, and funnel counts (keeps hello@thegoodsort.org)</p>
              </div>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number | string }) {
  return (
    <div className="bg-white rounded-xl p-4 border border-slate-200">
      <Icon className="w-5 h-5 text-green-600 mb-2" />
      <p className="text-2xl font-display font-extrabold text-slate-900">{value}</p>
      <p className="text-[11px] text-slate-400 uppercase tracking-wider">{label}</p>
    </div>
  );
}
