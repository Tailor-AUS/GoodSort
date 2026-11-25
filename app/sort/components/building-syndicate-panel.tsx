"use client";

import { useState } from "react";
import {
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Flag,
  Hash,
  Lock,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Truck,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { formatCents } from "@/lib/store";
import {
  DROP_SPOT_OPTIONS,
  PICKUP_WINDOW_OPTIONS,
  decideSyndicateMember,
  formatDropSpot,
  formatPickupWindow,
  postSyndicateMessage,
  reportSyndicateMessage,
  requestJoinMySyndicate,
  updateSyndicateCoordination,
  type MySyndicateResponse,
  type SyndicateDropSpot,
  type SyndicatePickupWindow,
} from "@/lib/syndicate-api";

function formatShortTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function BuildingSyndicatePanel({
  data,
  loading,
  onUpdate,
  onRefresh,
}: {
  data: MySyndicateResponse | null;
  loading?: boolean;
  onUpdate: (next: MySyndicateResponse) => void;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [reportedIds, setReportedIds] = useState<Record<string, boolean>>({});

  if (loading && !data) {
    return (
      <div className="rounded-2xl bg-white p-5 shadow-[0_2px_12px_rgba(15,23,42,0.05)] text-center">
        <p className="text-[13px] text-slate-400">Checking your building pool...</p>
      </div>
    );
  }

  if (!data?.eligible || !data.syndicate || !data.myMembership) {
    return (
      <div className="rounded-2xl bg-white p-5 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[15px] font-display font-bold text-slate-900">
              Anonymous Building Syndicates
            </p>
            <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
              {data?.reason ||
                "Live or work in an apartment block or office tower? Add your unit, level, or suite address to unlock an anonymous building channel when another sorter joins."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { syndicate, myMembership } = data;
  const members = data.members ?? [];
  const pendingRequests = data.pendingRequests ?? [];
  const messages = data.messages ?? [];
  const pct = Math.min(100, Math.round((syndicate.totalContainers / syndicate.targetContainers) * 100));
  const isOfficial = syndicate.status === "official";
  const isPaused = syndicate.status === "paused";
  const isApproved = myMembership.status === "approved";
  const isPending = myMembership.status === "pending";
  const isCommercial = syndicate.buildingKind === "commercial";

  async function handleJoin() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await requestJoinMySyndicate();
      onUpdate(next);
      if (next.myMembership?.status === "approved") {
        setNotice(`You opened this anonymous building channel as ${next.myMembership.anonHandle} (Captain).`);
      } else {
        setNotice(`Join request sent as ${next.myMembership?.anonHandle || "Sorter"}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not request to join.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDecision(memberId: string, decision: "approve" | "reject") {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await decideSyndicateMember(memberId, decision);
      onUpdate(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update member request.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCoord(payload: {
    readyToPool?: boolean;
    dropSpot?: SyndicateDropSpot;
    pickupWindow?: SyndicatePickupWindow;
    requestPickup?: boolean;
  }) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await updateSyndicateCoordination(payload);
      onUpdate(next);
      if (payload.requestPickup) {
        setNotice("Building collection requested. Good Sort ops will confirm your pickup slot.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update coordination.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const sent = await postSyndicateMessage(trimmed);
      setDraft("");
      onUpdate({
        ...data!,
        messages: [...messages, sent],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message.");
    } finally {
      setSending(false);
    }
  }

  async function handleReport(messageId: string) {
    setError(null);
    try {
      const res = await reportSyndicateMessage(messageId);
      setReportedIds((prev) => ({ ...prev, [messageId]: true }));
      if (res.hidden) {
        onUpdate({
          ...data!,
          messages: messages.filter((m) => m.id !== messageId),
        });
        setNotice("Message hidden after multiple member flags and sent for admin review.");
      } else {
        setNotice("Message reported to admin moderation.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not report message.");
    }
  }

  // ── STATE 1: DETECTED BUILDING — OPT-IN NOTIFICATION ───────────────────────
  if (!isApproved && !isPending) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl bg-white p-5 shadow-[0_2px_14px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
              <Building2 className="w-3.5 h-3.5" />
              {isCommercial ? "Commercial tower detected" : "Building detected"}
            </span>
            {isOfficial && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-bold text-white">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                Official Syndicate
              </span>
            )}
          </div>

          <h2 className="text-[19px] font-display font-bold text-slate-900">
            {syndicate.displayName}
          </h2>
          <p className="text-[12px] text-slate-500 mt-0.5">
            {syndicate.otherSortersCount > 0
              ? `${syndicate.otherSortersCount} other sorter${syndicate.otherSortersCount === 1 ? "" : "s"} in your building · ${syndicate.totalContainers.toLocaleString()} cans pooled (${formatCents(syndicate.potCents)})`
              : "Start your building's anonymous collection channel and invite neighbours or coworkers."}
          </p>

          <div className="mt-4 rounded-xl bg-slate-50 border border-slate-100 p-3.5 space-y-2">
            <div className="flex items-start gap-2 text-[12px] text-slate-700">
              <Lock className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                <strong>100% anonymous:</strong> you appear only as <strong>Sorter #N</strong>. Your name, email, unit and floor are never shown.
              </span>
            </div>
            <div className="flex items-start gap-2 text-[12px] text-slate-700">
              <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                <strong>Lotto-syndicate pooling:</strong> coordinate drop spots &amp; shared pickups together while your exact <strong>10¢/can</strong> still clears straight to your own PayID.
              </span>
            </div>
          </div>

          {myMembership.status === "rejected" && (
            <p className="mt-3 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              Your previous join request wasn&apos;t approved. You can request again below.
            </p>
          )}

          {error && <p className="mt-3 text-[12px] text-red-600">{error}</p>}

          <button
            type="button"
            disabled={busy || isPaused}
            onClick={handleJoin}
            className="mt-4 w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3.5 text-[14px] shadow-sm active:scale-[0.99] transition-all"
          >
            {isPaused
              ? "Syndicate paused by admin"
              : busy
                ? "Sending request..."
                : syndicate.approvedMembersCount === 0
                  ? "Start anonymous building syndicate"
                  : "Request to join anonymous syndicate"}
          </button>
        </div>
      </div>
    );
  }

  // ── STATE 2: PENDING APPROVAL ──────────────────────────────────────────────
  if (isPending) {
    return (
      <div className="rounded-2xl bg-white p-5 shadow-[0_2px_14px_rgba(15,23,42,0.06)] space-y-4">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">
            <Clock className="w-3.5 h-3.5" />
            Pending approval
          </span>
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh join request status"
            className="h-10 w-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center hover:bg-slate-200 shrink-0"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div>
          <h2 className="text-[18px] font-display font-bold text-slate-900">
            {syndicate.displayName}
          </h2>
          <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
            You requested to join as <strong className="text-slate-800">{myMembership.anonHandle}</strong>. Once your building&apos;s anonymous captain or a Good Sort admin approves, the private channel and pickup board unlock here.
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 p-3.5">
          <div className="flex items-center justify-between text-[12px] font-semibold text-slate-700 mb-1.5">
            <span>Building pool: {syndicate.totalContainers.toLocaleString()} / {syndicate.targetContainers.toLocaleString()} cans</span>
            <span className="text-emerald-700 tabular-nums">{formatCents(syndicate.potCents)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.max(pct, syndicate.totalContainers > 0 ? 3 : 0)}%` }} />
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5">
            Your share: {myMembership.myContainers.toLocaleString()} cans ({myMembership.mySharePct}%) · Paid directly to your PayID
          </p>
        </div>
      </div>
    );
  }

  // ── STATE 3: APPROVED — DISCORD-STYLE ANONYMOUS BUILDING CHANNEL ───────────
  return (
    <div className="space-y-3.5">
      {/* Header + Syndicate Pot Card */}
      <div className="rounded-2xl bg-white p-4 shadow-[0_2px_14px_rgba(15,23,42,0.06)]">
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-0.5 text-[11px] font-mono font-bold text-white">
                <Hash className="w-3 h-3 text-emerald-400" />
                {syndicate.channelName.replace(/^#/, "")}
              </span>
              {isOfficial ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  <ShieldCheck className="w-3 h-3" />
                  Official Syndicate
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  Community Pool
                </span>
              )}
            </div>
            <h2 className="text-[17px] font-display font-bold text-slate-900 truncate">
              {syndicate.displayName}
            </h2>
            <p className="text-[11px] text-slate-500">
              Anonymous handle: <strong className="text-slate-800">{myMembership.anonHandle}</strong>
              {myMembership.role === "captain" ? " · Building Captain" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh building channel"
            className="h-10 w-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center hover:bg-slate-200 shrink-0"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Syndicate Pot & Member Share */}
        <div className="rounded-xl bg-[#f8faf9] border border-emerald-100 p-3.5 mt-3">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
                Building Syndicate Pot
              </p>
              <p className="text-[22px] leading-tight font-display font-bold text-slate-900 tabular-nums mt-0.5">
                {formatCents(syndicate.potCents)}
                <span className="text-[12px] font-medium text-slate-500 ml-1.5">
                  ({syndicate.totalContainers.toLocaleString()} / {syndicate.targetContainers.toLocaleString()} cans)
                </span>
              </p>
            </div>
            <span className="text-[12px] font-bold text-emerald-700 tabular-nums">{pct}%</span>
          </div>

          <div className="h-2 rounded-full bg-emerald-100 overflow-hidden mt-2 mb-2">
            <div
              className="h-full bg-emerald-600 rounded-full transition-all"
              style={{ width: `${Math.max(pct, syndicate.totalContainers > 0 ? 3 : 0)}%` }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
            <span>
              Your share: <strong className="text-slate-900">{myMembership.myContainers.toLocaleString()} cans ({myMembership.mySharePct}%)</strong>
            </span>
            <span>
              <strong className="text-emerald-700">{syndicate.readyCount}</strong>/{syndicate.approvedMembersCount} ready to pool
            </span>
          </div>
        </div>

        {/* Anonymous Members Roster Chips */}
        {members.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {members.map((m) => (
              <span
                key={m.id}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  m.isMe
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${m.readyToPool ? "bg-emerald-400" : "bg-slate-400"}`} />
                {m.anonHandle}
                {m.role === "captain" ? " ★" : ""}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Captain Approval Queue (Anonymous Handles Only) */}
      {myMembership.canApprovePending && pendingRequests.length > 0 && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-amber-950">
            <UserCheck className="w-4 h-4 text-amber-700" />
            <p className="text-[13px] font-bold">
              {pendingRequests.length} anonymous join request{pendingRequests.length === 1 ? "" : "s"}
            </p>
          </div>
          {pendingRequests.map((req) => (
            <div
              key={req.id}
              className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2.5 border border-amber-100"
            >
              <div>
                <p className="text-[13px] font-bold text-slate-900">{req.anonHandle}</p>
                <p className="text-[11px] text-slate-500">Verified at your building street address</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleDecision(req.id, "approve")}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleDecision(req.id, "reject")}
                  aria-label={`Decline ${req.anonHandle}`}
                  className="inline-flex items-center justify-center rounded-lg bg-slate-100 p-1.5 text-slate-600 hover:bg-slate-200 disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Collaborative Collection Booking Card */}
      <div className="rounded-2xl bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)] space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-emerald-600" />
            <p className="text-[14px] font-display font-bold text-slate-900">
              Coordinate Building Pickup
            </p>
          </div>
          <button
            type="button"
            disabled={busy || isPaused}
            onClick={() => handleCoord({ readyToPool: !myMembership.readyToPool })}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition-all disabled:opacity-50 ${
              myMembership.readyToPool
                ? "bg-emerald-600 text-white shadow-sm"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {myMembership.readyToPool ? "Bags ready" : "Mark bags ready"}
          </button>
        </div>

        {/* Drop Spot Vote */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
            Drop spot · Consensus: <span className="text-slate-700">{formatDropSpot(syndicate.dropSpot)}</span>
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {DROP_SPOT_OPTIONS.map((opt) => {
              const votes = syndicate.dropSpotVotes?.[opt.id] ?? 0;
              const mine = myMembership.votedDropSpot === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={busy || isPaused}
                  onClick={() => handleCoord({ dropSpot: opt.id })}
                  className={`flex items-center justify-between rounded-xl px-3 py-2 text-[12px] font-semibold border transition-all disabled:opacity-50 ${
                    mine
                      ? "bg-emerald-50 border-emerald-500 text-emerald-900"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300"
                  }`}
                >
                  <span>{opt.label}</span>
                  <span className="text-[11px] tabular-nums text-slate-500">{votes}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Pickup Window Vote */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
            Pickup window · Consensus: <span className="text-slate-700">{formatPickupWindow(syndicate.pickupWindow)}</span>
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {PICKUP_WINDOW_OPTIONS.map((opt) => {
              const votes = syndicate.pickupWindowVotes?.[opt.id] ?? 0;
              const mine = myMembership.votedPickupWindow === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={busy || isPaused}
                  onClick={() => handleCoord({ pickupWindow: opt.id })}
                  className={`flex flex-col items-center rounded-xl px-2 py-2 text-[11px] font-semibold border transition-all disabled:opacity-50 ${
                    mine
                      ? "bg-emerald-50 border-emerald-500 text-emerald-900"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300"
                  }`}
                >
                  <span>{opt.label}</span>
                  <span className="text-[10px] tabular-nums text-slate-500 mt-0.5">{votes} vote{votes === 1 ? "" : "s"}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Request / Scheduled Pickup Status */}
        {syndicate.pickupStatus === "scheduled" ? (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <div className="text-[12px] text-emerald-950">
              <p className="font-bold">Building collection scheduled</p>
              <p className="text-emerald-800 mt-0.5">
                {formatDropSpot(syndicate.dropSpot)} · {formatPickupWindow(syndicate.pickupWindow)}. Put QR-tagged bags out on time.
              </p>
            </div>
          </div>
        ) : syndicate.pickupStatus === "requested" ? (
          <div className="rounded-xl bg-violet-50 border border-violet-200 p-3 flex items-start gap-2.5">
            <Clock className="w-4 h-4 text-violet-700 shrink-0 mt-0.5" />
            <div className="text-[12px] text-violet-950">
              <p className="font-bold">
                Collection requested{syndicate.pickupRequestedByHandle ? ` by ${syndicate.pickupRequestedByHandle}` : ""}
              </p>
              <p className="text-violet-800 mt-0.5">
                Good Sort ops has your building in the queue ({formatDropSpot(syndicate.dropSpot)} · {formatPickupWindow(syndicate.pickupWindow)}).
              </p>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy || isPaused}
            onClick={() => handleCoord({ requestPickup: true })}
            className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold py-3 text-[13px] active:scale-[0.99] transition-all"
          >
            Request building collection
          </button>
        )}
      </div>

      {/* Discord-Style Anonymous Channel Chat */}
      <div className="rounded-2xl bg-white shadow-[0_2px_12px_rgba(15,23,42,0.05)] overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 bg-slate-50/70">
          <div className="flex items-center gap-1.5 min-w-0">
            <Hash className="w-4 h-4 text-slate-400 shrink-0" />
            <p className="text-[13px] font-bold text-slate-900 truncate">
              {syndicate.channelName.replace(/^#/, "")}
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 shrink-0">
            <Users className="w-3 h-3" />
            {syndicate.approvedMembersCount} anonymous
          </span>
        </div>

        <div className="p-3.5 space-y-2.5 max-h-72 overflow-y-auto bg-white">
          {messages.length === 0 ? (
            <p className="text-center text-[12px] text-slate-400 py-6">
              Say hello anonymously — coordinate bags, drop spots, or building collection days.
            </p>
          ) : (
            messages.map((m) =>
              m.kind === "system" ? (
                <div key={m.id} className="text-center">
                  <span className="inline-block rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-500">
                    {m.body}
                  </span>
                </div>
              ) : (
                <div
                  key={m.id}
                  className={`rounded-xl px-3 py-2.5 ${
                    m.isMine ? "bg-emerald-50/80 border border-emerald-100" : "bg-slate-50 border border-slate-100"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-[12px] font-bold ${
                          m.isMine ? "text-emerald-800" : "text-slate-900"
                        }`}
                      >
                        {m.anonHandle}
                        {m.isMine ? " (You)" : ""}
                      </span>
                      <span className="text-[10px] text-slate-400 tabular-nums">
                        {formatShortTime(m.createdAt)}
                      </span>
                    </div>
                    {!m.isMine && (
                      <button
                        type="button"
                        disabled={Boolean(reportedIds[m.id])}
                        onClick={() => handleReport(m.id)}
                        aria-label={`Report message from ${m.anonHandle}`}
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 hover:text-red-600 disabled:opacity-40"
                      >
                        <Flag className="w-3 h-3" />
                        {reportedIds[m.id] ? "Reported" : "Report"}
                      </button>
                    )}
                  </div>
                  <p className="text-[13px] text-slate-800 leading-snug break-words">{m.body}</p>
                </div>
              ),
            )
          )}
        </div>

        {(error || notice) && (
          <div className="px-4 py-2 border-t border-slate-100">
            {error && <p className="text-[12px] text-red-600">{error}</p>}
            {notice && <p className="text-[12px] text-emerald-700 font-medium">{notice}</p>}
          </div>
        )}

        <form onSubmit={handleSend} className="p-3 border-t border-slate-100 flex items-center gap-2 bg-slate-50/60">
          <input
            type="text"
            maxLength={280}
            value={draft}
            disabled={sending || isPaused}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              isPaused
                ? "Channel paused by admin"
                : `Message ${syndicate.channelName} as ${myMembership.anonHandle}...`
            }
            aria-label="Anonymous building channel message"
            className="flex-1 min-h-[44px] rounded-xl bg-white border border-slate-200 px-3.5 py-2.5 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
          />
          <button
            type="submit"
            disabled={sending || isPaused || !draft.trim()}
            aria-label="Send anonymous message"
            className="h-11 w-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white flex items-center justify-center shrink-0 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
