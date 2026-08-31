"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Package } from "lucide-react";
import { apiUrl } from "@/lib/config";
import { titleSuburb } from "@/lib/brisbane";

type House = {
  id: string;
  name: string;
  address: string;
  street: string | null;
  councilCollectionDay: number | null;
  binStatus: string;
  waitlistedAt: string | null;
  pendingContainers?: number;
};

type DayRow = {
  day: number;
  dayName: string;
  households: number;
  containers?: number;
  waitlisted: number;
  allocated: number;
  delivered: number;
  collecting: number;
  readyToOrder: boolean;
};

type SuburbRow = {
  suburb: string;
  households: number;
  containers?: number;
  waitlisted: number;
  allocated: number;
  delivered: number;
  collecting: number;
  readyToOrder: boolean;
  days: DayRow[];
  houses: House[];
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function AdminWaitlistPage() {
  const [rows, setRows] = useState<SuburbRow[]>([]);
  const [threshold, setThreshold] = useState(1000);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function token() {
    return localStorage.getItem("goodsort_token");
  }

  function reload() {
    const t = token();
    if (!t) { setErr("Please log in first."); return; }
    fetch(apiUrl("/api/admin/waitlist"), { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => {
        if (r.status === 401 || r.status === 403) {
          return Promise.reject("This login is not an admin. Set ADMIN_SEED_EMAIL on the API to your email and sign in once, or use the bootstrap secret.");
        }
        if (!r.ok) return Promise.reject(r.status);
        return r.json();
      })
      .then((d) => {
        setThreshold(d.liveThreshold ?? 1000);
        setRows(d.suburbs ?? []);
      })
      .catch((e) => setErr(`Failed to load: ${e}`));
  }

  useEffect(reload, []);

  async function postArea(path: string) {
    const res = await fetch(apiUrl(path), {
      method: "POST",
      headers: { Authorization: `Bearer ${token()}` },
    });
    const body = await res.json().catch(() => ({} as { error?: string }));
    if (!res.ok) throw new Error(typeof body.error === "string" && body.error ? body.error : String(res.status));
  }

  async function allocate(suburb: string, day?: number, dayName?: string) {
    const label = dayName ? `${titleSuburb(suburb)} ${dayName}` : titleSuburb(suburb);
    if (!confirm(`Mark waitlisted houses in ${label} as allocated (ready to buy bins)?`)) return;
    const key = day != null ? `${suburb}-${day}` : suburb;
    setBusy(key);
    try {
      const qs = day != null ? `?day=${day}` : "";
      await postArea(`/api/admin/areas/${encodeURIComponent(suburb)}/allocate${qs}`);
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Allocate failed.");
    } finally {
      setBusy(null);
    }
  }

  async function advance(suburb: string, to: "delivered" | "collecting", day?: number, dayName?: string) {
    const label = dayName ? `${titleSuburb(suburb)} ${dayName}` : titleSuburb(suburb);
    const msg = to === "delivered"
      ? `Mark allocated houses in ${label} as delivered?`
      : `Start collecting in ${label}? Households get the collecting email.`;
    if (!confirm(msg)) return;
    const key = `${to}-${suburb}-${day ?? "all"}`;
    setBusy(key);
    try {
      const qs = new URLSearchParams({ to });
      if (day != null) qs.set("day", String(day));
      await postArea(`/api/admin/areas/${encodeURIComponent(suburb)}/advance?${qs}`);
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Advance failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <Link href="/admin" className="inline-flex items-center gap-1 text-[13px] text-slate-500 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to admin
        </Link>
        <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-1">Bin waitlist</h1>
        <p className="text-[13px] text-slate-500 mb-6">
          A volume run unlocks at about {threshold.toLocaleString()} scanned containers in a suburb — enough for one driver trip. Allocate when volume is ready.
        </p>
        {err && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-[13px] text-red-700 mb-4">{err}</div>}

        <div className="space-y-4">
          {/* Members needing a nudge sort first — with 0 containers they
              otherwise fall to the bottom of a volume-ordered list. */}
          {[...rows].sort((a, b) => Number(b.suburb === "UNKNOWN") - Number(a.suburb === "UNKNOWN")).map((s) => (
            // UNKNOWN is not a quiet suburb — it is members who joined and gave
            // no usable suburb. Rendered identically to a real one, its missing
            // Buy-bins button read as "waiting for volume" rather than
            // "these people need chasing".
            <div key={s.suburb} className={`border rounded-2xl p-4 ${s.suburb === "UNKNOWN" ? "bg-amber-50 border-amber-300" : "bg-white border-slate-200"}`}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="text-[16px] font-display font-extrabold text-slate-900">
                    {s.suburb === "UNKNOWN" ? "Signed up, no suburb yet" : titleSuburb(s.suburb)}
                  </p>
                  {s.suburb === "UNKNOWN" ? (
                    <p className="text-[12px] text-amber-800">
                      {s.households} {s.households === 1 ? "member" : "members"} joined but gave no usable suburb, so they
                      cannot be counted toward a run or collected from. They need a nudge to finish onboarding — a
                      city-wide answer like “Brisbane” does not count.
                    </p>
                  ) : (
                    <p className="text-[12px] text-slate-500">
                      {(s.containers ?? 0).toLocaleString()}/{threshold.toLocaleString()} containers · {s.households} houses · {s.waitlisted} waitlisted · {s.allocated} allocated · {s.delivered + s.collecting} delivered
                    </p>
                  )}
                </div>
              </div>
              {s.days?.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {s.days.map((d) => (
                    <div key={d.day} className="flex items-center gap-2 border border-slate-200 rounded-lg px-2 py-1">
                      <p className="text-[11px] text-slate-600">{d.dayName} · {(d.containers ?? 0).toLocaleString()} ctr · {d.households} hh</p>
                      {d.readyToOrder && (
                        <button
                          onClick={() => allocate(s.suburb, d.day, d.dayName)}
                          disabled={busy === `${s.suburb}-${d.day}`}
                          className="text-[11px] bg-violet-700 text-white font-semibold px-2 py-1 rounded-md flex items-center gap-1 disabled:opacity-50"
                        >
                          <Package className="w-3 h-3" /> {busy === `${s.suburb}-${d.day}` ? "…" : "Buy bins"}
                        </button>
                      )}
                      {(d.allocated ?? 0) > 0 && (
                        <button
                          onClick={() => advance(s.suburb, "delivered", d.day, d.dayName)}
                          disabled={busy === `delivered-${s.suburb}-${d.day}`}
                          className="text-[11px] bg-slate-800 text-white font-semibold px-2 py-1 rounded-md disabled:opacity-50"
                        >
                          {busy === `delivered-${s.suburb}-${d.day}` ? "…" : "Mark delivered"}
                        </button>
                      )}
                      {(d.delivered ?? 0) > 0 && (
                        <button
                          onClick={() => advance(s.suburb, "collecting", d.day, d.dayName)}
                          disabled={busy === `collecting-${s.suburb}-${d.day}`}
                          className="text-[11px] bg-green-700 text-white font-semibold px-2 py-1 rounded-md disabled:opacity-50"
                        >
                          {busy === `collecting-${s.suburb}-${d.day}` ? "…" : "Start collecting"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <ul className="divide-y divide-slate-100">
                {s.houses.map((h) => (
                  <li key={h.id} className="py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-slate-900 truncate">{h.name}</p>
                      <p className="text-[11px] text-slate-400 truncate">{h.address}</p>
                    </div>
                    <p className="text-[11px] text-slate-500 shrink-0">
                      {h.councilCollectionDay != null ? DAYS[h.councilCollectionDay] : "—"} · {h.binStatus}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {rows.length === 0 && !err && (
            <p className="text-[13px] text-slate-400">No residential waitlist entries yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
