"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { apiUrl } from "@/lib/config";

interface Bin {
  id: string;
  code: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  pendingContainers: number;
  status: string;
}

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

export default function AdminBinsPage() {
  const [bins, setBins] = useState<Bin[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const addressInput = useRef<HTMLInputElement>(null);

  function reload() {
    fetch(apiUrl("/api/bins")).then(r => r.json()).then(setBins).catch(() => {});
  }
  useEffect(() => { reload(); }, []);

  useEffect(() => {
    if (!MAPS_KEY || !addressInput.current) return;
    setOptions({ key: MAPS_KEY, v: "weekly" });
    importLibrary("places").then(() => {
      if (!addressInput.current) return;
      const ac = new google.maps.places.Autocomplete(addressInput.current, {
        componentRestrictions: { country: "au" },
        fields: ["formatted_address", "geometry"],
        types: ["address"],
      });
      ac.addListener("place_changed", () => {
        const p = ac.getPlace();
        if (p.formatted_address) setAddress(p.formatted_address);
        if (p.geometry?.location) { setLat(p.geometry.location.lat()); setLng(p.geometry.location.lng()); }
      });
    });
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!name || !address || lat == null || lng == null) { setErr("Select an address from the dropdown."); return; }
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/bins"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code || null, name, address, lat, lng }),
      });
      if (!res.ok) { setErr("Failed to create bin"); setLoading(false); return; }
      setCode(""); setName(""); setAddress(""); setLat(null); setLng(null);
      if (addressInput.current) addressInput.current.value = "";
      reload();
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <Link href="/admin" className="inline-flex items-center gap-1 text-[13px] text-slate-500 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to admin
        </Link>
        <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-1">Bins</h1>
        <p className="text-[13px] text-slate-500 mb-6">Create collection points — public drop bins or private pickup stations.</p>

        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-4 mb-6 space-y-3">
          <div className="flex items-center gap-2 mb-1"><Plus className="w-4 h-4 text-green-600" /><p className="text-[13px] font-semibold text-slate-900">New bin</p></div>
          <div className="grid grid-cols-2 gap-3">
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="Code (optional, auto GS-XXXX)"
              className="border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/20" />
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (e.g. 45 Boundary St)"
              className="border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/20" required />
          </div>
          <input ref={addressInput} onChange={e => { setAddress(e.target.value); setLat(null); setLng(null); }} placeholder="Address (start typing, pick from dropdown)"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/20" required />
          {err && <p className="text-red-500 text-[12px]">{err}</p>}
          <button type="submit" disabled={loading} className="bg-green-600 hover:bg-green-700 text-white font-semibold text-[13px] px-4 py-2 rounded-lg disabled:opacity-50">
            {loading ? "Creating..." : "Create bin"}
          </button>
        </form>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-[13px] font-semibold text-slate-900">Bins ({bins.length})</div>
          {bins.length === 0 ? (
            <p className="p-6 text-[13px] text-slate-400">No bins yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {bins.map(b => (
                <div key={b.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-slate-900">{b.code} · {b.name}</p>
                    <p className="text-[11px] text-slate-400">{b.address}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[13px] font-display font-extrabold text-slate-900">{b.pendingContainers}</p>
                    <p className="text-[10px] uppercase tracking-wider text-slate-400">pending</p>
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
