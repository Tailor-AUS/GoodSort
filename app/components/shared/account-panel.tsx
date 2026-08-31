"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, Package, Leaf, Truck, Wallet, LogOut, CheckCircle, Users, Gift, Trash2, Car } from "lucide-react";
import { apiUrl, authHeaders, readStoredProfileId } from "@/lib/config";
import { formatCents, type User } from "@/lib/store";
import { inviteMessage, isCollecting, LIVE_VOLUME_THRESHOLD, sameSuburb, streetInviteUrl, streetStatsForViewer, titleSuburb, type GrowthSuburb, householdCountsTowardUnlock, canonicalSuburb } from "@/lib/brisbane";
import { InviteActions } from "@/app/components/shared/invite-actions";

interface AccountPanelProps {
  user: User;
  open: boolean;
  onClose: () => void;
}

export function AccountPanel({ user, open, onClose }: AccountPanelProps) {
  const [binStatus, setBinStatus] = useState<string | null>(null);
  const [streetStats, setStreetStats] = useState<{ households: number; containers: number; needed: number; dayName: string | null } | null>(null);

  useEffect(() => {
    if (!open) return;
    try {
      const profile = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
      if (!profile.householdId) return;
      Promise.all([
        fetch(apiUrl(`/api/households/${profile.householdId}`), { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)),
        fetch(apiUrl("/api/growth/brisbane")).then((r) => (r.ok ? r.json() : null)),
      ]).then(([hh, g]) => {
        if (hh?.binStatus) setBinStatus(hh.binStatus);
        const match = g?.suburbs?.find((s: GrowthSuburb) => sameSuburb(s.suburb, hh?.suburb));
        const cluster = streetStatsForViewer(match, hh?.councilCollectionDay, householdCountsTowardUnlock(hh));
        setStreetStats({ households: cluster.households, containers: cluster.containers, needed: cluster.needed, dayName: cluster.dayName });
      }).catch(() => {});
    } catch { /* ignore */ }
  }, [open]);

  if (!open) return null;

  const waiting = !isCollecting(binStatus);
  // Show email when name is default "New User" or "You"
  const displayName = (user.name === "New User" || user.name === "You")
    ? (() => { try { const p = JSON.parse(localStorage.getItem("goodsort_profile") || "{}"); return p.phone || p.email || user.name; } catch { return user.name; } })()
    : user.name;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/20 touch-none" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-80 max-w-[85vw] glass-strong overflow-y-auto animate-slide-in-right border-l border-white/40 shadow-2xl">
        <div className="p-6 border-b border-slate-100/60" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))" }}>
          <div className="flex justify-between items-start mb-6">
            <div>
              <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Account</p>
              <h2 className="text-xl font-display font-extrabold text-slate-900 mt-1">{displayName}</h2>
            </div>
            <button onClick={onClose} className="p-2.5 -mr-1 text-slate-400 hover:text-slate-600 transition-colors duration-200 min-w-[44px] min-h-[44px] flex items-center justify-center">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
            <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-[0.15em]">{waiting ? "Credits after collection" : "Available"}</p>
            <p className="text-3xl font-display font-extrabold text-slate-900 mt-1">{formatCents(user.clearedCents)}</p>
            {user.pendingCents > 0 && (
              <p className="text-green-600/60 text-sm font-medium mt-0.5">+ {formatCents(user.pendingCents)} pending</p>
            )}
          </div>
        </div>

        <div className="p-6 border-b border-slate-100">
          {waiting ? (
            <div className="grid grid-cols-3 gap-2">
              <StatCard icon={Package} label="Scanned" value={(streetStats?.containers ?? 0).toLocaleString()} />
              <StatCard icon={Gift} label="Still need" value={(streetStats?.needed ?? LIVE_VOLUME_THRESHOLD).toLocaleString()} />
              <StatCard icon={Users} label="Scanners" value={(streetStats?.households ?? 0).toString()} />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <StatCard icon={Package} label="Scanned" value={user.totalContainers.toString()} />
              <StatCard icon={Leaf} label="CO2" value={`${user.totalCO2SavedKg.toFixed(1)}kg`} />
              <StatCard icon={Truck} label="Routes" value={user.collections.length.toString()} />
            </div>
          )}
        </div>

        <div className="p-6">
          {waiting ? (
            <p className="text-[13px] text-slate-500 mb-1">Scan for 5¢. Invite neighbours to scan — suburb volume unlocks a driver trip.</p>
          ) : (
            <>
          <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-[0.15em] mb-3">
            {user.collections.length > 0 ? "Collections" : "Scans"} ({user.collections.length > 0 ? user.collections.length : user.scans.length})
          </p>

          {user.collections.length > 0 ? (
            <div className="space-y-0 max-h-64 overflow-y-auto">
              {user.collections.map((c) => (
                <div key={c.id} className="flex justify-between items-center py-2.5 border-b border-slate-50 last:border-0">
                  <div>
                    <p className="text-[13px] text-slate-700 font-medium">{c.stopCount} stops &middot; {c.totalContainers} containers</p>
                    <p className="text-[11px] text-slate-400">{new Date(c.timestamp).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border bg-green-100 text-green-700 border-green-200">
                    +{formatCents(c.earnedCents)}
                  </span>
                </div>
              ))}
            </div>
          ) : user.scans.length > 0 ? (
            <div className="space-y-0 max-h-64 overflow-y-auto">
              {user.scans.slice(0, 15).map((scan) => (
                <div key={scan.id} className="flex justify-between items-center py-2.5 border-b border-slate-50 last:border-0">
                  <div>
                    <p className="text-[13px] text-slate-700 font-medium">{scan.containerName}</p>
                    <p className="text-[11px] text-slate-400">{new Date(scan.timestamp).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${scan.status === "settled" ? "bg-green-100 text-green-700 border-green-200" : "bg-amber-100 text-amber-700 border-amber-200"}`}>
                    {scan.refundCents}c
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-400 text-[13px]">No activity yet</p>
          )}
            </>
          )}

          <CashoutSection clearedCents={user.clearedCents} waiting={waiting} />

          <InviteFriends user={user} />

          <Link href="/runner/signup"
            className="mt-3 w-full text-slate-600 hover:text-slate-900 font-medium py-3 rounded-xl text-[13px] transition-colors flex items-center justify-center gap-2">
            <Car className="w-4 h-4" />
            Become a Runner
          </Link>

          <button
            onClick={() => {
              localStorage.removeItem("goodsort_token");
              localStorage.removeItem("goodsort_profile");
              document.cookie = "goodsort_token=; path=/; max-age=0";
              window.location.href = "/login";
            }}
            className="mt-3 w-full text-slate-500 hover:text-slate-900 font-medium py-3 rounded-xl text-[13px] transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Log Out
          </button>

          <button
            onClick={async () => {
              if (!confirm("Permanently delete your account, all scans and earnings? This cannot be undone.")) return;
              const token = localStorage.getItem("goodsort_token");
              const profile = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
              if (!profile.id || !token) return;
              const res = await fetch(apiUrl(`/api/profiles/${profile.id}`), {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
              });
              if (res.ok) {
                localStorage.clear();
                document.cookie = "goodsort_token=; path=/; max-age=0";
                window.location.href = "/";
              } else {
                alert("Failed to delete account. Please try again.");
              }
            }}
            className="w-full text-red-500 hover:text-red-600 font-medium py-3 rounded-xl text-[12px] transition-colors flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Delete Account
          </button>
        </div>
      </div>
    </>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-200">
      <Icon className="w-4 h-4 text-green-600/60 mx-auto mb-1.5" />
      <p className="text-base font-display font-extrabold text-slate-900">{value}</p>
      <p className="text-[9px] text-slate-400 uppercase tracking-[0.15em] mt-0.5">{label}</p>
    </div>
  );
}

function InviteFriends({ user: _user }: { user: User }) {
  const [suburb, setSuburb] = useState<string | null>(null);
  const [binDay, setBinDay] = useState<number | null>(null);
  const [growth, setGrowth] = useState<GrowthSuburb | null>(null);
  const [building, setBuilding] = useState(false);
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  const inviteUrl = streetInviteUrl({ suburb, day: binDay, profileId });

  useEffect(() => {
    try {
      setProfileId(readStoredProfileId());
      const profile = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
      if (!profile.householdId) return;
      Promise.all([
        fetch(apiUrl(`/api/households/${profile.householdId}`), { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)),
        fetch(apiUrl("/api/growth/brisbane")).then((r) => (r.ok ? r.json() : null)),
      ])
        .then(([hh, g]) => {
          if (hh?.suburb) setSuburb(hh.suburb);
          if (hh?.councilCollectionDay != null) setBinDay(hh.councilCollectionDay);
          setBuilding(hh?.type === "unit_complex");
          const match = g?.suburbs?.find((s: GrowthSuburb) => sameSuburb(s.suburb, hh?.suburb));
          if (match) setGrowth(match);
        })
        .catch(() => {});
    } catch { /* ignore */ }
  }, []);

  const cluster = streetStatsForViewer(growth, binDay, !building);
  const needed = cluster.needed;
  const waiting = cluster.households;
  const dayLive = cluster.live;
  const message = inviteMessage(inviteUrl, suburb, {
    dayName: cluster?.dayName,
    containers: cluster.containers,
    households: waiting,
    needed,
    live: dayLive,
  });

  return (
    <div className="mt-5 bg-green-50 border border-green-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Users className="w-4 h-4 text-green-600" />
        <p className="text-[13px] font-bold text-green-800">Invite the street</p>
      </div>
      <p className="text-[12px] text-green-700/70 mb-3">
        {building
          ? (dayLive
            ? "Suburb volume can run a driver trip. Common-area pickups are phase 2 — invite more houses to scan."
            : `${waiting} house${waiting === 1 ? "" : "s"} scanning near ${titleSuburb(suburb ?? "") || "your suburb"}. You do not count toward suburb volume. Invite a house to scan.`)
          : (dayLive
          ? "Enough scanned volume for a driver trip. Share so the first run is full."
          : `${(cluster.containers ?? waiting).toLocaleString()} container${(cluster.containers ?? waiting) === 1 ? "" : "s"} scanned in ${titleSuburb(suburb ?? "") || "your suburb"}. ${needed.toLocaleString()} more for a driver trip. Every neighbour who scans gets your suburb collected sooner.`)}
      </p>
      {(building || canonicalSuburb(suburb) !== null) && (
        <InviteActions url={inviteUrl} message={message} compact />
      )}
    </div>
  );
}

function CashoutSection({ clearedCents, waiting }: { clearedCents: number; waiting?: boolean }) {
  const [showForm, setShowForm] = useState(false);
  const [bsb, setBsb] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [payoutsOpen, setPayoutsOpen] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(apiUrl("/api/cashout/status"))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.open === "boolean") setPayoutsOpen(d.open); })
      .catch(() => setPayoutsOpen(false));
  }, []);

  const minCashout = 2000; // $20 in cents
  const canCashout = payoutsOpen === true && clearedCents >= minCashout;

  async function handleCashout() {
    if (!canCashout || !bsb || !accountNumber || !accountName) return;
    const cleanBsb = bsb.replace(/\D/g, "");
    const cleanAccount = accountNumber.replace(/\D/g, "");
    if (cleanBsb.length !== 6) { setError("BSB must be 6 digits"); return; }
    if (cleanAccount.length < 6 || cleanAccount.length > 9) { setError("Account number must be 6-9 digits"); return; }
    if (accountName.trim().length < 2) { setError("Please enter the account holder name"); return; }
    setLoading(true);
    setError("");

    try {
      const userId = (() => { try { return JSON.parse(localStorage.getItem("goodsort_profile") || "{}").id; } catch { return ""; } })();
      const res = await fetch(apiUrl("/api/cashout"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          userId,
          amountCents: clearedCents,
          bsb: bsb.replace(/\D/g, ""),
          accountNumber: accountNumber.replace(/\D/g, ""),
          accountName,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Cashout failed");
        setLoading(false);
        return;
      }

      setSuccess(true);
      setLoading(false);
    } catch {
      setError("Something went wrong");
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="mt-6 bg-green-50 border border-green-200 rounded-xl p-4 text-center">
        <CheckCircle className="w-6 h-6 text-green-600 mx-auto mb-2" />
        <p className="text-[13px] font-semibold text-green-700">Cashout requested</p>
        <p className="text-[11px] text-green-600 mt-1">Queued for the next weekly bank file. Not sent yet.</p>
      </div>
    );
  }

  const remaining = Math.max(0, minCashout - clearedCents);
  const moreContainers = Math.ceil(remaining / 5); // 5c per eligible container
  const [showHint, setShowHint] = useState(false);
  if (!showForm) {
    return (
      <div className="mt-6">
        <button
          onClick={() => canCashout ? setShowForm(true) : setShowHint(v => !v)}
          className={`w-full py-3 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 transition-all ${
            canCashout
              ? "bg-gradient-to-b from-green-500 to-green-600 text-white shadow-lg shadow-green-600/20"
              : "bg-white border border-slate-200 text-slate-700 hover:border-green-300"
          }`}
        >
          <Wallet className="w-4 h-4" />
          {canCashout
            ? `Cash Out $${(clearedCents / 100).toFixed(2)}`
            : `Cash Out  ·  $${(clearedCents / 100).toFixed(2)} available`}
        </button>
        {!canCashout && showHint && (
          <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-[12px] text-amber-900 leading-relaxed">
            {payoutsOpen === false
              ? <>Bank transfers are not live yet. Credits stay on your account. Keep sorting — scan is optional.</>
              : waiting
              ? <>Credits start after we collect and a depot verifies the containers. Scan is optional. Cash out from $20 once payouts are open.</>
              : <>You need <b>$20</b> to cash out. You have <b>${(clearedCents / 100).toFixed(2)}</b>, just <b>${(remaining / 100).toFixed(2)}</b> to go (≈ {moreContainers} more container{moreContainers === 1 ? "" : "s"}).</>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-6 bg-slate-50 border border-slate-200 rounded-xl p-4">
      <div className="flex justify-between items-center mb-3">
        <p className="text-[13px] font-semibold text-slate-900">Cash Out ${(clearedCents / 100).toFixed(2)}</p>
        <button onClick={() => setShowForm(false)} className="text-slate-400 text-[11px]">Cancel</button>
      </div>

      <div className="space-y-2.5">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">BSB</label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={7}
            value={bsb}
            onChange={(e) => setBsb(e.target.value)}
            placeholder="000-000"
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">Account Number</label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={9}
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="Account number"
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">Account Name</label>
          <input
            type="text"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="John Smith"
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
          />
        </div>
      </div>

      {error && <p className="text-red-500 text-[11px] mt-2">{error}</p>}

      <button
        onClick={handleCashout}
        disabled={loading || !bsb || !accountNumber || !accountName}
        className="mt-3 w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3 rounded-xl text-[13px] shadow-lg shadow-green-600/20 disabled:opacity-50 min-h-[44px]"
      >
        {loading ? "Processing..." : `Transfer $${(clearedCents / 100).toFixed(2)}`}
      </button>

      <p className="text-[10px] text-slate-400 mt-2 text-center">
        Weekly bank file — only after payouts are switched on.
      </p>
    </div>
  );
}
