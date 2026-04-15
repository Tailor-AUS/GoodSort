"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, CheckCircle, Truck, Mail } from "lucide-react";
import { apiUrl } from "@/lib/config";

interface TomorrowPickups {
  tomorrowDayOfWeek: number;
  totalHouseholds: number;
  householdsWithBinOut: number;
  runsCovering: number;
  runsClaimed: number;
  householdsUncovered: number;
  households: Array<{ id: string; name: string; address: string; pendingContainers: number; usesDivider: boolean; binIsOut: boolean; memberEmails: string[] }>;
  runs: Array<{ id: string; status: string; areaName: string; estimatedContainers: number; perContainerCents: number; runnerName: string | null; runnerEmail: string | null; stops: number }>;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function AdminPickupsPage() {
  const [data, setData] = useState<TomorrowPickups | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);

  function reload() {
    const token = localStorage.getItem("goodsort_token");
    if (!token) { setErr("Please log in first."); return; }
    fetch(apiUrl("/api/admin/pickups/tomorrow"), { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setData)
      .catch(e => setErr(`Failed to load: ${e}`));
  }
  useEffect(reload, []);

  async function triggerReminders() {
    if (!confirm("Send pickup reminder emails right now (ignoring the 6pm time-gate)?")) return;
    const token = localStorage.getItem("goodsort_token");
    setTriggering(true); setTriggerResult(null);
    try {
      const res = await fetch(apiUrl("/api/admin/trigger-pickup-reminders"), {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
      const j = await res.json();
      setTriggerResult(`Sent: ${j.households} household email${j.households === 1 ? "" : "s"}, ${j.runners} runner email${j.runners === 1 ? "" : "s"}.`);
    } catch {
      setTriggerResult("Failed.");
    } finally { setTriggering(false); }
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <Link href="/admin" className="inline-flex items-center gap-1 text-[13px] text-slate-500 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to admin
        </Link>
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-display font-extrabold text-slate-900">Tomorrow's pickups</h1>
          <button onClick={triggerReminders} disabled={triggering}
            className="text-[12px] bg-slate-900 text-white font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-50">
            <Mail className="w-3.5 h-3.5" /> {triggering ? "Sending..." : "Trigger reminders now"}
          </button>
        </div>
        {data && <p className="text-[13px] text-slate-500 mb-6">{DAY_NAMES[data.tomorrowDayOfWeek]} council day · {data.totalHouseholds} household{data.totalHouseholds === 1 ? "" : "s"}</p>}
        {triggerResult && <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-[13px] text-green-700 mb-4">{triggerResult}</div>}
        {err && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-[13px] text-red-700 mb-4">{err}</div>}

        {data && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-4 gap-3 mb-6">
              <Stat label="Households" value={data.totalHouseholds} />
              <Stat label="Bin out" value={data.householdsWithBinOut} good={data.householdsWithBinOut === data.totalHouseholds} />
              <Stat label="Runs claimed" value={`${data.runsClaimed}/${data.runsCovering}`} good={data.runsClaimed === data.runsCovering && data.runsCovering > 0} />
              <Stat label="Uncovered" value={data.householdsUncovered} bad={data.householdsUncovered > 0} />
            </div>

            {data.householdsUncovered > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[13px] text-amber-900"><b>{data.householdsUncovered}</b> household{data.householdsUncovered === 1 ? "" : "s"} with no runner claimed. You might need to claim this run yourself or email a runner manually.</p>
              </div>
            )}

            {/* Runs */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
              <div className="px-4 py-3 border-b border-slate-100 text-[13px] font-semibold text-slate-900 flex items-center gap-2">
                <Truck className="w-4 h-4 text-slate-500" /> Runs ({data.runs.length})
              </div>
              {data.runs.length === 0 ? (
                <p className="p-6 text-[13px] text-slate-400">No runs created yet for these households.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.runs.map(r => (
                    <div key={r.id} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-[13px] font-medium text-slate-900">{r.areaName} · {r.stops} stop{r.stops === 1 ? "" : "s"}</p>
                        <p className="text-[11px] text-slate-400">
                          {r.runnerName ? `Claimed by ${r.runnerName} (${r.runnerEmail})` : "Unclaimed"} · ${((r.perContainerCents * r.estimatedContainers) / 100).toFixed(2)} est. payout
                        </p>
                      </div>
                      <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${r.status === "claimed" ? "bg-blue-100 text-blue-700" : r.status === "in_progress" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-700"}`}>{r.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Households */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 text-[13px] font-semibold text-slate-900">Households</div>
              {data.households.length === 0 ? (
                <p className="p-6 text-[13px] text-slate-400">None scheduled for tomorrow.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.households.map(h => (
                    <div key={h.id} className="px-4 py-3 flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-slate-900 truncate">{h.name}</p>
                        <p className="text-[11px] text-slate-400 truncate">{h.address}{h.usesDivider ? " · divider" : ""}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-[12px] text-slate-500">{h.pendingContainers} containers</span>
                        {h.binIsOut ? <CheckCircle className="w-4 h-4 text-green-500" /> : <span className="text-[11px] text-slate-400">bin in</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, good, bad }: { label: string; value: number | string; good?: boolean; bad?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border p-4 ${good ? "border-green-300" : bad ? "border-red-300" : "border-slate-200"}`}>
      <p className={`text-2xl font-display font-extrabold ${good ? "text-green-600" : bad ? "text-red-600" : "text-slate-900"}`}>{value}</p>
      <p className="text-[11px] text-slate-400 uppercase tracking-wider">{label}</p>
    </div>
  );
}
