"use client";

import { useState } from "react";
import { X, Package, Leaf, Truck, Wallet, LogOut, DollarSign, CheckCircle, Share2, Users, Gift } from "lucide-react";
import { apiUrl } from "@/lib/config";
import { formatCents, type User } from "@/lib/store";

interface AccountPanelProps {
  user: User;
  open: boolean;
  onClose: () => void;
}

export function AccountPanel({ user, open, onClose }: AccountPanelProps) {
  if (!open) return null;

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
            <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-[0.15em]">Available</p>
            <p className="text-3xl font-display font-extrabold text-slate-900 mt-1">{formatCents(user.clearedCents)}</p>
            {user.pendingCents > 0 && (
              <p className="text-green-600/60 text-sm font-medium mt-0.5">+ {formatCents(user.pendingCents)} pending</p>
            )}
          </div>
        </div>

        <div className="p-6 border-b border-slate-100">
          <div className="grid grid-cols-3 gap-2">
            <StatCard icon={Package} label="Scanned" value={user.totalContainers.toString()} />
            <StatCard icon={Leaf} label="CO2" value={`${user.totalCO2SavedKg.toFixed(1)}kg`} />
            <StatCard icon={Truck} label="Routes" value={user.collections.length.toString()} />
          </div>
        </div>

        <div className="p-6">
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

          <CashoutSection clearedCents={user.clearedCents} />

          <InviteFriends user={user} />

          <button
            onClick={() => {
              localStorage.removeItem("goodsort_token");
              localStorage.removeItem("goodsort_profile");
              document.cookie = "goodsort_token=; path=/; max-age=0";
              window.location.href = "/login";
            }}
            className="mt-3 w-full text-red-500 hover:text-red-600 font-medium py-3 rounded-xl text-[13px] transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Log Out
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

function InviteFriends({ user }: { user: User }) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  const inviteUrl = "https://www.thegoodsort.org/start";
  const inviteText = user.totalContainers > 0
    ? `I've recycled ${user.totalContainers} container${user.totalContainers !== 1 ? "s" : ""} and earned ${formatCents(user.pendingCents + user.clearedCents)} with The Good Sort! Scan your cans and bottles, earn 5c each. Join me:`
    : "I just joined The Good Sort — scan your empty cans and bottles to earn 5c each. Give it a go:";

  async function handleShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "Join The Good Sort",
          text: inviteText,
          url: inviteUrl,
        });
        setShared(true);
        setTimeout(() => setShared(false), 3000);
      } catch {
        // User cancelled share — that's fine
      }
    } else {
      handleCopy();
    }
  }

  function handleCopy() {
    navigator.clipboard?.writeText(`${inviteText} ${inviteUrl}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-5 bg-green-50 border border-green-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Users className="w-4 h-4 text-green-600" />
        <p className="text-[13px] font-bold text-green-800">Invite Friends</p>
      </div>
      <p className="text-[12px] text-green-700/70 mb-3">
        Get your mates sorting! Share The Good Sort and help keep QLD clean.
      </p>
      <button
        onClick={handleShare}
        className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-bold py-3 rounded-xl text-[13px] shadow-lg shadow-green-600/20 min-h-[44px] active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
      >
        {shared ? (
          <><CheckCircle className="w-4 h-4" /> Shared!</>
        ) : copied ? (
          <><CheckCircle className="w-4 h-4" /> Copied!</>
        ) : (
          <><Share2 className="w-4 h-4" /> Invite Friends</>
        )}
      </button>
    </div>
  );
}

function CashoutSection({ clearedCents }: { clearedCents: number }) {
  const [showForm, setShowForm] = useState(false);
  const [showMinPrompt, setShowMinPrompt] = useState(false);
  const [bsb, setBsb] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const minCashout = 2000; // $20 in cents
  const canCashout = clearedCents >= minCashout;
  const remainingCents = Math.max(0, minCashout - clearedCents);
  const remainingContainers = Math.ceil(remainingCents / 5);

  async function handleCashout() {
    if (!canCashout || !bsb || !accountNumber || !accountName) return;
    const cleanBsb = bsb.replace(/\D/g, "");
    const cleanAccount = accountNumber.replace(/\D/g, "");
    if (cleanBsb.length !== 6) { setError("BSB must be 6 digits"); return; }
    if (cleanAccount.length < 6 || cleanAccount.length > 10) { setError("Account number must be 6-10 digits"); return; }
    if (accountName.trim().length < 2) { setError("Please enter the account holder name"); return; }
    setLoading(true);
    setError("");

    try {
      const userId = (() => { try { return JSON.parse(localStorage.getItem("goodsort_profile") || "{}").id; } catch { return ""; } })();
      const res = await fetch(apiUrl("/api/cashout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        <p className="text-[13px] font-semibold text-green-700">Cashout requested!</p>
        <p className="text-[11px] text-green-600 mt-1">You'll receive a bank transfer within 5 business days</p>
      </div>
    );
  }

  if (!showForm) {
    return (
      <div className="mt-6">
        <button
          onClick={() => canCashout ? setShowForm(true) : setShowMinPrompt(true)}
          className={`w-full py-3 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 transition-all ${
            canCashout
              ? "bg-gradient-to-b from-green-500 to-green-600 text-white shadow-lg shadow-green-600/20"
              : "bg-gradient-to-b from-green-500 to-green-600 text-white/90 shadow-lg shadow-green-600/20 opacity-80"
          }`}
        >
          <Wallet className="w-4 h-4" />
          {canCashout
            ? `Cash Out $${(clearedCents / 100).toFixed(2)}`
            : `Cash Out`
          }
        </button>
        {!canCashout && showMinPrompt && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-[13px] font-semibold text-amber-900">You need $20 to cash out</p>
            <p className="text-[12px] text-amber-800 mt-1">
              You have ${(clearedCents / 100).toFixed(2)} — just ${(remainingCents / 100).toFixed(2)} to go
              {remainingContainers > 0 ? ` (~${remainingContainers} more container${remainingContainers !== 1 ? "s" : ""})` : ""}.
            </p>
            <p className="text-[11px] text-amber-700 mt-2">Keep scanning to reach the minimum.</p>
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
            placeholder="062-000"
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
            placeholder="12345678"
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
        Bank transfers are processed weekly via ABA batch file
      </p>
    </div>
  );
}
