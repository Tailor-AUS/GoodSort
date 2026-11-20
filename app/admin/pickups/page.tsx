"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, CheckCircle, Truck, Mail, RefreshCw } from "lucide-react";
import { apiUrl } from "@/lib/config";
import { claimRun } from "@/lib/marketplace-api";

interface TomorrowPickups {
  tomorrowDayOfWeek: number;
  totalHouseholds: number;
  householdsWithBinOut: number;
  runsCovering: number;
  runsClaimed: number;
  householdsUncovered: number;
  households: Array<{ id: string; name: string; address: string; pendingContainers: number; usesDivider: boolean; binIsOut: boolean; memberEmails: string[] }>;
  runs: Array<{ id: string; status: string; areaName: string; estimatedContainers: number; actualContainers?: number; depotVerifiedContainers?: number | null; coexDocketRef?: string | null; perContainerCents: number; estimatedPayoutCents?: number; runnerName: string | null; runnerEmail: string | null; stops: number }>;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function AdminPickupsPage() {
  const [data, setData] = useState<TomorrowPickups | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [claimingRunId, setClaimingRunId] = useState<string | null>(null);
  const [publishingRunId, setPublishingRunId] = useState<string | null>(null);
  const [settlingRunId, setSettlingRunId] = useState<string | null>(null);
  const [docketCounts, setDocketCounts] = useState<Record<string, string>>({});
  const [docketRefs, setDocketRefs] = useState<Record<string, string>>({});
  const [triggerResult, setTriggerResult] = useState<string | null>(null);

  function reload() {
    setErr(null);
    const token = localStorage.getItem("goodsort_token");
    if (!token) { setErr("Please log in first."); return; }
    fetch(apiUrl("/api/admin/pickups/tomorrow"), { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (r.status === 401 || r.status === 403) {
          return Promise.reject("This login is not an admin. Set ADMIN_SEED_EMAIL on the API to your email and sign in once, or use the bootstrap secret.");
        }
        if (!r.ok) return Promise.reject(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setErr(`Failed to load: ${e}`));
  }
  useEffect(reload, []);

  async function triggerReminders() {
    if (!confirm("Send pickup reminder emails right now (ignoring the 6pm time-gate)?")) return;
    const token = localStorage.getItem("goodsort_token");
    setTriggering(true);
    setTriggerResult(null);
    setErr(null);
    try {
      const res = await fetch(apiUrl("/api/admin/trigger-pickup-reminders"), {
        method: "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error || `Reminder trigger failed (HTTP ${res.status})`);
        return;
      }
      setTriggerResult(`Sent: ${j.households} household email${j.households === 1 ? "" : "s"}, ${j.runners} runner email${j.runners === 1 ? "" : "s"}.`);
    } catch {
      setErr("Network error while triggering reminders.");
    } finally { setTriggering(false); }
  }

  async function generateRunsNow() {
    const token = localStorage.getItem("goodsort_token");
    setGenerating(true);
    setTriggerResult(null);
    setErr(null);
    try {
      const res = await fetch(apiUrl("/api/admin/marketplace/runs/generate"), {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error || `Run generation failed (HTTP ${res.status})`);
        return;
      }
      setTriggerResult(
        j.acquiredLease === false
          ? "Another run-generation pass is currently in progress. Refresh in a few seconds."
          : "Run generation complete — refreshed active & pilot runs."
      );
      reload();
    } catch {
      setErr("Network error while generating runs.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleClaimRun(runId: string) {
    setClaimingRunId(runId);
    setTriggerResult(null);
    setErr(null);
    try {
      const claimed = await claimRun(runId);
      if (!claimed) {
        setErr("Could not claim run. Register this account as a Runner at /runner/signup first, or click Publish to marketplace so a recruited Runner can claim it.");
        return;
      }
      setTriggerResult(`Claimed run for ${claimed.areaName}. Open /runner to collect or click Trigger reminders now.`);
      reload();
    } finally {
      setClaimingRunId(null);
    }
  }

  async function handlePublishRun(runId: string) {
    const token = localStorage.getItem("goodsort_token");
    setPublishingRunId(runId);
    setTriggerResult(null);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/api/admin/marketplace/runs/${runId}/publish`), {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error || `Publish failed (HTTP ${res.status})`);
        return;
      }
      setTriggerResult("Published pilot run to the Runner marketplace (/runner).");
      reload();
    } catch {
      setErr("Network error while publishing run.");
    } finally {
      setPublishingRunId(null);
    }
  }

  async function handleSettleRun(r: TomorrowPickups["runs"][number]) {
    const token = localStorage.getItem("goodsort_token");
    const defaultCount = r.depotVerifiedContainers ?? r.actualContainers ?? r.estimatedContainers;
    const rawCount = docketCounts[r.id] ?? String(defaultCount);
    const parsedCount = Number.parseInt(rawCount, 10);
    if (!Number.isFinite(parsedCount) || parsedCount < 0) {
      setErr("Enter a valid non-negative depot verified container count.");
      return;
    }
    const docket = (docketRefs[r.id] ?? r.coexDocketRef ?? "").trim();
    setSettlingRunId(r.id);
    setTriggerResult(null);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/api/marketplace/runs/${r.id}/settle`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          depotVerifiedContainers: parsedCount,
          coexDocketRef: docket || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error || `Settle failed (HTTP ${res.status})`);
        return;
      }
      setTriggerResult(`Settled ${r.areaName}: ${j.actualContainers} verified containers · $${((j.actualPayoutCents ?? 0) / 100).toFixed(2)} Runner · $${((j.householdPayoutCents ?? 0) / 100).toFixed(2)} Households.`);
      reload();
    } catch {
      setErr("Network error while settling run.");
    } finally {
      setSettlingRunId(null);
    }
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <Link href="/admin" className="inline-flex items-center gap-1 text-[13px] text-slate-500 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to admin
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <h1 className="text-2xl font-display font-extrabold text-slate-900">Pickups &amp; pilot runs</h1>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={generateRunsNow} disabled={generating}
              className="text-[12px] bg-emerald-700 hover:bg-emerald-800 text-white font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${generating ? "animate-spin" : ""}`} /> {generating ? "Generating..." : "Generate runs now"}
            </button>
            <button type="button" onClick={triggerReminders} disabled={triggering}
              className="text-[12px] bg-slate-900 text-white font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-50">
              <Mail className="w-3.5 h-3.5" /> {triggering ? "Sending..." : "Trigger reminders now"}
            </button>
          </div>
        </div>
        {data && <p className="text-[13px] text-slate-500 mb-6">{DAY_NAMES[data.tomorrowDayOfWeek] ?? "Unknown"} tomorrow + active kerbside/pilot runs · {data.totalHouseholds} household{data.totalHouseholds === 1 ? "" : "s"}</p>}
        {triggerResult && <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-[13px] text-green-700 mb-4">{triggerResult}</div>}
        {err && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-[13px] text-red-700 mb-4">{err}</div>}

        {data && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-4 gap-3 mb-6">
              <Stat label="Households" value={data.totalHouseholds} />
              <Stat label="Bags out" value={data.householdsWithBinOut} good={data.totalHouseholds > 0 && data.householdsWithBinOut === data.totalHouseholds} />
              <Stat label="Runs claimed" value={`${data.runsClaimed}/${data.runsCovering}`} good={data.runsClaimed === data.runsCovering && data.runsCovering > 0} />
              <Stat label="Uncovered" value={data.householdsUncovered} bad={data.householdsUncovered > 0} />
            </div>

            {data.householdsUncovered > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[13px] text-amber-900"><b>{data.householdsUncovered}</b> household{data.householdsUncovered === 1 ? "" : "s"} with no runner claimed. Generate or claim the run below, or dispatch a collector.</p>
              </div>
            )}

            {/* Runs */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
              <div className="px-4 py-3 border-b border-slate-100 text-[13px] font-semibold text-slate-900 flex items-center gap-2">
                <Truck className="w-4 h-4 text-slate-500" /> Runs ({data.runs.length})
              </div>
              {data.runs.length === 0 ? (
                <p className="p-6 text-[13px] text-slate-400">No active runs yet. Enable collecting on /admin/waitlist, then click Generate runs now.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.runs.map(r => {
                    const payoutCents = r.estimatedPayoutCents ?? (r.perContainerCents * r.estimatedContainers);
                    const unclaimed = r.status === "available" || r.status === "below_threshold";
                    return (
                      <div key={r.id} className="px-4 py-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[13px] font-medium text-slate-900">{r.areaName} · {r.stops} stop{r.stops === 1 ? "" : "s"} · ~{r.estimatedContainers} ctr</p>
                            <p className="text-[11px] text-slate-400">
                              {r.runnerName ? `Claimed by ${r.runnerName} (${r.runnerEmail})` : "Unclaimed"} · ${(payoutCents / 100).toFixed(2)} est. payout
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {r.status === "below_threshold" && (
                              <button
                                type="button"
                                onClick={() => handlePublishRun(r.id)}
                                disabled={publishingRunId === r.id}
                                className="text-[11px] bg-violet-600 hover:bg-violet-700 text-white font-semibold px-2.5 py-1 rounded-lg disabled:opacity-50"
                              >
                                {publishingRunId === r.id ? "Publishing…" : "Publish to marketplace"}
                              </button>
                            )}
                            {unclaimed ? (
                              <button
                                type="button"
                                onClick={() => handleClaimRun(r.id)}
                                disabled={claimingRunId === r.id}
                                className="text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-2.5 py-1 rounded-lg disabled:opacity-50"
                              >
                                {claimingRunId === r.id ? "Claiming…" : "Claim run"}
                              </button>
                            ) : r.status !== "completed" ? (
                              <Link
                                href="/runner"
                                className="text-[11px] bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold px-2.5 py-1 rounded-lg"
                              >
                                Open in Runner →
                              </Link>
                            ) : null}
                            <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${r.status === "claimed" ? "bg-blue-100 text-blue-700" : r.status === "in_progress" || r.status === "delivering" ? "bg-green-100 text-green-700" : r.status === "completed" ? "bg-emerald-100 text-emerald-800" : r.status === "below_threshold" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>{r.status}</span>
                          </div>
                        </div>
                        {r.status === "completed" && (
                          <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-2.5 flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-semibold text-emerald-900">Verify depot docket:</span>
                            <input
                              type="number"
                              min={0}
                              aria-label="Depot verified container count"
                              value={docketCounts[r.id] ?? String(r.depotVerifiedContainers ?? r.actualContainers ?? r.estimatedContainers)}
                              onChange={(e) => setDocketCounts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                              className="w-24 border border-emerald-300 rounded px-2 py-1 text-[12px] bg-white text-slate-900"
                            />
                            <input
                              type="text"
                              aria-label="COEX docket reference"
                              placeholder="Docket ref (e.g. COEX-101)"
                              value={docketRefs[r.id] ?? (r.coexDocketRef ?? "")}
                              onChange={(e) => setDocketRefs((prev) => ({ ...prev, [r.id]: e.target.value }))}
                              className="flex-1 min-w-[140px] border border-emerald-300 rounded px-2 py-1 text-[12px] bg-white text-slate-900"
                            />
                            <button
                              type="button"
                              onClick={() => handleSettleRun(r)}
                              disabled={settlingRunId === r.id}
                              className="text-[11px] bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-3 py-1.5 rounded-lg disabled:opacity-50"
                            >
                              {settlingRunId === r.id ? "Settling…" : "Verify & Settle"}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Households */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 text-[13px] font-semibold text-slate-900">Households</div>
              {data.households.length === 0 ? (
                <p className="p-6 text-[13px] text-slate-400">No active collecting households yet.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.households.map(h => (
                    <div key={h.id} className="px-4 py-3 flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-slate-900 truncate">{h.name}</p>
                        <p className="text-[11px] text-slate-400 truncate">{h.address}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-[12px] text-slate-500">{h.pendingContainers} containers</span>
                        {h.binIsOut ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700">
                            <CheckCircle className="w-4 h-4 text-green-500" /> bags out
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">at home</span>
                        )}
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
