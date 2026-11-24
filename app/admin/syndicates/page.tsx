"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Check,
  Clock,
  Flag,
  PauseCircle,
  RefreshCw,
  ShieldCheck,
  Star,
  Truck,
  X,
} from "lucide-react";
import { apiUrl } from "@/lib/config";
import { formatCents } from "@/lib/store";
import {
  formatDropSpot,
  formatPickupWindow,
  type AdminSyndicateItem,
  type AdminSyndicatesResponse,
} from "@/lib/syndicate-api";

type FilterMode = "all" | "pickup_requested" | "detected" | "official" | "flagged";

export default function AdminSyndicatesPage() {
  const [data, setData] = useState<AdminSyndicatesResponse | null>(null);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr(null);
    const token = localStorage.getItem("goodsort_token");
    if (!token) {
      setErr("Please sign in with an admin account first.");
      setLoading(false);
      return;
    }
    fetch(apiUrl("/api/admin/syndicates"), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then((r) => {
        if (r.status === 401 || r.status === 403) {
          return Promise.reject(
            "This login is not an admin. Set ADMIN_SEED_EMAIL on the API to your email and sign in once.",
          );
        }
        if (!r.ok) return Promise.reject(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: AdminSyndicatesResponse) => {
        setData(d);
      })
      .catch((e) => setErr(typeof e === "string" ? e : `Failed to load syndicates: ${e}`))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patchSyndicate(id: string, body: Record<string, string>, successMsg: string) {
    setBusyKey(`patch-${id}`);
    setErr(null);
    setNotice(null);
    try {
      const token = localStorage.getItem("goodsort_token");
      const res = await fetch(apiUrl(`/api/admin/syndicates/${id}`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setNotice(successMsg);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update syndicate.");
    } finally {
      setBusyKey(null);
    }
  }

  async function actOnMember(
    syndicateId: string,
    memberId: string,
    action: "approve" | "reject" | "make_captain",
  ) {
    setBusyKey(`member-${memberId}`);
    setErr(null);
    setNotice(null);
    try {
      const token = localStorage.getItem("goodsort_token");
      const res = await fetch(apiUrl(`/api/admin/syndicates/${syndicateId}/members/${memberId}`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setNotice(`Member updated (${action.replace("_", " ")}).`);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update member.");
    } finally {
      setBusyKey(null);
    }
  }

  async function moderateMessage(
    syndicateId: string,
    messageId: string,
    action: "hide" | "restore" | "clear_flag",
  ) {
    setBusyKey(`msg-${messageId}`);
    setErr(null);
    setNotice(null);
    try {
      const token = localStorage.getItem("goodsort_token");
      const res = await fetch(
        apiUrl(`/api/admin/syndicates/${syndicateId}/messages/${messageId}/moderate`),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ action }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setNotice(`Message moderation applied (${action.replace("_", " ")}).`);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not moderate message.");
    } finally {
      setBusyKey(null);
    }
  }

  const allItems: AdminSyndicateItem[] = data?.syndicates ?? [];
  const filtered = allItems.filter((s) => {
    if (filter === "pickup_requested") return s.pickupStatus === "requested";
    if (filter === "detected") return s.status === "detected";
    if (filter === "official") return s.status === "official";
    if (filter === "flagged") return s.flaggedCount > 0;
    return true;
  });

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div>
            <Link
              href="/admin"
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 hover:text-slate-800 mb-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Admin Dashboard
            </Link>
            <h1 className="text-2xl font-display font-extrabold text-slate-900">
              Building Syndicates
            </h1>
            <p className="text-[13px] text-slate-500 mt-0.5">
              Promote detected commercial/residential buildings to Official Syndicates, approve join requests, schedule pickups, and moderate anonymous channels.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-slate-200 px-3.5 py-2 text-[12px] font-bold text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        {err && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-[13px] text-amber-900 mb-5">
            {err}
          </div>
        )}
        {notice && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 text-[13px] text-emerald-900 font-medium mb-5">
            {notice}
          </div>
        )}

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <p className="text-[11px] text-slate-400 uppercase tracking-wider">Buildings Tracked</p>
            <p className="text-2xl font-display font-extrabold text-slate-900">{data?.total ?? 0}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-emerald-200">
            <p className="text-[11px] text-emerald-700 uppercase tracking-wider">Official Syndicates</p>
            <p className="text-2xl font-display font-extrabold text-emerald-700">{data?.official ?? 0}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <p className="text-[11px] text-slate-400 uppercase tracking-wider">Detected (Pending)</p>
            <p className="text-2xl font-display font-extrabold text-slate-900">{data?.detected ?? 0}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-violet-200">
            <p className="text-[11px] text-violet-700 uppercase tracking-wider">Pickup Requested</p>
            <p className="text-2xl font-display font-extrabold text-violet-700">{data?.pickupRequested ?? 0}</p>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap gap-2 mb-6">
          {(
            [
              { id: "all", label: `All (${allItems.length})` },
              { id: "pickup_requested", label: `Pickup requested (${allItems.filter((s) => s.pickupStatus === "requested").length})` },
              { id: "detected", label: `Detected (${allItems.filter((s) => s.status === "detected").length})` },
              { id: "official", label: `Official (${allItems.filter((s) => s.status === "official").length})` },
              { id: "flagged", label: `Flagged chat (${allItems.filter((s) => s.flaggedCount > 0).length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`rounded-full px-3.5 py-1.5 text-[12px] font-bold transition-colors ${
                filter === tab.id
                  ? "bg-slate-900 text-white"
                  : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-[13px] text-slate-400">
            Loading building syndicates...
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
            <Building2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-[14px] font-bold text-slate-700">No buildings match this filter yet</p>
            <p className="text-[12px] text-slate-400 mt-1">
              Apartment blocks and office towers auto-appear here as soon as a sorter enters a unit, suite, or level address (or 2+ sorters share an address).
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((s) => (
              <div key={s.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
                {/* Header */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                        {s.buildingKind}
                      </span>
                      {s.status === "official" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                          <ShieldCheck className="w-3 h-3" />
                          Official Syndicate
                        </span>
                      ) : s.status === "paused" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2.5 py-0.5 text-[10px] font-bold text-red-700">
                          <PauseCircle className="w-3 h-3" />
                          Paused
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[10px] font-bold text-amber-800">
                          Detected
                        </span>
                      )}
                      {s.pickupStatus === "requested" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-0.5 text-[10px] font-bold text-violet-800">
                          <Clock className="w-3 h-3" />
                          Pickup Requested
                        </span>
                      )}
                      {s.pickupStatus === "scheduled" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-bold text-white">
                          <Truck className="w-3 h-3" />
                          Pickup Scheduled
                        </span>
                      )}
                    </div>
                    <h2 className="text-[18px] font-display font-extrabold text-slate-900">
                      {s.displayName}
                      {s.suburb ? <span className="text-slate-400 font-semibold text-[14px] ml-2">{s.suburb}</span> : null}
                    </h2>
                    <p className="text-[12px] text-slate-500 mt-0.5">
                      {s.totalSortersInBuilding} sorter{s.totalSortersInBuilding === 1 ? "" : "s"} at building ·{" "}
                      <strong>{s.approvedCount}</strong> joined ·{" "}
                      <strong>{s.pendingCount}</strong> pending ·{" "}
                      <strong>{s.readyCount}</strong> ready ·{" "}
                      <strong>{s.totalContainers.toLocaleString()}</strong> cans ({formatCents(s.potCents)})
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Drop spot: <strong className="text-slate-600">{formatDropSpot(s.dropSpot)}</strong> · Window:{" "}
                      <strong className="text-slate-600">{formatPickupWindow(s.pickupWindow)}</strong>
                      {s.pickupRequestedByHandle ? ` · Requested by ${s.pickupRequestedByHandle}` : ""}
                    </p>
                  </div>

                  {/* Admin Controls */}
                  <div className="flex flex-wrap gap-2">
                    {s.status !== "official" && (
                      <button
                        type="button"
                        disabled={busyKey === `patch-${s.id}`}
                        onClick={() =>
                          patchSyndicate(
                            s.id,
                            { status: "official" },
                            `${s.displayName} promoted to Official Syndicate.`,
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-3 py-1.5 text-[12px] font-bold text-white"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Promote Official
                      </button>
                    )}
                    {s.pickupStatus !== "scheduled" ? (
                      <button
                        type="button"
                        disabled={busyKey === `patch-${s.id}`}
                        onClick={() =>
                          patchSyndicate(
                            s.id,
                            { pickupStatus: "scheduled" },
                            `Scheduled pickup for ${s.displayName}.`,
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 px-3 py-1.5 text-[12px] font-bold text-white"
                      >
                        <Truck className="w-3.5 h-3.5" />
                        Schedule Pickup
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busyKey === `patch-${s.id}`}
                        onClick={() =>
                          patchSyndicate(
                            s.id,
                            { pickupStatus: "none" },
                            `Cleared scheduled pickup for ${s.displayName}.`,
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 px-3 py-1.5 text-[12px] font-bold text-slate-700"
                      >
                        Reset Pickup
                      </button>
                    )}
                    {s.status !== "paused" ? (
                      <button
                        type="button"
                        disabled={busyKey === `patch-${s.id}`}
                        onClick={() =>
                          patchSyndicate(s.id, { status: "paused" }, `Paused ${s.displayName}.`)
                        }
                        className="rounded-lg bg-white border border-slate-200 hover:border-red-300 hover:text-red-700 disabled:opacity-50 px-3 py-1.5 text-[12px] font-semibold text-slate-600"
                      >
                        Pause
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busyKey === `patch-${s.id}`}
                        onClick={() =>
                          patchSyndicate(
                            s.id,
                            { status: "detected" },
                            `Reactivated ${s.displayName}.`,
                          )
                        }
                        className="rounded-lg bg-amber-100 hover:bg-amber-200 disabled:opacity-50 px-3 py-1.5 text-[12px] font-bold text-amber-900"
                      >
                        Reactivate
                      </button>
                    )}
                  </div>
                </div>

                {/* Members (Anonymous Handles) */}
                {s.members.length > 0 && (
                  <div className="border-t border-slate-100 pt-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                      Members ({s.members.length})
                    </p>
                    <div className="space-y-1.5">
                      {s.members.map((m) => (
                        <div
                          key={m.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[12px]"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-slate-900">{m.anonHandle}</span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                m.status === "approved"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : m.status === "pending"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-slate-200 text-slate-600"
                              }`}
                            >
                              {m.status}
                            </span>
                            {m.role === "captain" && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">
                                <Star className="w-2.5 h-2.5 text-amber-400" /> Captain
                              </span>
                            )}
                            {m.readyToPool && (
                              <span className="text-[11px] font-semibold text-emerald-700">· Ready</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {m.status !== "approved" && (
                              <button
                                type="button"
                                disabled={busyKey === `member-${m.id}`}
                                onClick={() => actOnMember(s.id, m.id, "approve")}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                <Check className="w-3 h-3" /> Approve
                              </button>
                            )}
                            {m.role !== "captain" && m.status !== "rejected" && (
                              <button
                                type="button"
                                disabled={busyKey === `member-${m.id}`}
                                onClick={() => actOnMember(s.id, m.id, "make_captain")}
                                className="rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                              >
                                Make Captain
                              </button>
                            )}
                            {m.status !== "rejected" && (
                              <button
                                type="button"
                                disabled={busyKey === `member-${m.id}`}
                                onClick={() => actOnMember(s.id, m.id, "reject")}
                                aria-label={`Reject ${m.anonHandle}`}
                                className="inline-flex items-center gap-1 rounded-lg bg-white border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-500 hover:text-red-700 hover:border-red-200 disabled:opacity-50"
                              >
                                <X className="w-3 h-3" /> Reject
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Moderation Queue */}
                {s.flaggedMessages.length > 0 && (
                  <div className="border-t border-red-100 pt-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-red-600 mb-2 inline-flex items-center gap-1">
                      <Flag className="w-3.5 h-3.5" /> Flagged / Hidden Channel Messages ({s.flaggedMessages.length})
                    </p>
                    <div className="space-y-2">
                      {s.flaggedMessages.map((msg) => (
                        <div
                          key={msg.id}
                          className="rounded-xl bg-red-50/70 border border-red-200 p-3 flex flex-wrap items-center justify-between gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-bold text-red-900">
                              {msg.anonHandle} · {msg.flagCount} flag{msg.flagCount === 1 ? "" : "s"}
                              {msg.hidden ? " · HIDDEN" : " · VISIBLE"}
                            </p>
                            <p className="text-[12px] text-slate-800 mt-0.5 break-words">{msg.body}</p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {!msg.hidden ? (
                              <button
                                type="button"
                                disabled={busyKey === `msg-${msg.id}`}
                                onClick={() => moderateMessage(s.id, msg.id, "hide")}
                                className="rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-red-700 disabled:opacity-50"
                              >
                                Hide
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={busyKey === `msg-${msg.id}`}
                                onClick={() => moderateMessage(s.id, msg.id, "restore")}
                                className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                Restore
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={busyKey === `msg-${msg.id}`}
                              onClick={() => moderateMessage(s.id, msg.id, "clear_flag")}
                              className="rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                            >
                              Clear flag
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
