"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
  ExternalLink,
  PauseCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sliders,
  Star,
  Truck,
  Zap,
} from "lucide-react";
import { apiUrl } from "@/lib/config";
import { titleSuburb } from "@/lib/brisbane";

type ApprovalStatus = "approved" | "pending" | "suspended";
type ConsoleTab = "fleet" | "dispatch" | "pricing";
type FleetFilter = "all" | "online" | "on_run" | "approved" | "pending" | "suspended";
type DispatchFilter = "all" | "active" | "open" | "completed" | "settled";

interface RunnerActiveRun {
  id: string;
  areaName: string;
  status: string;
  estimatedContainers: number;
  stopCount: number;
  pickedUpStops: number;
  perContainerCents: number;
  estimatedPayoutCents: number;
  claimedAt: string | null;
  startedAt: string | null;
  stuckMinutes: number;
}

interface AdminRunnerRow {
  id: string;
  profileId: string;
  name: string;
  email: string | null;
  suburb: string | null;
  isAdmin: boolean;
  approvalStatus: ApprovalStatus;
  approvedAt: string | null;
  suspendedAt: string | null;
  adminNote: string | null;
  vehicleType: string;
  vehicleMake: string;
  vehicleRego: string;
  capacityBags: number;
  serviceRadiusKm: number;
  coexSchemeId: string | null;
  isOnline: boolean;
  rawIsOnline: boolean;
  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: string | null;
  level: string;
  rating: number;
  totalRatings: number;
  totalRuns: number;
  totalContainersCollected: number;
  lifetimeEarningsCents: number;
  clearedCents: number;
  hasPayoutDetails: boolean;
  preferredPayoutMethod: string | null;
  currentStreakDays: number;
  efficiencyScore: number;
  lastRunCompletedAt: string | null;
  createdAt: string;
  activeRun: RunnerActiveRun | null;
}

interface FleetSummary {
  totalRunners: number;
  approvedCount: number;
  pendingCount: number;
  suspendedCount: number;
  onlineNowCount: number;
  activeRunsCount: number;
  unclaimedRunsCount: number;
  completedAwaitingSettleCount: number;
  requireApprovalGate: boolean;
}

interface AdminRunRow {
  id: string;
  status: string;
  areaName: string;
  materialFocus: string;
  estimatedContainers: number;
  actualContainers: number;
  depotVerifiedContainers: number | null;
  coexDocketRef: string | null;
  estimatedWeightKg: number;
  perContainerCents: number;
  estimatedPayoutCents: number;
  actualPayoutCents: number;
  pricingTier: number;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  stopCount: number;
  pickedUpStops: number;
  stuckMinutes: number;
  dropPointName: string | null;
  runnerId: string | null;
  runnerProfileId: string | null;
  runnerName: string | null;
  runnerEmail: string | null;
  runnerVehicleType: string | null;
  runnerVehicleRego: string | null;
  runnerApprovalStatus: string | null;
  claimedAt: string | null;
  startedAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  settledAt: string | null;
  expiresAt: string;
  createdAt: string;
}

interface PricingConfigDto {
  id?: string;
  floorCents: number;
  ceilingCents: number;
  baseCents: number;
  distanceEfficiencyWeight: number;
  binDensityWeight: number;
  supplyDemandWeight: number;
  timeOfDayWeight: number;
  materialMixWeight: number;
  scrapPriceWeight: number;
  morningSurge: number;
  afternoonNormal: number;
  eveningSurge: number;
  nightDiscount: number;
  bronzeBonus: number;
  silverBonus: number;
  goldBonus: number;
  platinumBonus: number;
  aluminiumSpotCents: number;
  petSpotCents: number;
  glassSpotCents: number;
  updatedAt?: string | null;
}

interface PricingSimResult {
  perContainerCents: number;
  pricingTier: number;
  estimatedPayoutCents: number;
  factors: {
    distanceEfficiency: number;
    binDensity: number;
    supplyDemand: number;
    timeOfDay: number;
    materialMix: number;
    scrapPrice: number;
    weightedMultiplier: number;
    levelBonus: number;
  };
}

const EMPTY_SUMMARY: FleetSummary = {
  totalRunners: 0,
  approvedCount: 0,
  pendingCount: 0,
  suspendedCount: 0,
  onlineNowCount: 0,
  activeRunsCount: 0,
  unclaimedRunsCount: 0,
  completedAwaitingSettleCount: 0,
  requireApprovalGate: false,
};

function formatRelativeTime(iso?: string | null): string {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "Just now";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return iso.slice(0, 10);
}

function formatDurationMinutes(mins: number): string {
  if (!Number.isFinite(mins) || mins < 1) return "<1m";
  if (mins < 60) return `${Math.floor(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.floor(mins % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function approvalBadge(status: ApprovalStatus) {
  switch (status) {
    case "pending":
      return { label: "Pending", cls: "bg-amber-100 text-amber-900 border-amber-200" };
    case "suspended":
      return { label: "Suspended", cls: "bg-red-100 text-red-800 border-red-200" };
    default:
      return { label: "Approved", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" };
  }
}

function runStatusBadge(status: string) {
  switch (status) {
    case "claimed":
      return "bg-blue-100 text-blue-800";
    case "in_progress":
      return "bg-amber-100 text-amber-900";
    case "delivering":
      return "bg-violet-100 text-violet-900";
    case "completed":
      return "bg-emerald-100 text-emerald-900";
    case "settled":
      return "bg-slate-200 text-slate-700";
    case "below_threshold":
      return "bg-orange-100 text-orange-900";
    default:
      return "bg-emerald-50 text-emerald-800";
  }
}

export default function AdminRunnersPage() {
  const [tab, setTab] = useState<ConsoleTab>("fleet");
  const [summary, setSummary] = useState<FleetSummary>(EMPTY_SUMMARY);
  const [runners, setRunners] = useState<AdminRunnerRow[]>([]);
  const [runs, setRuns] = useState<AdminRunRow[]>([]);
  const [pricing, setPricing] = useState<PricingConfigDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Fleet state
  const [search, setSearch] = useState("");
  const [fleetFilter, setFleetFilter] = useState<FleetFilter>("all");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [busyRunnerId, setBusyRunnerId] = useState<string | null>(null);

  // Dispatch state
  const [dispatchFilter, setDispatchFilter] = useState<DispatchFilter>("all");
  const [generatingRuns, setGeneratingRuns] = useState(false);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [confirmRelease, setConfirmRelease] = useState<{
    runId: string;
    pickedUpStops: number;
    message: string;
  } | null>(null);

  // Pricing state
  const [savingPricing, setSavingPricing] = useState(false);
  const [repricingRuns, setRepricingRuns] = useState(false);
  const [showAdvancedPricing, setShowAdvancedPricing] = useState(false);
  const [simContainers, setSimContainers] = useState("1000");
  const [simDistanceKm, setSimDistanceKm] = useState("8");
  const [simStops, setSimStops] = useState("12");
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<PricingSimResult | null>(null);

  const loadAll = useCallback(() => {
    const token = localStorage.getItem("goodsort_token");
    if (!token) {
      setErr("Please log in first at /login");
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    const headers = { Authorization: `Bearer ${token}` };

    Promise.all([
      fetch(apiUrl("/api/admin/runners?limit=500"), { headers }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch(apiUrl("/api/admin/marketplace/runs"), { headers }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch(apiUrl("/api/admin/pricing"), { headers }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
    ])
      .then(([fleetData, runsData, pricingData]) => {
        if (fleetData?.summary) setSummary(fleetData.summary);
        const list: AdminRunnerRow[] = Array.isArray(fleetData?.runners) ? fleetData.runners : [];
        setRunners(list);
        setNoteDrafts((prev) => {
          const next = { ...prev };
          for (const r of list) {
            if (next[r.id] === undefined) next[r.id] = r.adminNote ?? "";
          }
          return next;
        });
        setRuns(Array.isArray(runsData) ? runsData : []);
        if (pricingData) setPricing(pricingData);
      })
      .catch((e) => {
        setErr(
          e === 401 || e === 403
            ? "Admin sign-in required to manage runners, dispatch, and pricing."
            : `Failed to load fleet console (HTTP ${e}).`
        );
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const filteredRunners = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return runners.filter((r) => {
      if (needle) {
        const hay = [
          r.name,
          r.email ?? "",
          r.vehicleType,
          r.vehicleMake,
          r.vehicleRego,
          r.coexSchemeId ?? "",
          r.adminNote ?? "",
          r.suburb ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      switch (fleetFilter) {
        case "online":
          return r.isOnline;
        case "on_run":
          return r.activeRun !== null;
        case "approved":
          return r.approvalStatus === "approved";
        case "pending":
          return r.approvalStatus === "pending";
        case "suspended":
          return r.approvalStatus === "suspended";
        default:
          return true;
      }
    });
  }, [runners, search, fleetFilter]);

  const filteredRuns = useMemo(() => {
    return runs.filter((r) => {
      switch (dispatchFilter) {
        case "active":
          return r.status === "claimed" || r.status === "in_progress" || r.status === "delivering";
        case "open":
          return r.status === "available" || r.status === "below_threshold";
        case "completed":
          return r.status === "completed";
        case "settled":
          return r.status === "settled";
        default:
          return true;
      }
    });
  }, [runs, dispatchFilter]);

  async function updateRunnerStatus(
    runner: AdminRunnerRow,
    nextStatus: ApprovalStatus,
    options?: { releaseActiveRun?: boolean; forceEvenIfPickedUp?: boolean }
  ) {
    const token = localStorage.getItem("goodsort_token");
    if (!token) return;
    setBusyRunnerId(runner.id);
    setErr(null);
    setBanner(null);
    try {
      const res = await fetch(apiUrl(`/api/admin/runners/${runner.id}/status`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          status: nextStatus,
          adminNote: noteDrafts[runner.id] ?? runner.adminNote ?? "",
          releaseActiveRun: options?.releaseActiveRun ?? false,
          forceEvenIfPickedUp: options?.forceEvenIfPickedUp ?? false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data?.requiresConfirmation && data?.activeRunId) {
        setConfirmRelease({
          runId: data.activeRunId,
          pickedUpStops: data.pickedUpStops ?? 1,
          message: data.error || "Runner has stops already picked up. Confirm force-release on Dispatch tab.",
        });
        setTab("dispatch");
        setDispatchFilter("active");
        return;
      }
      if (!res.ok) {
        setErr(data?.error || `Failed to update runner (HTTP ${res.status}).`);
        return;
      }
      const releasedMsg = data?.releasedRunId ? " Active run was also force-released." : "";
      setBanner(`${runner.name} is now ${nextStatus}.${releasedMsg}`);
      loadAll();
    } catch {
      setErr("Network error while updating runner.");
    } finally {
      setBusyRunnerId(null);
    }
  }

  async function forceReleaseRun(runId: string, forceEvenIfPickedUp = false) {
    const token = localStorage.getItem("goodsort_token");
    if (!token) return;
    setBusyRunId(runId);
    setErr(null);
    setBanner(null);
    try {
      const res = await fetch(apiUrl(`/api/admin/marketplace/runs/${runId}/force-release`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ forceEvenIfPickedUp }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data?.requiresConfirmation) {
        setConfirmRelease({
          runId,
          pickedUpStops: data.pickedUpStops ?? 1,
          message:
            data.error ||
            "This run already has stops marked picked up. Confirm to reset stops and kerb bags back to open dispatch.",
        });
        setTab("dispatch");
        return;
      }
      if (!res.ok) {
        setErr(data?.error || `Force-release failed (HTTP ${res.status}).`);
        return;
      }
      setConfirmRelease(null);
      setBanner(
        `Force-released run from ${data.previousStatus} → ${data.status} (${data.resetStops ?? 0} stop(s) reset, ${data.perContainerCents}¢/can · $${((data.estimatedPayoutCents ?? 0) / 100).toFixed(2)} est.).`
      );
      loadAll();
    } catch {
      setErr("Network error while force-releasing run.");
    } finally {
      setBusyRunId(null);
    }
  }

  async function publishRun(runId: string) {
    const token = localStorage.getItem("goodsort_token");
    if (!token) return;
    setBusyRunId(runId);
    setErr(null);
    setBanner(null);
    try {
      const res = await fetch(apiUrl(`/api/admin/marketplace/runs/${runId}/publish`), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.error || `Publish failed (HTTP ${res.status}).`);
        return;
      }
      setBanner("Published pilot run to the Runner marketplace (/runner).");
      loadAll();
    } catch {
      setErr("Network error while publishing run.");
    } finally {
      setBusyRunId(null);
    }
  }

  async function generateRunsNow() {
    const token = localStorage.getItem("goodsort_token");
    if (!token) return;
    setGeneratingRuns(true);
    setErr(null);
    setBanner(null);
    try {
      const res = await fetch(apiUrl("/api/admin/marketplace/runs/generate"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.error || `Run generation failed (HTTP ${res.status}).`);
        return;
      }
      setBanner(
        data?.acquiredLease === false
          ? "Another run-generation sweep is already running. Refresh in a few seconds."
          : `Run generation complete (${data?.availableRuns ?? 0} open · ${data?.pilotRuns ?? 0} pilot).`
      );
      loadAll();
    } catch {
      setErr("Network error while generating runs.");
    } finally {
      setGeneratingRuns(false);
    }
  }

  async function savePricing(e: React.FormEvent) {
    e.preventDefault();
    if (!pricing) return;
    const token = localStorage.getItem("goodsort_token");
    if (!token) return;
    setSavingPricing(true);
    setErr(null);
    setBanner(null);
    try {
      const res = await fetch(apiUrl("/api/admin/pricing"), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(pricing),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.error || `Could not save pricing (HTTP ${res.status}).`);
        return;
      }
      setPricing(data);
      setBanner("Saved live runner pricing bounds. Click Re-price open runs to apply immediately to unclaimed runs.");
    } catch {
      setErr("Network error while saving pricing.");
    } finally {
      setSavingPricing(false);
    }
  }

  async function repriceOpenRuns() {
    const token = localStorage.getItem("goodsort_token");
    if (!token) return;
    setRepricingRuns(true);
    setErr(null);
    setBanner(null);
    try {
      const res = await fetch(apiUrl("/api/admin/pricing/reprice"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.error || `Re-price failed (HTTP ${res.status}).`);
        return;
      }
      setBanner(`Re-priced ${data?.repricedRuns ?? 0} open unclaimed run(s) using current bounds.`);
      loadAll();
    } catch {
      setErr("Network error while re-pricing runs.");
    } finally {
      setRepricingRuns(false);
    }
  }

  async function runSimulator(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("goodsort_token");
    if (!token) return;
    setSimulating(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl("/api/admin/pricing/simulate"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          containers: Number.parseInt(simContainers, 10) || 0,
          distanceKm: Number.parseFloat(simDistanceKm) || 0,
          stopCount: Number.parseInt(simStops, 10) || 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.error || `Simulation failed (HTTP ${res.status}).`);
        return;
      }
      setSimResult(data);
    } catch {
      setErr("Network error while simulating pricing.");
    } finally {
      setSimulating(false);
    }
  }

  function updatePricingNumber<K extends keyof PricingConfigDto>(key: K, raw: string, isFloat = false) {
    setPricing((prev) => {
      if (!prev) return prev;
      const num = isFloat ? Number.parseFloat(raw) : Number.parseInt(raw, 10);
      return { ...prev, [key]: Number.isFinite(num) ? num : 0 };
    });
  }

  const maxBonus = pricing
    ? Math.max(pricing.bronzeBonus, pricing.silverBonus, pricing.goldBonus, pricing.platinumBonus)
    : 0;
  const effectiveMaxCents = pricing ? pricing.ceilingCents + maxBonus : 0;
  const baseMarginCents = pricing ? 7.68 - pricing.baseCents : 4.68;
  const weightSum = pricing
    ? pricing.distanceEfficiencyWeight +
      pricing.binDensityWeight +
      pricing.supplyDemandWeight +
      pricing.timeOfDayWeight +
      pricing.materialMixWeight +
      pricing.scrapPriceWeight
    : 1;

  return (
    <div className="min-h-dvh bg-slate-50 pb-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 min-h-[44px] px-1 -ml-1 text-[13px] font-semibold text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="w-4 h-4" /> Back to admin
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadAll}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button
              type="button"
              onClick={generateRunsNow}
              disabled={generatingRuns}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" /> {generatingRuns ? "Generating..." : "Generate runs"}
            </button>
          </div>
        </div>

        <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-1">Runners &amp; Dispatch</h1>
        <p className="text-[13px] text-slate-500 mb-5">
          Approve or suspend runners, recover stuck runs, and tune dynamic payout bounds under the 17.68¢ COEX CRP cap.
        </p>

        {banner && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 text-[13px] text-emerald-900 mb-4 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>{banner}</span>
          </div>
        )}
        {err && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 text-[13px] text-red-700 mb-4 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{err}</span>
          </div>
        )}

        {/* Top KPI Strip (3x2 mobile, 6-col desktop — short non-truncating labels) */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5 mb-5">
          <FleetKpi
            label="Runners"
            value={summary.totalRunners}
            active={tab === "fleet" && fleetFilter === "all"}
            onClick={() => {
              setTab("fleet");
              setFleetFilter("all");
            }}
          />
          <FleetKpi
            label="Online"
            value={summary.onlineNowCount}
            accent="emerald"
            active={tab === "fleet" && fleetFilter === "online"}
            onClick={() => {
              setTab("fleet");
              setFleetFilter("online");
            }}
          />
          <FleetKpi
            label="Active"
            value={summary.activeRunsCount}
            accent="blue"
            active={tab === "dispatch" && dispatchFilter === "active"}
            onClick={() => {
              setTab("dispatch");
              setDispatchFilter("active");
            }}
          />
          <FleetKpi
            label="Open"
            value={summary.unclaimedRunsCount}
            accent="amber"
            active={tab === "dispatch" && dispatchFilter === "open"}
            onClick={() => {
              setTab("dispatch");
              setDispatchFilter("open");
            }}
          />
          <FleetKpi
            label="Suspended"
            value={summary.suspendedCount}
            accent={summary.suspendedCount > 0 ? "red" : undefined}
            active={tab === "fleet" && fleetFilter === "suspended"}
            onClick={() => {
              setTab("fleet");
              setFleetFilter("suspended");
            }}
          />
          <FleetKpi
            label="Rate band"
            value={pricing ? `${pricing.floorCents}–${pricing.ceilingCents}¢` : "—"}
            active={tab === "pricing"}
            onClick={() => setTab("pricing")}
          />
        </div>

        {/* 3-Tab Segmented Switcher */}
        <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-slate-200/70 p-1.5 mb-5">
          {(
            [
              { key: "fleet", label: "Fleet", icon: ShieldCheck },
              { key: "dispatch", label: "Dispatch", icon: Truck },
              { key: "pricing", label: "Pricing", icon: Sliders },
            ] as const
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`min-h-[44px] rounded-xl px-2 py-2 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-all ${
                tab === key
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>

        {/* ── TAB 1: FLEET ROSTER ── */}
        {tab === "fleet" && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white border border-slate-200 p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  {summary.requireApprovalGate
                    ? "Manual approval gate ON (RUNNER_REQUIRE_APPROVAL=true): new signups wait in Pending until approved."
                    : "Self-serve onboarding active: suspend any runner here to immediately block claims and online heartbeats."}
                </span>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search runner, rego, COEX ID..."
                  aria-label="Search runners"
                  className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-base text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { key: "all", label: `All (${summary.totalRunners})` },
                    { key: "online", label: `Online (${summary.onlineNowCount})` },
                    { key: "on_run", label: `On run (${runners.filter((r) => r.activeRun).length})` },
                    { key: "approved", label: `Approved (${summary.approvedCount})` },
                    { key: "pending", label: `Pending (${summary.pendingCount})` },
                    { key: "suspended", label: `Suspended (${summary.suspendedCount})` },
                  ] as const
                ).map((pill) => (
                  <button
                    key={pill.key}
                    type="button"
                    onClick={() => setFleetFilter(pill.key)}
                    className={`min-h-[36px] px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                      fleetFilter === pill.key
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredRunners.length === 0 ? (
              <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
                <Truck className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700">No runners match these filters.</p>
                <p className="text-xs text-slate-400 mt-1">
                  Drivers who register at <code className="font-mono">/runner/signup</code> appear here immediately.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredRunners.map((r) => {
                  const badge = approvalBadge(r.approvalStatus);
                  const isBusy = busyRunnerId === r.id;
                  const noteValue = noteDrafts[r.id] ?? r.adminNote ?? "";
                  const noteDirty = noteValue.trim() !== (r.adminNote ?? "").trim();
                  return (
                    <div key={r.id} className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3 shadow-sm">
                      {/* Identity & Status */}
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[15px] font-bold text-slate-900 truncate">{r.name}</p>
                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${badge.cls}`}>
                              {badge.label}
                            </span>
                            {r.isOnline ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                Online
                              </span>
                            ) : (
                              <span className="text-[11px] font-medium text-slate-400">
                                Last seen {formatRelativeTime(r.lastLocationAt)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 truncate mt-0.5">
                            {r.email || "No email"}
                            {r.suburb ? ` · ${titleSuburb(r.suburb)}` : ""}
                          </p>
                        </div>
                        <Link
                          href={`/admin/users?user=${r.profileId}`}
                          className="inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-slate-700 shrink-0"
                        >
                          CRM <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>

                      {/* Vehicle & Readiness Chips */}
                      <div className="flex flex-wrap gap-1.5 text-[11px]">
                        <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 font-semibold">
                          {r.vehicleType}
                          {r.vehicleMake ? ` · ${r.vehicleMake}` : ""}
                          {r.vehicleRego ? ` (${r.vehicleRego})` : ""}
                        </span>
                        <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-medium">
                          {r.capacityBags} bags · {r.serviceRadiusKm} km
                        </span>
                        {r.coexSchemeId && (
                          <span className="px-2.5 py-1 rounded-lg bg-violet-50 text-violet-800 font-mono font-semibold">
                            COEX {r.coexSchemeId}
                          </span>
                        )}
                        <span
                          className={`px-2.5 py-1 rounded-lg font-semibold ${
                            r.hasPayoutDetails
                              ? "bg-emerald-50 text-emerald-800"
                              : "bg-amber-50 text-amber-800"
                          }`}
                        >
                          {r.hasPayoutDetails ? `Payout ready (${r.preferredPayoutMethod || "saved"})` : "No PayID/bank"}
                        </span>
                      </div>

                      {/* Stats Strip */}
                      <div className="grid grid-cols-4 gap-2 pt-2 border-t border-slate-100">
                        <div>
                          <p className="text-[10px] font-bold uppercase text-slate-400">Level</p>
                          <p className="text-xs font-bold text-slate-900 capitalize mt-0.5">{r.level}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase text-slate-400">Rating</p>
                          <p className="text-xs font-bold text-slate-900 mt-0.5 inline-flex items-center gap-0.5 tabular-nums">
                            {r.rating.toFixed(1)} <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase text-slate-400">Runs / Cans</p>
                          <p className="text-xs font-bold text-slate-900 mt-0.5 tabular-nums">
                            {r.totalRuns} / {r.totalContainersCollected}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase text-slate-400">Earned</p>
                          <p className="text-xs font-bold text-emerald-700 mt-0.5 tabular-nums">
                            ${(r.lifetimeEarningsCents / 100).toFixed(2)}
                          </p>
                        </div>
                      </div>

                      {/* Active Run Highlight */}
                      {r.activeRun && (
                        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-amber-950">
                              Active run: {r.activeRun.areaName} ({r.activeRun.status})
                            </p>
                            <p className="text-[11px] text-amber-800 mt-0.5">
                              {r.activeRun.pickedUpStops}/{r.activeRun.stopCount} stops · ~{r.activeRun.estimatedContainers} cans ·{" "}
                              {formatDurationMinutes(r.activeRun.stuckMinutes)} elapsed
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={busyRunId === r.activeRun.id}
                            onClick={() => forceReleaseRun(r.activeRun!.id)}
                            className="inline-flex items-center gap-1 min-h-[36px] px-3 py-1.5 rounded-lg bg-amber-900 hover:bg-slate-900 text-white text-xs font-bold disabled:opacity-50 shrink-0"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            {busyRunId === r.activeRun.id ? "Releasing..." : "Force-release"}
                          </button>
                        </div>
                      )}

                      {/* Ops Note + Approve / Suspend Controls */}
                      <div className="pt-2 border-t border-slate-100 space-y-2.5">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            maxLength={280}
                            value={noteValue}
                            onChange={(e) =>
                              setNoteDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))
                            }
                            placeholder="Ops note (e.g. Uber XL van, ABN checked, pause reason)"
                            aria-label={`Ops note for ${r.name}`}
                            className="flex-1 min-w-0 min-h-[42px] px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-base text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-emerald-500"
                          />
                          {noteDirty && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => updateRunnerStatus(r, r.approvalStatus)}
                              className="min-h-[42px] px-3 rounded-xl bg-slate-900 text-white text-xs font-bold shrink-0 disabled:opacity-50"
                            >
                              Save note
                            </button>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {r.approvalStatus !== "approved" && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => updateRunnerStatus(r, "approved")}
                              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              {isBusy
                                ? "Updating..."
                                : r.approvalStatus === "suspended"
                                  ? "Reinstate runner"
                                  : "Approve runner"}
                            </button>
                          )}
                          {r.approvalStatus !== "suspended" && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => updateRunnerStatus(r, "suspended")}
                              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 py-2 rounded-xl bg-white border border-red-200 hover:bg-red-50 text-red-700 text-xs font-bold disabled:opacity-50"
                            >
                              <PauseCircle className="w-4 h-4" />
                              {isBusy ? "Updating..." : "Suspend runner"}
                            </button>
                          )}
                          {r.approvalStatus !== "suspended" && r.activeRun && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => updateRunnerStatus(r, "suspended", { releaseActiveRun: true })}
                              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold disabled:opacity-50"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Suspend &amp; release run
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── TAB 2: DISPATCH & STUCK RUN RECOVERY ── */}
        {tab === "dispatch" && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white border border-slate-200 p-3.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { key: "all", label: `All (${runs.length})` },
                    {
                      key: "active",
                      label: `Active (${runs.filter((r) => ["claimed", "in_progress", "delivering"].includes(r.status)).length})`,
                    },
                    {
                      key: "open",
                      label: `Open (${runs.filter((r) => ["available", "below_threshold"].includes(r.status)).length})`,
                    },
                    {
                      key: "completed",
                      label: `Completed (${runs.filter((r) => r.status === "completed").length})`,
                    },
                    {
                      key: "settled",
                      label: `Settled (${runs.filter((r) => r.status === "settled").length})`,
                    },
                  ] as const
                ).map((pill) => (
                  <button
                    key={pill.key}
                    type="button"
                    onClick={() => setDispatchFilter(pill.key)}
                    className={`min-h-[36px] px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                      dispatchFilter === pill.key
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>
              <Link
                href="/admin/pickups"
                className="inline-flex items-center gap-1 min-h-[36px] px-3 rounded-lg bg-emerald-50 text-emerald-800 text-xs font-bold"
              >
                Pickups &amp; Settle <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>

            {filteredRuns.length === 0 ? (
              <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
                <Truck className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700">No runs in this view.</p>
                <p className="text-xs text-slate-400 mt-1">
                  Click Generate runs above once a suburb has active collecting households.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredRuns.map((r) => {
                  const isActive = r.status === "claimed" || r.status === "in_progress" || r.status === "delivering";
                  const isStuck = isActive && r.stuckMinutes >= 90;
                  const needsConfirm = confirmRelease?.runId === r.id;
                  const busy = busyRunId === r.id;
                  return (
                    <div
                      key={r.id}
                      className={`rounded-2xl bg-white border p-4 space-y-3 shadow-sm ${
                        isStuck ? "border-red-300 bg-red-50/20" : "border-slate-200"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[15px] font-bold text-slate-900">{r.areaName}</p>
                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${runStatusBadge(r.status)}`}>
                              {r.status}
                            </span>
                            {isActive && (
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                  isStuck ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                <Clock className="w-3 h-3" />
                                {isStuck ? `Stuck ${formatDurationMinutes(r.stuckMinutes)}` : formatDurationMinutes(r.stuckMinutes)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-1">
                            ~{r.estimatedContainers} cans · {r.pickedUpStops}/{r.stopCount} stops · {r.perContainerCents}¢/can ·{" "}
                            <strong className="text-slate-900">${(r.estimatedPayoutCents / 100).toFixed(2)}</strong> est.
                            {r.dropPointName ? ` · ${r.dropPointName}` : ""}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {r.runnerName ? (
                              <>
                                Runner: <strong className="text-slate-800">{r.runnerName}</strong>
                                {r.runnerEmail ? ` (${r.runnerEmail})` : ""}
                                {r.runnerVehicleType ? ` · ${r.runnerVehicleType}` : ""}
                                {r.runnerVehicleRego ? ` ${r.runnerVehicleRego}` : ""}
                                {r.runnerApprovalStatus === "suspended" && (
                                  <span className="ml-1.5 text-red-700 font-bold">[SUSPENDED]</span>
                                )}
                              </>
                            ) : (
                              "Unclaimed"
                            )}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {r.status === "below_threshold" && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => publishRun(r.id)}
                              className="min-h-[40px] px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold disabled:opacity-50"
                            >
                              {busy ? "Publishing..." : "Publish"}
                            </button>
                          )}
                          {isActive && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => forceReleaseRun(r.id, false)}
                              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold disabled:opacity-50"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              {busy ? "Releasing..." : "Force-release"}
                            </button>
                          )}
                          {r.status === "completed" && (
                            <Link
                              href="/admin/pickups"
                              className="inline-flex items-center gap-1 min-h-[40px] px-3.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold"
                            >
                              Verify &amp; Settle →
                            </Link>
                          )}
                        </div>
                      </div>

                      {needsConfirm && confirmRelease && (
                        <div className="rounded-xl bg-red-50 border border-red-200 p-3 space-y-2">
                          <p className="text-xs font-semibold text-red-900">{confirmRelease.message}</p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => forceReleaseRun(r.id, true)}
                              className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold disabled:opacity-50"
                            >
                              Confirm force-release ({confirmRelease.pickedUpStops} picked-up stop
                              {confirmRelease.pickedUpStops === 1 ? "" : "s"})
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmRelease(null)}
                              className="min-h-[40px] px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── TAB 3: DYNAMIC PRICING CONTROLS + SIMULATOR ── */}
        {tab === "pricing" && (
          <div className="space-y-4">
            {!pricing ? (
              <div className="rounded-2xl bg-white border border-slate-200 p-6 text-sm text-slate-500">
                Sign in as admin to view and edit live runner pricing bounds.
              </div>
            ) : (
              <>
                {/* COEX CRP Unit Economics Guardrail */}
                <div
                  className={`rounded-2xl p-4 border ${
                    effectiveMaxCents > 7
                      ? "bg-amber-50 border-amber-300 text-amber-950"
                      : "bg-slate-900 border-slate-900 text-white"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <p className="text-[11px] font-bold uppercase tracking-wider opacity-75">
                      COEX 17.68¢ CRP Margin Guardrail
                    </p>
                    <span className="text-xs font-bold tabular-nums">
                      Effective max: {effectiveMaxCents}¢/can
                    </span>
                  </div>
                  <p className="text-sm font-bold">
                    17.68¢ gross − 10.00¢ sorter − 0¢ referrals − {pricing.baseCents}¢ base runner ={" "}
                    <span className={baseMarginCents < 1 ? "text-red-400" : "text-emerald-400"}>
                      {baseMarginCents >= 0 ? "+" : ""}
                      {baseMarginCents.toFixed(2)}¢/can
                    </span>{" "}
                    CRP margin
                  </p>
                  <p className="text-xs opacity-75 mt-1">
                    1,000-container suburb run pays{" "}
                    <strong>${((pricing.baseCents * 1000) / 100).toFixed(2)}</strong> at base (
                    <strong>${((pricing.floorCents * 1000) / 100).toFixed(2)}</strong>–
                    <strong>${((effectiveMaxCents * 1000) / 100).toFixed(2)}</strong> range incl. level bonus).
                  </p>
                </div>

                {/* Pricing Form */}
                <form onSubmit={savePricing} className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 space-y-5">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                      Per-container rate bounds (cents)
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      <NumField
                        label="Floor (¢)"
                        value={pricing.floorCents}
                        min={0}
                        max={100}
                        onChange={(v) => updatePricingNumber("floorCents", v)}
                      />
                      <NumField
                        label="Base (¢)"
                        value={pricing.baseCents}
                        min={0}
                        max={100}
                        onChange={(v) => updatePricingNumber("baseCents", v)}
                      />
                      <NumField
                        label="Ceiling (¢)"
                        value={pricing.ceilingCents}
                        min={0}
                        max={100}
                        onChange={(v) => updatePricingNumber("ceilingCents", v)}
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100">
                    <div className="flex flex-wrap items-center justify-between gap-1 mb-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        Runner level bonuses (cents, added after ceiling)
                      </p>
                      <span className="text-[11px] text-slate-500 tabular-nums">
                        Max payout: {effectiveMaxCents}¢/can
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <NumField
                        label="Bronze (+¢)"
                        value={pricing.bronzeBonus}
                        min={0}
                        max={50}
                        onChange={(v) => updatePricingNumber("bronzeBonus", v)}
                      />
                      <NumField
                        label="Silver (+¢)"
                        value={pricing.silverBonus}
                        min={0}
                        max={50}
                        onChange={(v) => updatePricingNumber("silverBonus", v)}
                      />
                      <NumField
                        label="Gold (+¢)"
                        value={pricing.goldBonus}
                        min={0}
                        max={50}
                        onChange={(v) => updatePricingNumber("goldBonus", v)}
                      />
                      <NumField
                        label="Platinum (+¢)"
                        value={pricing.platinumBonus}
                        min={0}
                        max={50}
                        onChange={(v) => updatePricingNumber("platinumBonus", v)}
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                      Brisbane time-of-day surge multipliers (0.1–5.0×)
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <NumField
                        label="Morning 6–10"
                        value={pricing.morningSurge}
                        step="0.1"
                        min={0.1}
                        max={5}
                        onChange={(v) => updatePricingNumber("morningSurge", v, true)}
                      />
                      <NumField
                        label="Afternoon 10–4"
                        value={pricing.afternoonNormal}
                        step="0.1"
                        min={0.1}
                        max={5}
                        onChange={(v) => updatePricingNumber("afternoonNormal", v, true)}
                      />
                      <NumField
                        label="Evening 4–7"
                        value={pricing.eveningSurge}
                        step="0.1"
                        min={0.1}
                        max={5}
                        onChange={(v) => updatePricingNumber("eveningSurge", v, true)}
                      />
                      <NumField
                        label="Night 7–6"
                        value={pricing.nightDiscount}
                        step="0.1"
                        min={0.1}
                        max={5}
                        onChange={(v) => updatePricingNumber("nightDiscount", v, true)}
                      />
                    </div>
                  </div>

                  {/* Collapsible Advanced Weights & Spot Prices */}
                  <div className="pt-4 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setShowAdvancedPricing((v) => !v)}
                      className="flex items-center justify-between w-full min-h-[44px] text-left text-xs font-bold uppercase tracking-wider text-slate-600"
                    >
                      <span>Advanced factor weights (sum {weightSum.toFixed(2)}) &amp; scrap spot</span>
                      {showAdvancedPricing ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    {showAdvancedPricing && (
                      <div className="mt-3 space-y-4">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          <NumField
                            label="Distance weight"
                            value={pricing.distanceEfficiencyWeight}
                            step="0.05"
                            min={0}
                            max={5}
                            onChange={(v) => updatePricingNumber("distanceEfficiencyWeight", v, true)}
                          />
                          <NumField
                            label="Density weight"
                            value={pricing.binDensityWeight}
                            step="0.05"
                            min={0}
                            max={5}
                            onChange={(v) => updatePricingNumber("binDensityWeight", v, true)}
                          />
                          <NumField
                            label="Supply/demand"
                            value={pricing.supplyDemandWeight}
                            step="0.05"
                            min={0}
                            max={5}
                            onChange={(v) => updatePricingNumber("supplyDemandWeight", v, true)}
                          />
                          <NumField
                            label="Time-of-day"
                            value={pricing.timeOfDayWeight}
                            step="0.05"
                            min={0}
                            max={5}
                            onChange={(v) => updatePricingNumber("timeOfDayWeight", v, true)}
                          />
                          <NumField
                            label="Material mix"
                            value={pricing.materialMixWeight}
                            step="0.05"
                            min={0}
                            max={5}
                            onChange={(v) => updatePricingNumber("materialMixWeight", v, true)}
                          />
                          <NumField
                            label="Scrap weight"
                            value={pricing.scrapPriceWeight}
                            step="0.05"
                            min={0}
                            max={5}
                            onChange={(v) => updatePricingNumber("scrapPriceWeight", v, true)}
                          />
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                          <NumField
                            label="Alu (¢/kg)"
                            value={pricing.aluminiumSpotCents}
                            min={0}
                            max={10000}
                            onChange={(v) => updatePricingNumber("aluminiumSpotCents", v)}
                          />
                          <NumField
                            label="PET (¢/kg)"
                            value={pricing.petSpotCents}
                            min={0}
                            max={10000}
                            onChange={(v) => updatePricingNumber("petSpotCents", v)}
                          />
                          <NumField
                            label="Glass (¢/kg)"
                            value={pricing.glassSpotCents}
                            min={0}
                            max={10000}
                            onChange={(v) => updatePricingNumber("glassSpotCents", v)}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 pt-2">
                    <button
                      type="submit"
                      disabled={savingPricing}
                      className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold disabled:opacity-50"
                    >
                      <DollarSign className="w-4 h-4" />
                      {savingPricing ? "Saving..." : "Save pricing"}
                    </button>
                    <button
                      type="button"
                      disabled={repricingRuns}
                      onClick={repriceOpenRuns}
                      className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-900 text-sm font-bold disabled:opacity-50"
                    >
                      <Zap className="w-4 h-4" />
                      {repricingRuns ? "Re-pricing..." : "Re-price open runs"}
                    </button>
                  </div>
                </form>

                {/* Live Payout Simulator */}
                <form onSubmit={runSimulator} className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 space-y-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Run Payout Simulator
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Test how saved bounds price a suburb run with current live Brisbane supply/demand.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <label className="block">
                      <span className="block text-[11px] font-semibold text-slate-600 mb-1">Containers</span>
                      <input
                        type="number"
                        min={0}
                        max={100000}
                        value={simContainers}
                        onChange={(e) => setSimContainers(e.target.value)}
                        className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-base text-slate-900 tabular-nums"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-[11px] font-semibold text-slate-600 mb-1">Route km</span>
                      <input
                        type="number"
                        min={0}
                        max={1000}
                        step="0.5"
                        value={simDistanceKm}
                        onChange={(e) => setSimDistanceKm(e.target.value)}
                        className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-base text-slate-900 tabular-nums"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-[11px] font-semibold text-slate-600 mb-1">Stops</span>
                      <input
                        type="number"
                        min={0}
                        max={500}
                        value={simStops}
                        onChange={(e) => setSimStops(e.target.value)}
                        className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-base text-slate-900 tabular-nums"
                      />
                    </label>
                  </div>
                  <button
                    type="submit"
                    disabled={simulating}
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-50"
                  >
                    {simulating ? "Simulating..." : "Simulate payout"}
                  </button>

                  {simResult && (
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-xl font-display font-extrabold text-emerald-700 tabular-nums">
                          ${(simResult.estimatedPayoutCents / 100).toFixed(2)}
                        </p>
                        <p className="text-xs font-bold text-slate-700 tabular-nums">
                          {simResult.perContainerCents}¢/can · Tier {simResult.pricingTier} ·{" "}
                          {simResult.factors.weightedMultiplier.toFixed(2)}× multiplier
                        </p>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pt-2 border-t border-slate-200 text-[11px] text-slate-600 tabular-nums">
                        <div>Dist: {simResult.factors.distanceEfficiency.toFixed(2)}</div>
                        <div>Density: {simResult.factors.binDensity.toFixed(2)}</div>
                        <div>Supply: {simResult.factors.supplyDemand.toFixed(2)}</div>
                        <div>Time: {simResult.factors.timeOfDay.toFixed(2)}</div>
                        <div>Mix: {simResult.factors.materialMix.toFixed(2)}</div>
                        <div>Scrap: {simResult.factors.scrapPrice.toFixed(2)}</div>
                      </div>
                    </div>
                  )}
                </form>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FleetKpi({
  label,
  value,
  accent,
  active,
  onClick,
}: {
  label: string;
  value: number | string;
  accent?: "emerald" | "blue" | "amber" | "red";
  active: boolean;
  onClick: () => void;
}) {
  const numColor =
    accent === "emerald"
      ? "text-emerald-700"
      : accent === "blue"
        ? "text-blue-700"
        : accent === "amber"
          ? "text-amber-700"
          : accent === "red"
            ? "text-red-700"
            : "text-slate-900";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-2xl p-3 border transition-all ${
        active ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-200 hover:border-slate-300"
      }`}
    >
      <p className={`text-xl font-display font-extrabold tabular-nums ${active ? "text-white" : numColor}`}>
        {value}
      </p>
      <p className={`text-[10px] font-bold uppercase tracking-wider mt-0.5 truncate ${active ? "text-slate-300" : "text-slate-400"}`}>
        {label}
      </p>
    </button>
  );
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (val: string) => void;
  min?: number;
  max?: number;
  step?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="block text-[11px] font-semibold text-slate-600 mb-1 truncate">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-base text-slate-900 tabular-nums focus:bg-white focus:outline-none focus:border-emerald-500"
      />
    </label>
  );
}
