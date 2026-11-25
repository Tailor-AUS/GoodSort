"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap, Marker as MLMarker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  MapPin,
  Package,
  RefreshCw,
  Search,
  Users,
  X,
} from "lucide-react";
import { apiUrl } from "@/lib/config";
import { titleSuburb } from "@/lib/brisbane";

interface Household {
  id: string;
  name: string;
  address: string;
  suburb?: string | null;
  type?: string | null;
  binStatus?: string | null;
  binIsOut?: boolean;
  lat: number;
  lng: number;
  pendingContainers: number;
  pendingValueCents: number;
}

interface AdminUser {
  id: string;
  email: string | null;
  name: string;
  role: string;
  isAdmin?: boolean;
  isRunner?: boolean;
  totalContainers: number;
  pendingCents: number;
  clearedCents: number;
  createdAt: string;
  lastScanAt?: string | null;
  scansLast7d?: number;
  scanCount?: number;
  suburb?: string | null;
  hasAddress?: boolean;
  hasPayoutDetails?: boolean;
  preferredPayoutMethod?: string | null;
  bagsCount?: number;
  bagsOnKerbCount?: number;
  referrerId?: string | null;
  referrerLabel?: string | null;
  referralsCount?: number;
  networkPoints?: number;
  statusTag?: string;
  household: Household | null;
}

interface UserDetail {
  id: string;
  name: string;
  email: string | null;
  role: string;
  isAdmin: boolean;
  totalContainers: number;
  pendingCents: number;
  clearedCents: number;
  totalCo2SavedKg: number;
  createdAt: string;
  lastScanAt: string | null;
  household: (Household & { councilCollectionDay?: number | null }) | null;
  payout: {
    hasPayoutDetails: boolean;
    preferredPayoutMethod: string | null;
    payIdType: string | null;
    payIdValue: string | null;
    bankBsb: string | null;
    bankAccountMasked: string | null;
    bankAccountName: string | null;
    payoutUpdatedAt: string | null;
  };
  referrer: { id: string; name: string; email: string | null } | null;
  referrals: Array<{
    id: string;
    name: string;
    email: string | null;
    suburb: string | null;
    totalContainers: number;
    createdAt: string;
  }>;
  materialCounts: Array<{ material: string; count: number }>;
  recentScans: Array<{
    id: string;
    containerName: string;
    material: string;
    barcode: string;
    refundCents: number;
    status: string;
    sortedBagId: string | null;
    createdAt: string;
  }>;
  bags: Array<{
    id: string;
    code: string;
    stream: string;
    declaredContainers: number;
    linkedScanCount: number;
    verifiedContainers: number | null;
    status: string;
    createdAt: string;
  }>;
  cashouts: Array<{
    id: string;
    amountCents: number;
    payoutMethod: string;
    status: string;
    createdAt: string;
  }>;
  syndicate: {
    syndicateId: string;
    buildingName: string;
    suburb: string | null;
    anonHandle: string;
    role: string;
    status: string;
  } | null;
}

interface Bin {
  id: string;
  code: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  pendingContainers: number;
  pendingValueCents: number;
}

type FilterKey = "all" | "no_address" | "no_payout" | "zero_scans" | "active_7d" | "referred" | "runners";

const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const BRISBANE: [number, number] = [153.021, -27.482]; // [lng, lat]

function createPopupDom(lines: Array<{ text: string; bold?: boolean; color?: string }>): HTMLDivElement {
  const root = document.createElement("div");
  root.style.cssText = "font-family:system-ui;font-size:13px";
  lines.forEach((line, idx) => {
    if (idx > 0) root.appendChild(document.createElement("br"));
    const span = document.createElement(line.bold ? "b" : "span");
    if (line.color) span.style.color = line.color;
    span.textContent = line.text;
    root.appendChild(span);
  });
  return root;
}

function binMarkerEl(count: number): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "line-height:0;cursor:pointer";
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#16a34a" stroke="#fff" stroke-width="2"/><text x="16" y="20" text-anchor="middle" fill="#fff" font-size="11" font-weight="700">${safeCount}</text></svg>`;
  return el;
}

function householdMarkerEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "line-height:0;cursor:pointer";
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><circle cx="11" cy="11" r="9" fill="#0f172a" stroke="#fff" stroke-width="2"/><circle cx="11" cy="11" r="3.5" fill="#34d399"/></svg>`;
  return el;
}

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

function csvCell(val: unknown): string {
  const raw = String(val ?? "");
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function statusPill(tag?: string) {
  switch (tag) {
    case "admin":
      return { label: "Admin", cls: "bg-slate-900 text-white" };
    case "needs_address":
      return { label: "Needs address", cls: "bg-amber-100 text-amber-900" };
    case "no_scans":
      return { label: "0 scans", cls: "bg-slate-100 text-slate-600" };
    case "needs_payout":
      return { label: "Needs PayID", cls: "bg-violet-100 text-violet-900" };
    default:
      return { label: "Active", cls: "bg-emerald-100 text-emerald-800" };
  }
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [bins, setBins] = useState<Bin[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [suburbFilter, setSuburbFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterKey>("all");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markersRef = useRef<MLMarker[]>([]);

  function loadAll() {
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
      fetch(apiUrl("/api/admin/users?limit=1000"), { headers }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch(apiUrl("/api/bins"), { headers }).then(r => r.ok ? r.json() : Promise.reject(r.status)),
    ])
      .then(([u, b]) => {
        setUsers(Array.isArray(u) ? u : []);
        setBins(Array.isArray(b) ? b : []);
      })
      .catch((e) => setErr(e === 401 || e === 403 ? "Admin sign-in required to view users." : `Failed to load: ${e}`))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadAll();
    if (typeof window !== "undefined") {
      const uid = new URLSearchParams(window.location.search).get("user");
      if (uid) setSelectedUserId(uid);
    }
  }, []);

  useEffect(() => {
    if (!selectedUserId) {
      setUserDetail(null);
      setDetailErr(null);
      return;
    }
    const token = localStorage.getItem("goodsort_token");
    if (!token) return;
    let cancelled = false;
    setDetailLoading(true);
    setDetailErr(null);
    fetch(apiUrl(`/api/admin/users/${selectedUserId}`), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: UserDetail) => {
        if (!cancelled) setUserDetail(d);
      })
      .catch((e) => {
        if (!cancelled) setDetailErr(`Could not load member detail (HTTP ${e}).`);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedUserId]);

  useEffect(() => {
    if (!selectedUserId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedUserId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedUserId]);

  const availableSuburbs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const u of users) {
      if (u.suburb) counts.set(u.suburb, (counts.get(u.suburb) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [users]);

  const summary = useMemo(() => {
    let noAddress = 0;
    let noPayout = 0;
    let zeroScans = 0;
    let active7d = 0;
    let referred = 0;
    let runners = 0;
    for (const u of users) {
      if (!u.isAdmin && !u.hasAddress) noAddress++;
      if (!u.isAdmin && !u.hasPayoutDetails) noPayout++;
      if (!u.isAdmin && u.totalContainers === 0) zeroScans++;
      if ((u.scansLast7d ?? 0) > 0) active7d++;
      if (u.referrerId || (u.referralsCount ?? 0) > 0) referred++;
      if (u.isRunner) runners++;
    }
    return { total: users.length, noAddress, noPayout, zeroScans, active7d, referred, runners };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (suburbFilter && u.suburb !== suburbFilter) return false;
      if (statusFilter === "no_address" && (u.hasAddress || u.isAdmin)) return false;
      if (statusFilter === "no_payout" && (u.hasPayoutDetails || u.isAdmin)) return false;
      if (statusFilter === "zero_scans" && (u.totalContainers > 0 || u.isAdmin)) return false;
      if (statusFilter === "active_7d" && (u.scansLast7d ?? 0) === 0) return false;
      if (statusFilter === "referred" && !u.referrerId && (u.referralsCount ?? 0) === 0) return false;
      if (statusFilter === "runners" && !u.isRunner) return false;
      if (q) {
        const hay = [u.email, u.name, u.suburb, u.household?.address, u.referrerLabel]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [users, search, suburbFilter, statusFilter]);

  useEffect(() => {
    if (!mapDiv.current || (filteredUsers.length === 0 && bins.length === 0)) return;
    if (!mapRef.current) {
      if (typeof maplibregl.setWorkerUrl === "function") {
        maplibregl.setWorkerUrl("/maplibre-gl-worker.js");
      }
      const createdMap = new maplibregl.Map({
        container: mapDiv.current,
        style: MAP_STYLE_URL,
        center: BRISBANE,
        zoom: 11,
        attributionControl: { compact: true },
      });
      createdMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      mapRef.current = createdMap;
    }
    const map = mapRef.current;
    if (!map) return;

    function render() {
      if (!map) return;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      const bounds = new maplibregl.LngLatBounds();

      // Bin markers
      bins.forEach((b) => {
        if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng) || (!b.lat && !b.lng)) return;
        const popupEl = createPopupDom([
          { text: `${b.code} — ${b.name}`, bold: true },
          { text: b.address, color: "#666" },
          { text: `${b.pendingContainers} containers pending`, bold: true, color: "#16a34a" },
        ]);
        const marker = new maplibregl.Marker({ element: binMarkerEl(b.pendingContainers), anchor: "center" })
          .setLngLat([b.lng, b.lat])
          .setPopup(new maplibregl.Popup({ offset: 16 }).setDOMContent(popupEl))
          .addTo(map);
        markersRef.current.push(marker);
        bounds.extend([b.lng, b.lat]);
      });

      // Household markers (scoped to active filter)
      const households = new Map<string, { h: Household; emails: string[] }>();
      filteredUsers.forEach((u) => {
        if (!u.household) return;
        const k = u.household.id;
        if (!households.has(k)) households.set(k, { h: u.household, emails: [] });
        if (u.email) households.get(k)!.emails.push(u.email);
      });
      households.forEach(({ h, emails }) => {
        if (!Number.isFinite(h.lat) || !Number.isFinite(h.lng) || (!h.lat && !h.lng)) return;
        const popupEl = createPopupDom([
          { text: h.name || "Household", bold: true },
          { text: h.address, color: "#666" },
          ...emails.map((em) => ({ text: em })),
          { text: `${h.pendingContainers} containers pending`, bold: true, color: "#059669" },
        ]);
        const marker = new maplibregl.Marker({ element: householdMarkerEl(), anchor: "center" })
          .setLngLat([h.lng, h.lat])
          .setPopup(new maplibregl.Popup({ offset: 12 }).setDOMContent(popupEl))
          .addTo(map);
        markersRef.current.push(marker);
        bounds.extend([h.lng, h.lat]);
      });

      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 500 });
    }

    if (map.loaded()) render();
    else map.once("load", render);

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [filteredUsers, bins]);

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; }, []);

  function exportCsv() {
    const header = [
      "Email",
      "Name",
      "Status",
      "Role",
      "Suburb",
      "Address",
      "Containers",
      "Scans7d",
      "LastScanAt",
      "PendingDollars",
      "ClearedDollars",
      "HasPayout",
      "BagsCount",
      "ReferredBy",
      "ReferralsCount",
      "JoinedAt",
    ];
    const rows = filteredUsers.map((u) => [
      u.email ?? "",
      u.name,
      u.statusTag ?? "",
      u.isAdmin ? "admin" : u.role,
      u.suburb ?? "",
      u.household?.address ?? "",
      u.totalContainers,
      u.scansLast7d ?? 0,
      u.lastScanAt ?? "",
      (u.pendingCents / 100).toFixed(2),
      (u.clearedCents / 100).toFixed(2),
      u.hasPayoutDetails ? "yes" : "no",
      u.bagsCount ?? 0,
      u.referrerLabel ?? "",
      u.referralsCount ?? 0,
      u.createdAt,
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `goodsort-users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="min-h-dvh bg-slate-50 pb-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 min-h-[44px] px-1 -ml-1 text-[13px] font-semibold text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="w-4 h-4" /> Back to admin
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadAll}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={filteredUsers.length === 0}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV ({filteredUsers.length})
            </button>
          </div>
        </div>

        <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-1">Users &amp; CRM</h1>
        <p className="text-[13px] text-slate-500 mb-5">
          Tap any member to inspect scans, home bags, PayID readiness, and referrals. Map shows filtered households (obsidian) and collection bins (green).
        </p>

        {err && <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 text-[13px] text-red-700 mb-5">{err}</div>}

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5 mb-5">
          <MiniKpi label="Total" value={summary.total} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
          <MiniKpi label="Active 7d" value={summary.active7d} accent="emerald" active={statusFilter === "active_7d"} onClick={() => setStatusFilter("active_7d")} />
          <MiniKpi label="No address" value={summary.noAddress} accent="amber" active={statusFilter === "no_address"} onClick={() => setStatusFilter("no_address")} />
          <MiniKpi label="No PayID" value={summary.noPayout} accent="violet" active={statusFilter === "no_payout"} onClick={() => setStatusFilter("no_payout")} />
          <MiniKpi label="0 scans" value={summary.zeroScans} active={statusFilter === "zero_scans"} onClick={() => setStatusFilter("zero_scans")} />
          <MiniKpi label="Referred" value={summary.referred} accent="emerald" active={statusFilter === "referred"} onClick={() => setStatusFilter("referred")} />
        </div>

        {/* Search + Suburb Filter Bar */}
        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 mb-5 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                aria-label="Search users by email, name, suburb, address, or referrer"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search email, name, street, suburb, referrer…"
                className="w-full min-h-[44px] pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-500"
              />
            </div>
            <select
              aria-label="Filter users by suburb"
              value={suburbFilter}
              onChange={(e) => setSuburbFilter(e.target.value)}
              className="min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-base text-slate-900 font-medium"
            >
              <option value="">All suburbs ({availableSuburbs.length})</option>
              {availableSuburbs.map(([sub, count]) => (
                <option key={sub} value={sub}>
                  {titleSuburb(sub)} ({count})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: "all", label: `All (${summary.total})` },
                { id: "active_7d", label: `Active 7d (${summary.active7d})` },
                { id: "no_address", label: `Needs address (${summary.noAddress})` },
                { id: "no_payout", label: `Needs PayID (${summary.noPayout})` },
                { id: "zero_scans", label: `0 scans (${summary.zeroScans})` },
                { id: "referred", label: `Referred (${summary.referred})` },
                { id: "runners", label: `Runners (${summary.runners})` },
              ] as Array<{ id: FilterKey; label: string }>
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setStatusFilter(pill.id)}
                className={`min-h-[36px] px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                  statusFilter === pill.id
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>

        {/* Map */}
        <div className="relative w-full h-[360px] rounded-2xl border border-slate-200 bg-slate-100 overflow-hidden mb-6">
          <div
            ref={mapDiv}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          />
        </div>

        {/* Users CRM Table */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-500" />
              <h2 className="text-[14px] font-bold text-slate-900">
                Members ({filteredUsers.length}{filteredUsers.length !== users.length ? ` of ${users.length}` : ""})
              </h2>
            </div>
            {(search || suburbFilter || statusFilter !== "all") && (
              <button
                type="button"
                onClick={() => { setSearch(""); setSuburbFilter(""); setStatusFilter("all"); }}
                className="text-xs font-bold text-emerald-700 hover:text-emerald-900 min-h-[36px] px-2"
              >
                Reset filters
              </button>
            )}
          </div>

          {loading ? (
            <div className="p-4 space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 rounded-xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : filteredUsers.length === 0 ? (
            <p className="p-6 text-[13px] text-slate-400">No members match these filters.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredUsers.map((u) => {
                const pill = statusPill(u.statusTag);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setSelectedUserId(u.id)}
                    className="w-full text-left px-4 py-3.5 hover:bg-slate-50 transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                        <p className="text-[14px] font-bold text-slate-900 truncate">
                          {u.email || u.name}
                        </p>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${pill.cls}`}>
                          {pill.label}
                        </span>
                        {u.hasPayoutDetails && (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            {u.preferredPayoutMethod === "aba" ? "BSB" : "PayID"}
                          </span>
                        )}
                        {(u.bagsOnKerbCount ?? 0) > 0 && (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700">
                            {u.bagsOnKerbCount} kerb bag{u.bagsOnKerbCount === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span>{u.name}</span>
                        <span>·</span>
                        <span>Joined {u.createdAt.slice(0, 10)}</span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Last scan: {formatRelativeTime(u.lastScanAt)}
                        </span>
                        {u.household?.address && (
                          <>
                            <span>·</span>
                            <span className="inline-flex items-center gap-0.5 truncate max-w-[260px]">
                              <MapPin className="w-3 h-3 shrink-0" />
                              {u.suburb ? `${titleSuburb(u.suburb)} — ` : ""}{u.household.address}
                            </span>
                          </>
                        )}
                        {u.referrerLabel && (
                          <>
                            <span>·</span>
                            <span className="text-emerald-700 font-semibold">Ref: {u.referrerLabel}</span>
                          </>
                        )}
                        {(u.referralsCount ?? 0) > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-violet-700 font-semibold">
                              Invited {u.referralsCount} (+{u.networkPoints ?? 0} pts)
                            </span>
                          </>
                        )}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-[15px] font-display font-extrabold text-slate-900 tabular-nums">
                        {u.totalContainers}
                      </p>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider">
                        {(u.scansLast7d ?? 0) > 0 ? `${u.scansLast7d} (7d)` : "cans"}
                      </p>
                    </div>
                    <div className="text-right shrink-0 w-16">
                      <p className="text-[13px] font-bold text-emerald-700 tabular-nums">
                        ${((u.pendingCents + u.clearedCents) / 100).toFixed(2)}
                      </p>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider">credit</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Slide-over User CRM Detail Drawer */}
      {selectedUserId && (
        <div className="fixed inset-0 z-50 flex justify-end overflow-hidden">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
            onClick={() => setSelectedUserId(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Member detail"
            className="relative z-10 h-full w-[calc(100%-1.5rem)] max-w-lg bg-white overflow-y-auto overscroll-contain shadow-2xl border-l border-slate-200 animate-slide-in-right"
          >
            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-100 px-5 py-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Member CRM</p>
                <h2 className="text-lg font-display font-extrabold text-slate-900 truncate">
                  {userDetail?.email || userDetail?.name || "Loading member…"}
                </h2>
                {userDetail?.name && userDetail.email && (
                  <p className="text-xs text-slate-500">{userDetail.name} · Joined {userDetail.createdAt.slice(0, 10)}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedUserId(null)}
                aria-label="Close member detail"
                className="h-11 w-11 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {detailLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-20 rounded-2xl bg-slate-100 animate-pulse" />
                  ))}
                </div>
              ) : detailErr ? (
                <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-xs text-red-700">{detailErr}</div>
              ) : userDetail ? (
                <>
                  {/* Totals */}
                  <div className="grid grid-cols-3 gap-2.5">
                    <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3">
                      <p className="text-[10px] font-bold uppercase text-slate-400">Containers</p>
                      <p className="text-xl font-display font-extrabold text-slate-900 tabular-nums">
                        {userDetail.totalContainers}
                      </p>
                      <p className="text-[11px] text-slate-500">Last: {formatRelativeTime(userDetail.lastScanAt)}</p>
                    </div>
                    <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3">
                      <p className="text-[10px] font-bold uppercase text-emerald-700">Pending</p>
                      <p className="text-xl font-display font-extrabold text-emerald-900 tabular-nums">
                        ${(userDetail.pendingCents / 100).toFixed(2)}
                      </p>
                      <p className="text-[11px] text-emerald-700">Cleared: ${(userDetail.clearedCents / 100).toFixed(2)}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3">
                      <p className="text-[10px] font-bold uppercase text-slate-400">Bags</p>
                      <p className="text-xl font-display font-extrabold text-slate-900 tabular-nums">
                        {userDetail.bags.length}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {userDetail.bags.filter((b) => b.status === "on_kerb").length} on kerb
                      </p>
                    </div>
                  </div>

                  {/* Household & Payout */}
                  <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                    <div className="p-3.5 flex items-start gap-2.5">
                      <MapPin className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold uppercase text-slate-400">Household</p>
                        {userDetail.household ? (
                          <>
                            <p className="text-[13px] font-semibold text-slate-900">{userDetail.household.address}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {userDetail.household.suburb ? titleSuburb(userDetail.household.suburb) : "No suburb"} ·{" "}
                              {userDetail.household.type || "residential"} · status: {userDetail.household.binStatus || "waitlisted"}
                            </p>
                          </>
                        ) : (
                          <p className="text-[13px] font-semibold text-amber-700">No address saved yet (orphan profile)</p>
                        )}
                      </div>
                    </div>

                    <div className="p-3.5 flex items-start gap-2.5">
                      <CreditCard className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold uppercase text-slate-400">Payout Readiness</p>
                        {userDetail.payout.hasPayoutDetails ? (
                          <p className="text-[13px] font-semibold text-emerald-800">
                            {userDetail.payout.preferredPayoutMethod === "aba"
                              ? `BSB ${userDetail.payout.bankBsb} · Acct ${userDetail.payout.bankAccountMasked}`
                              : `PayID (${userDetail.payout.payIdType || "email"}): ${userDetail.payout.payIdValue}`}
                            {userDetail.payout.bankAccountName ? ` · ${userDetail.payout.bankAccountName}` : ""}
                          </p>
                        ) : (
                          <p className="text-[13px] font-semibold text-violet-700">No PayID or BSB saved yet</p>
                        )}
                      </div>
                    </div>

                    {userDetail.syndicate && (
                      <div className="p-3.5 flex items-start gap-2.5">
                        <Building2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold uppercase text-slate-400">Building Syndicate</p>
                          <p className="text-[13px] font-semibold text-slate-900">
                            {userDetail.syndicate.buildingName} · {userDetail.syndicate.anonHandle} ({userDetail.syndicate.role}, {userDetail.syndicate.status})
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Referrals */}
                  <div className="rounded-2xl border border-slate-200 p-3.5 space-y-2">
                    <p className="text-[11px] font-bold uppercase text-slate-400">Neighbour Network</p>
                    <p className="text-[12px] text-slate-600">
                      Referred by:{" "}
                      {userDetail.referrer ? (
                        <button
                          type="button"
                          onClick={() => setSelectedUserId(userDetail.referrer!.id)}
                          className="font-bold text-emerald-700 underline"
                        >
                          {userDetail.referrer.email || userDetail.referrer.name}
                        </button>
                      ) : (
                        <span className="text-slate-400">Direct / organic</span>
                      )}
                    </p>
                    {userDetail.referrals.length > 0 ? (
                      <div className="space-y-1.5 pt-1">
                        <p className="text-[11px] font-semibold text-slate-500">
                          Invited {userDetail.referrals.length} neighbour{userDetail.referrals.length === 1 ? "" : "s"}:
                        </p>
                        {userDetail.referrals.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => setSelectedUserId(r.id)}
                            className="w-full text-left rounded-xl bg-slate-50 hover:bg-slate-100 px-3 py-2 flex items-center justify-between text-xs"
                          >
                            <span className="font-semibold text-slate-800 truncate">{r.email || r.name}</span>
                            <span className="text-slate-500 shrink-0">{r.totalContainers} cans</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] text-slate-400">Has not invited neighbours yet.</p>
                    )}
                  </div>

                  {/* Tagged Home Bags */}
                  {userDetail.bags.length > 0 && (
                    <div className="rounded-2xl border border-slate-200 p-3.5 space-y-2">
                      <p className="text-[11px] font-bold uppercase text-slate-400 flex items-center gap-1.5">
                        <Package className="w-3.5 h-3.5" /> Home Bags ({userDetail.bags.length})
                      </p>
                      <div className="space-y-1.5">
                        {userDetail.bags.map((b) => (
                          <div key={b.id} className="rounded-xl bg-slate-50 px-3 py-2 flex items-center justify-between text-xs">
                            <div>
                              <p className="font-mono font-bold text-slate-900">{b.code}</p>
                              <p className="text-[11px] text-slate-500">
                                {b.stream} · {b.declaredContainers} declared{b.verifiedContainers != null ? ` / ${b.verifiedContainers} verified` : ""}
                              </p>
                            </div>
                            <span className="rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">
                              {b.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recent Scans */}
                  <div className="rounded-2xl border border-slate-200 p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-bold uppercase text-slate-400">
                        Recent Scans ({userDetail.recentScans.length})
                      </p>
                      {userDetail.materialCounts.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {userDetail.materialCounts.map((m) => (
                            <span key={m.material} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                              {m.material}: {m.count}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {userDetail.recentScans.length === 0 ? (
                      <p className="text-xs text-slate-400">No scans recorded yet.</p>
                    ) : (
                      <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                        {userDetail.recentScans.map((s) => (
                          <div key={s.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-800 truncate">
                                {s.containerName || "Eligible container"}
                              </p>
                              <p className="text-[11px] text-slate-400">
                                {s.material}{s.barcode ? ` · ${s.barcode}` : ""} · {formatRelativeTime(s.createdAt)}
                              </p>
                            </div>
                            <span className="font-bold text-emerald-700 shrink-0 tabular-nums">+{s.refundCents}¢</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniKpi({
  label,
  value,
  accent,
  active,
  onClick,
}: {
  label: string;
  value: number;
  accent?: "emerald" | "amber" | "violet";
  active: boolean;
  onClick: () => void;
}) {
  const numColor =
    accent === "emerald"
      ? "text-emerald-700"
      : accent === "amber"
        ? "text-amber-700"
        : accent === "violet"
          ? "text-violet-700"
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
