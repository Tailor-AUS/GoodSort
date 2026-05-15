"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MLMap, Marker as MLMarker, LngLatBounds } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { ArrowLeft, MapPin, Users } from "lucide-react";
import { apiUrl } from "@/lib/config";

interface Household {
  id: string;
  name: string;
  address: string;
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
  totalContainers: number;
  pendingCents: number;
  clearedCents: number;
  createdAt: string;
  household: Household | null;
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

const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const BRISBANE: [number, number] = [153.021, -27.482]; // [lng, lat]

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

function binMarkerEl(count: number): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "line-height:0;cursor:pointer";
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#16a34a" stroke="#fff" stroke-width="2"/><text x="16" y="20" text-anchor="middle" fill="#fff" font-size="11" font-weight="700">${count}</text></svg>`;
  return el;
}

function householdMarkerEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "line-height:0;cursor:pointer";
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><circle cx="11" cy="11" r="9" fill="#2563eb" stroke="#fff" stroke-width="2"/></svg>`;
  return el;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [bins, setBins] = useState<Bin[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markersRef = useRef<MLMarker[]>([]);

  useEffect(() => {
    const token = localStorage.getItem("goodsort_token");
    if (!token) { setErr("Please log in first at /login"); setLoading(false); return; }
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(apiUrl("/api/admin/users"), { headers }).then(r => r.ok ? r.json() : Promise.reject(r.status)),
      fetch(apiUrl("/api/bins")).then(r => r.json()),
    ])
      .then(([u, b]) => { setUsers(u); setBins(b); })
      .catch(e => setErr(`Failed to load: ${e}`))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!mapDiv.current || (users.length === 0 && bins.length === 0)) return;
    if (!mapRef.current) {
      mapRef.current = new maplibregl.Map({
        container: mapDiv.current,
        style: MAP_STYLE_URL,
        center: BRISBANE,
        zoom: 11,
        attributionControl: { compact: true },
      });
      mapRef.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    }
    const map = mapRef.current;

    function render() {
      // Clear previous markers
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      const bounds = new LngLatBounds();

      // Bin markers
      bins.forEach((b) => {
        const popupHtml = `<div style="font-family:system-ui;font-size:13px"><b>${escapeHtml(b.code)} — ${escapeHtml(b.name)}</b><br/><span style="color:#666">${escapeHtml(b.address)}</span><br/><b style="color:#16a34a">${b.pendingContainers}</b> containers pending</div>`;
        const marker = new maplibregl.Marker({ element: binMarkerEl(b.pendingContainers), anchor: "center" })
          .setLngLat([b.lng, b.lat])
          .setPopup(new maplibregl.Popup({ offset: 16 }).setHTML(popupHtml))
          .addTo(map);
        markersRef.current.push(marker);
        bounds.extend([b.lng, b.lat]);
      });

      // Household markers
      const households = new Map<string, { h: Household; emails: string[] }>();
      users.forEach((u) => {
        if (!u.household) return;
        const k = u.household.id;
        if (!households.has(k)) households.set(k, { h: u.household, emails: [] });
        if (u.email) households.get(k)!.emails.push(u.email);
      });
      households.forEach(({ h, emails }) => {
        if (!h.lat || !h.lng) return;
        const emailList = emails.map(escapeHtml).join("<br/>");
        const popupHtml = `<div style="font-family:system-ui;font-size:13px"><b>${escapeHtml(h.name || "Household")}</b><br/><span style="color:#666">${escapeHtml(h.address)}</span><br/>${emailList}<br/><b style="color:#2563eb">${h.pendingContainers}</b> containers pending</div>`;
        const marker = new maplibregl.Marker({ element: householdMarkerEl(), anchor: "center" })
          .setLngLat([h.lng, h.lat])
          .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(popupHtml))
          .addTo(map);
        markersRef.current.push(marker);
        bounds.extend([h.lng, h.lat]);
      });

      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 600 });
    }

    if (map.loaded()) render();
    else map.once("load", render);

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [users, bins]);

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; }, []);

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="max-w-5xl mx-auto px-6 py-6">
        <Link href="/admin" className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-900 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to admin
        </Link>
        <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-1">Users & Map</h1>
        <p className="text-[13px] text-slate-500 mb-6">Bins in green (number = pending containers). Households in blue. Click pins for detail.</p>

        {err && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-[13px] text-red-700 mb-4">{err}</div>}

        {/* Map */}
        <div ref={mapDiv} className="w-full h-[420px] rounded-xl border border-slate-200 bg-slate-100 mb-8" />

        {/* Users table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
            <Users className="w-4 h-4 text-slate-500" />
            <h2 className="text-[14px] font-semibold text-slate-900">Users ({users.length})</h2>
          </div>
          {loading ? (
            <p className="p-6 text-[13px] text-slate-400">Loading...</p>
          ) : users.length === 0 ? (
            <p className="p-6 text-[13px] text-slate-400">No users yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {users.map(u => (
                <div key={u.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-slate-900 truncate">{u.email || u.name}</p>
                    <p className="text-[11px] text-slate-400 flex items-center gap-2">
                      <span>{u.role}</span>
                      <span>·</span>
                      <span>joined {u.createdAt.slice(0, 10)}</span>
                      {u.household?.address && (
                        <>
                          <span>·</span>
                          <MapPin className="w-3 h-3" />
                          <span className="truncate max-w-[200px]">{u.household.address}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[14px] font-display font-extrabold text-slate-900">{u.totalContainers}</p>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">containers</p>
                  </div>
                  <div className="text-right shrink-0 w-20">
                    <p className="text-[13px] font-semibold text-green-600">${((u.pendingCents + u.clearedCents) / 100).toFixed(2)}</p>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">earned</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
