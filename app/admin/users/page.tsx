"use client";

import { useEffect, useRef, useState } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
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

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const BRISBANE: google.maps.LatLngLiteral = { lat: -27.482, lng: 153.021 };

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [bins, setBins] = useState<Bin[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const mapDiv = useRef<HTMLDivElement>(null);

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
    if (!mapDiv.current || !MAPS_KEY || (users.length === 0 && bins.length === 0)) return;
    setOptions({ key: MAPS_KEY, v: "weekly" });
    Promise.all([importLibrary("maps"), importLibrary("marker")]).then(() => {
      const map = new google.maps.Map(mapDiv.current!, {
        center: BRISBANE, zoom: 12, mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
      });
      const bounds = new google.maps.LatLngBounds();

      // Bin markers — green, labelled with pending container count
      bins.forEach(b => {
        const pos = { lat: b.lat, lng: b.lng };
        const m = new google.maps.Marker({
          position: pos, map, title: `${b.code} — ${b.name}\n${b.pendingContainers} containers pending`,
          label: { text: String(b.pendingContainers), color: "white", fontSize: "11px", fontWeight: "700" },
          icon: {
            path: google.maps.SymbolPath.CIRCLE, scale: 14,
            fillColor: "#16a34a", fillOpacity: 1, strokeColor: "white", strokeWeight: 2,
          },
        });
        const info = new google.maps.InfoWindow({
          content: `<div style="font-family:system-ui;font-size:13px"><b>${b.code} — ${b.name}</b><br/><span style="color:#666">${b.address}</span><br/><b style="color:#16a34a">${b.pendingContainers}</b> containers pending</div>`,
        });
        m.addListener("click", () => info.open(map, m));
        bounds.extend(pos);
      });

      // Household pins — blue, for users who've set up an address
      const households = new Map<string, { h: Household; emails: string[] }>();
      users.forEach(u => {
        if (!u.household) return;
        const k = u.household.id;
        if (!households.has(k)) households.set(k, { h: u.household, emails: [] });
        if (u.email) households.get(k)!.emails.push(u.email);
      });
      households.forEach(({ h, emails }) => {
        if (!h.lat || !h.lng) return;
        const pos = { lat: h.lat, lng: h.lng };
        const m = new google.maps.Marker({
          position: pos, map, title: `${h.name}\n${h.address}`,
          icon: {
            path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW, scale: 6,
            fillColor: "#2563eb", fillOpacity: 1, strokeColor: "white", strokeWeight: 2,
          },
        });
        const info = new google.maps.InfoWindow({
          content: `<div style="font-family:system-ui;font-size:13px"><b>${h.name || "Household"}</b><br/><span style="color:#666">${h.address}</span><br/>${emails.join("<br/>")}<br/><b style="color:#2563eb">${h.pendingContainers}</b> containers pending</div>`,
        });
        m.addListener("click", () => info.open(map, m));
        bounds.extend(pos);
      });

      if (!bounds.isEmpty()) map.fitBounds(bounds, 60);
    });
  }, [users, bins]);

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
