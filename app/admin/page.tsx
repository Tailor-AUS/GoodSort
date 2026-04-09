"use client";

import { useState, useEffect } from "react";
import { Users, Package, Truck, DollarSign, Download } from "lucide-react";
import { apiUrl } from "@/lib/config";

interface Stats {
  users: number;
  bins: number;
  scans: number;
  routes: number;
  totalContainers: number;
  totalPending: number;
  totalCleared: number;
}

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("goodsort_token");
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(apiUrl("/api/admin/stats"), { headers })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function exportAba() {
    const token = localStorage.getItem("goodsort_token");
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(apiUrl("/api/admin/aba-export"), { headers });
    const text = await res.text();
    if (!text || text.includes("No pending")) {
      alert("No pending cashouts to export");
      return;
    }
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `goodsort-payouts-${new Date().toISOString().split("T")[0]}.aba`;
    a.click();
  }

  if (loading) return <div className="min-h-dvh bg-white flex items-center justify-center"><p className="text-slate-400">Loading...</p></div>;

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-6">Admin Dashboard</h1>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <StatCard icon={Users} label="Users" value={stats?.users ?? 0} />
          <StatCard icon={Package} label="Containers" value={stats?.totalContainers ?? 0} />
          <StatCard icon={Truck} label="Routes" value={stats?.routes ?? 0} />
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

        {/* Actions */}
        <div className="space-y-3">
          <button onClick={exportAba}
            className="flex items-center gap-3 w-full bg-white rounded-xl p-4 border border-slate-200 hover:border-green-300 transition-colors text-left">
            <Download className="w-5 h-5 text-green-600" />
            <div>
              <p className="text-[14px] font-semibold text-slate-900">Export ABA File</p>
              <p className="text-[12px] text-slate-400">Download bank transfer file for pending cashouts</p>
            </div>
          </button>
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
