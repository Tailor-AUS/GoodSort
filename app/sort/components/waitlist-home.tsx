"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Award,
  Building2,
  Check,
  ChevronRight,
  Copy,
  Flame,
  Gift,
  HelpCircle,
  Home,
  Leaf,
  MapPin,
  Package,
  Plus,
  Printer,
  ScanBarcode,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Truck,
  User as UserIcon,
  Users,
  Wallet,
} from "lucide-react";
import {
  LIVE_VOLUME_THRESHOLD,
  inviteMessage,
  residentialNeedsStreet,
  streetInviteUrl,
  titleSuburb,
  canonicalSuburb,
} from "@/lib/brisbane";
import { formatCredit } from "@/lib/credit";
import { apiUrl, authHeaders, readStoredProfileId } from "@/lib/config";
import { formatCents, type User } from "@/lib/store";
import { buildSorterLoyaltySummary, bucketScanMaterial } from "@/lib/sorter-loyalty";
import { WaitlistCard } from "@/app/components/shared/waitlist-card";
import { CollectionNightCard } from "@/app/components/shared/collection-night-card";
import { InviteActions } from "@/app/components/shared/invite-actions";
import { MemberStatusCard } from "./member-status-card";
import { BuildingSyndicatePanel } from "./building-syndicate-panel";
import { fetchMySyndicate, type MySyndicateResponse } from "@/lib/syndicate-api";
import type { HouseholdStatus } from "./sorter-sheet";

type AppTab = "home" | "pickups" | "points" | "profile";
type PickupsFilter = "upcoming" | "building" | "bags" | "suburb";
type PointsFilter = "earn" | "rewards";

const STREAMS = [
  { key: "aluminium" as const, label: "Cans", short: "ALU", hint: "Aluminium (GSB-ALU)", dot: "bg-blue-500", soft: "bg-blue-50 text-blue-700" },
  { key: "clearPet" as const, label: "Clear PET", short: "CLR", hint: "Clear plastic (GSB-CLR)", dot: "bg-teal-500", soft: "bg-teal-50 text-teal-700" },
  { key: "coloured" as const, label: "Coloured", short: "COL", hint: "Coloured PET & cartons", dot: "bg-amber-500", soft: "bg-amber-50 text-amber-800" },
  { key: "glass" as const, label: "Glass", short: "GLS", hint: "Bottles & jars (GSB-GLS)", dot: "bg-emerald-600", soft: "bg-emerald-50 text-emerald-800" },
];

const STREAM_DOT_BY_KEY = {
  aluminium: "bg-blue-500",
  clearPet: "bg-teal-500",
  coloured: "bg-amber-500",
  glass: "bg-emerald-600",
} as const;

function resolveFirstName(user: User): string {
  const raw = (user.name || "").trim();
  if (raw && raw !== "New User" && raw !== "You") return raw.split(/\s+/)[0];
  if (typeof window !== "undefined") {
    try {
      const p = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
      if (typeof p.name === "string" && p.name.trim() && p.name !== "New User" && p.name !== "You") {
        return p.name.trim().split(/\s+/)[0];
      }
      if (typeof p.email === "string" && p.email.includes("@")) {
        const local = p.email.split("@")[0];
        return local.charAt(0).toUpperCase() + local.slice(1);
      }
    } catch {
      /* ignore */
    }
  }
  return "there";
}

function formatShortMemberId(id: string): string {
  const clean = (id || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!clean) return "TGS-000001";
  return `TGS-${clean.slice(0, 8)}`;
}

export function WaitlistHome({
  user,
  household,
  nextPickup,
  pickupConfirmed,
  onScanPress,
  onOpenAccount,
}: {
  user: User;
  household: HouseholdStatus | null;
  nextPickup: string | null;
  pickupConfirmed?: boolean;
  onScanPress?: () => void;
  onOpenAccount?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [pickupsFilter, setPickupsFilter] = useState<PickupsFilter>("upcoming");
  const [pointsFilter, setPointsFilter] = useState<PointsFilter>("earn");
  const [firstName, setFirstName] = useState("there");
  const [copiedMemberId, setCopiedMemberId] = useState(false);
  const [showInviteSheet, setShowInviteSheet] = useState(false);

  const suburb = household?.suburb;
  const building = household?.type === "unit_complex";
  const have = household?.households ?? (building ? 0 : 1);
  const containers = household?.containers ?? 0;
  const needed = household?.needed ?? Math.max(0, LIVE_VOLUME_THRESHOLD - containers);
  const live = !!household?.areaLive;
  const dayName = household?.dayName;
  const pct = Math.min(100, Math.round((containers / LIVE_VOLUME_THRESHOLD) * 100));
  const place = suburb ? titleSuburb(suburb) : "Brisbane";

  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  const [network, setNetwork] = useState<{ sortersCount: number; referredContainers: number; totalNetworkCents: number } | null>(null);
  const [hasPayoutDetails, setHasPayoutDetails] = useState<boolean | null>(null);
  const [syndicateData, setSyndicateData] = useState<MySyndicateResponse | null>(null);
  const [syndicateLoading, setSyndicateLoading] = useState(false);

  function refreshSyndicate() {
    setSyndicateLoading(true);
    fetchMySyndicate()
      .then((d) => { if (d) setSyndicateData(d); })
      .catch(() => {})
      .finally(() => setSyndicateLoading(false));
  }

  useEffect(() => {
    setFirstName(resolveFirstName(user));
    const pid = readStoredProfileId();
    setProfileId(pid);
    if (pid) {
      fetch(apiUrl(`/api/profiles/${pid}/network`), { headers: authHeaders() })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d) setNetwork(d); })
        .catch(() => {});
      fetch(apiUrl("/api/profiles/me/payout"), { headers: authHeaders() })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d && typeof d.hasPayoutDetails === "boolean") setHasPayoutDetails(d.hasPayoutDetails); })
        .catch(() => {});
      refreshSyndicate();
    }
  }, [user]);

  const summary = buildSorterLoyaltySummary(user, network);
  const recentScans = (user.scans || []).slice(0, 6);
  const inviteUrl = streetInviteUrl({ suburb, day: household?.councilCollectionDay, dayName, profileId });
  const message = inviteMessage(inviteUrl, suburb, { dayName, containers, households: have, needed, live });
  const memberCode = formatShortMemberId(user.id);
  const canInviteSuburb = building || canonicalSuburb(suburb) !== null;

  async function copyMemberCode() {
    try {
      await navigator.clipboard.writeText(memberCode);
      setCopiedMemberId(true);
      setTimeout(() => setCopiedMemberId(false), 1800);
    } catch {
      /* ignore */
    }
  }

  function handleScanClick() {
    if (onScanPress) onScanPress();
    else window.location.href = "/scan";
  }

  return (
    <div className="min-h-dvh bg-[#f4f5f7] text-slate-900 pb-28">
      <div className="mx-auto w-full max-w-[430px]">
        {/* ══════════════════ TAB 1: HOME ══════════════════ */}
        {activeTab === "home" && (
          <div className="px-5" style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}>
            {/* Top Bar: Help pill (left) + Metallic Tier Card pill (right) */}
            <div className="flex items-center justify-between mb-6">
              <Link
                href="/guides/containers-for-change-brisbane"
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-800 shadow-[0_2px_8px_rgba(15,23,42,0.06)] active:scale-[0.97] transition-transform"
              >
                <HelpCircle className="w-4 h-4 text-slate-600" />
                Help
              </Link>
              <button
                type="button"
                onClick={() => setActiveTab("profile")}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-bold shadow-[0_2px_10px_rgba(15,23,42,0.1)] active:scale-[0.97] transition-transform ${summary.tier.pillClass}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/tgs-glass-icon.webp"
                  alt=""
                  aria-hidden="true"
                  width={18}
                  height={18}
                  className="h-[18px] w-[18px] rounded-[4px]"
                />
                Card
              </button>
            </div>

            {/* Calm Personal Greeting */}
            <h1 className="text-[28px] leading-tight font-display font-bold tracking-tight text-slate-900 mb-4">
              Hi {firstName}
            </h1>

            {/* Elevated White Points & Status Hero Strip */}
            <button
              type="button"
              onClick={() => setActiveTab("profile")}
              className="w-full text-left rounded-2xl bg-white px-5 py-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)] flex items-center justify-between gap-3 mb-7 active:scale-[0.99] transition-transform"
            >
              <div className="flex items-center gap-6 min-w-0">
                <div>
                  <p className="text-[12px] font-medium text-slate-500">Points</p>
                  <p className="text-[24px] leading-tight font-display font-bold text-slate-900 tabular-nums mt-0.5">
                    {summary.goodSortPoints.toLocaleString()}
                  </p>
                </div>
                <div className="h-9 w-px bg-slate-200/80" />
                <div>
                  <p className="text-[12px] font-medium text-slate-500">Status</p>
                  <p className="text-[24px] leading-tight font-display font-bold text-slate-900 tabular-nums mt-0.5">
                    {summary.totalContainers.toLocaleString()}
                  </p>
                </div>
              </div>
              <div
                className={`h-11 w-11 shrink-0 rounded-full bg-gradient-to-br ${summary.tier.medallionGradient} flex items-center justify-center shadow-inner`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/tgs-glass-icon.webp"
                  alt=""
                  aria-hidden="true"
                  width={26}
                  height={26}
                  className="h-6 w-6 drop-shadow-[0_2px_4px_rgba(0,0,0,0.25)]"
                />
              </div>
            </button>

            {/* Setup prompt if address or PayID still missing */}
            {residentialNeedsStreet(household) ? (
              <Link
                href="/onboard"
                className="mb-6 flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3.5 shadow-[0_2px_10px_rgba(15,23,42,0.05)]"
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-slate-900">Add home address &amp; payout</p>
                  <p className="text-[11px] text-slate-500">So we can collect &amp; pay your 10¢ credits</p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
              </Link>
            ) : hasPayoutDetails === false ? (
              <Link
                href="/onboard"
                className="mb-6 flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3.5 shadow-[0_2px_10px_rgba(15,23,42,0.05)]"
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-slate-900">Add PayID or bank details</p>
                  <p className="text-[11px] text-slate-500">Ready for cashout once verified at depot</p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
              </Link>
            ) : null}

            {/* Section: Sort and explore (4x2 Calm White Tile Grid) */}
            <h2 className="text-[17px] font-display font-bold text-slate-900 mb-3.5">
              Sort and explore
            </h2>
            <div className="grid grid-cols-4 gap-3 mb-7">
              <ActionTile
                label="Scan"
                icon={<ScanBarcode className="w-6 h-6 text-emerald-600" strokeWidth={1.75} />}
                onClick={handleScanClick}
              />
              <ActionTileLink
                label="Home Bags"
                href="/bags"
                icon={<Package className="w-6 h-6 text-blue-600" strokeWidth={1.75} />}
              />
              <ActionTileLink
                label="Suburb Map"
                href="/marketplace"
                icon={<MapPin className="w-6 h-6 text-teal-600" strokeWidth={1.75} />}
              />
              <ActionTile
                label="Payouts"
                icon={<Wallet className="w-6 h-6 text-slate-800" strokeWidth={1.75} />}
                onClick={() => onOpenAccount?.()}
              />
              <ActionTileLink
                label="Invite"
                href="/invite"
                icon={<Users className="w-6 h-6 text-amber-600" strokeWidth={1.75} />}
              />
              <ActionTileLink
                label="Flyer"
                href="/flyer"
                icon={<Printer className="w-6 h-6 text-slate-700" strokeWidth={1.75} />}
              />
              <ActionTileLink
                label="Household"
                href="/household"
                icon={<Home className="w-6 h-6 text-violet-600" strokeWidth={1.75} />}
              />
              {/* 2x2 Mini Stream Cluster Tile (mirrors 2x2 "All products" tile) */}
              <button
                type="button"
                onClick={() => setActiveTab("points")}
                className="flex flex-col items-center group"
              >
                <div className="w-full aspect-square rounded-2xl bg-transparent grid grid-cols-2 gap-1.5 group-active:scale-[0.95] transition-transform">
                  {STREAMS.map((s) => (
                    <div
                      key={s.key}
                      className="rounded-xl bg-white shadow-[0_1px_6px_rgba(15,23,42,0.05)] flex flex-col items-center justify-center"
                    >
                      <span className={`h-2 w-2 rounded-full ${s.dot} mb-0.5`} />
                      <span className="text-[10px] font-bold text-slate-800 tabular-nums leading-none">
                        {summary.streams[s.key]}
                      </span>
                    </div>
                  ))}
                </div>
                <span className="text-[11px] font-medium text-slate-700 text-center mt-1.5 leading-tight">
                  4 Streams
                </span>
              </button>
            </div>

            {/* Anonymous Building Syndicate Notification / Quick Entry Card */}
            {syndicateData?.eligible && syndicateData.syndicate && syndicateData.myMembership && (
              <button
                type="button"
                onClick={() => {
                  setPickupsFilter("building");
                  setActiveTab("pickups");
                }}
                className="w-full text-left mb-6 rounded-2xl bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.06)] border border-emerald-100 flex items-center justify-between gap-3 active:scale-[0.99] transition-transform"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-[14px] font-display font-bold text-slate-900 truncate">
                        {syndicateData.myMembership.status === "approved"
                          ? syndicateData.syndicate.channelName
                          : syndicateData.myMembership.status === "pending"
                            ? `Pending · ${syndicateData.syndicate.displayName}`
                            : "Building syndicate detected"}
                      </p>
                      {syndicateData.syndicate.status === "official" && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                          <ShieldCheck className="w-3 h-3" /> Official
                        </span>
                      )}
                      {syndicateData.myMembership.canApprovePending && syndicateData.syndicate.pendingRequestsCount > 0 && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                          {syndicateData.syndicate.pendingRequestsCount} to approve
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-slate-500 mt-0.5 truncate">
                      {syndicateData.myMembership.status === "approved"
                        ? `${syndicateData.syndicate.totalContainers.toLocaleString()} cans (${formatCents(syndicateData.syndicate.potCents)}) · ${syndicateData.syndicate.approvedMembersCount} anonymous`
                        : syndicateData.myMembership.status === "pending"
                          ? "Join request sent — waiting for captain or admin approval"
                          : syndicateData.syndicate.otherSortersCount > 0
                            ? `${syndicateData.syndicate.otherSortersCount} other sorter${syndicateData.syndicate.otherSortersCount === 1 ? "" : "s"} at ${syndicateData.syndicate.displayName} — tap to request to join`
                            : `Start ${syndicateData.syndicate.displayName}'s anonymous building pool`}
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
              </button>
            )}

            {/* Editorial Suburb Run Section (mirrors Flight deals photo card) */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[17px] font-display font-bold text-slate-900">
                Your suburb run
              </h2>
              <Link
                href="/marketplace"
                className="inline-flex items-center gap-0.5 rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-slate-700 shadow-[0_1px_4px_rgba(15,23,42,0.06)]"
              >
                View map <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="overflow-hidden rounded-2xl bg-white shadow-[0_2px_14px_rgba(15,23,42,0.06)] mb-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/brisbane-kerbside-hero.webp"
                alt="Four sorted home recycling bags on a Brisbane kerbside path"
                className="h-44 w-full object-cover"
              />
              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[17px] font-display font-bold text-slate-900">
                    {building ? `${place} building pool` : `${place} kerbside run`}
                  </p>
                  <span className="text-[12px] font-bold text-emerald-700 tabular-nums">
                    {pct}%
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-2.5 mb-2">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${Math.max(pct, containers > 0 ? 3 : 0)}%` }}
                  />
                </div>
                <p className="text-[13px] text-slate-500">
                  {building
                    ? live
                      ? "Street volume has hit a driver trip. You do not count toward suburb volume."
                      : `${containers} containers scanned near ${place}. Invite a house on the street to unlock a run.`
                    : live
                      ? `${containers} containers — enough for a driver trip`
                      : `${containers.toLocaleString()}/${LIVE_VOLUME_THRESHOLD.toLocaleString()} containers${needed > 0 ? ` · ${needed.toLocaleString()} more to unlock a run` : ""}`}
                </p>
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[12px] font-medium text-slate-500">
                    Balance · <strong className="text-slate-900">{formatCents(summary.totalCreditCents)}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={handleScanClick}
                    className="text-[13px] font-bold text-emerald-700 hover:text-emerald-900"
                  >
                    Scan a can →
                  </button>
                </div>
              </div>
            </div>

            <CollectionNightCard
              nextPickup={nextPickup}
              confirmed={pickupConfirmed}
              unlocked={live || household?.binStatus === "allocated"}
              dayName={dayName}
            />
          </div>
        )}

        {/* ══════════════════ TAB 2: PICKUPS (Mirrors Trips) ══════════════════ */}
        {activeTab === "pickups" && (
          <div className="px-5" style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}>
            <div className="flex items-center justify-end mb-1">
              <button
                type="button"
                onClick={handleScanClick}
                aria-label="Scan a container"
                className="h-10 w-10 rounded-full bg-white shadow-[0_2px_10px_rgba(15,23,42,0.07)] flex items-center justify-center text-slate-800 active:scale-95 transition-transform"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>

            <h1 className="text-[32px] font-display font-bold tracking-tight text-slate-900 mb-4">
              Pickups
            </h1>

            {/* Segmented Filter Pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 mb-5">
              {(
                [
                  { id: "upcoming", label: "Upcoming", icon: <Truck className="w-3.5 h-3.5" /> },
                  { id: "building", label: "Building", icon: <Building2 className="w-3.5 h-3.5" /> },
                  { id: "bags", label: "My Bags", icon: <Package className="w-3.5 h-3.5" /> },
                  { id: "suburb", label: "Suburb", icon: <Users className="w-3.5 h-3.5" /> },
                ] as const
              ).map((pill) => {
                const selected = pickupsFilter === pill.id;
                return (
                  <button
                    key={pill.id}
                    type="button"
                    onClick={() => setPickupsFilter(pill.id)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold transition-all ${
                      selected
                        ? "bg-slate-900 text-white shadow-sm"
                        : "bg-white text-slate-800 shadow-[0_1px_6px_rgba(15,23,42,0.05)]"
                    }`}
                  >
                    {pill.icon}
                    {pill.label}
                  </button>
                );
              })}
            </div>

            {pickupsFilter === "building" && (
              <BuildingSyndicatePanel
                data={syndicateData}
                loading={syndicateLoading}
                onUpdate={setSyndicateData}
                onRefresh={refreshSyndicate}
              />
            )}

            {pickupsFilter === "upcoming" && (
              <>
                {pickupConfirmed ? (
                  <div className="mb-6">
                    <CollectionNightCard
                      nextPickup={nextPickup}
                      confirmed={pickupConfirmed}
                      unlocked={live || household?.binStatus === "allocated"}
                      dayName={dayName}
                    />
                  </div>
                ) : (
                  <div className="py-4 text-center mb-6">
                    {/* Crisp floating tilted pickup pass card */}
                    <div className="relative mx-auto w-64 h-36 mb-6">
                      <div className="absolute inset-0 rotate-3 rounded-2xl bg-white/70 border border-white shadow-sm" />
                      <div className="relative h-full w-full -rotate-1 rounded-2xl bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.08)] flex items-center justify-between gap-3">
                        <div className="text-left space-y-2 flex-1">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src="/images/tgs-glass-icon.webp"
                            alt=""
                            aria-hidden="true"
                            width={24}
                            height={24}
                            className="h-6 w-6"
                          />
                          <div className="h-2 w-24 rounded-full bg-slate-200" />
                          <div className="h-2 w-20 rounded-full bg-slate-100" />
                          <div className="h-2 w-16 rounded-full bg-emerald-100" />
                        </div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src="/images/brisbane-kerbside-hero.webp"
                          alt=""
                          aria-hidden="true"
                          className="h-20 w-20 rounded-xl object-cover shrink-0"
                        />
                      </div>
                    </div>

                    <h2 className="text-[20px] font-display font-bold text-slate-900 mb-1.5">
                      No scheduled pickups yet
                    </h2>
                    <p className="text-[13px] text-slate-500 max-w-[290px] mx-auto leading-relaxed mb-5">
                      {place} is at {containers.toLocaleString()}/{LIVE_VOLUME_THRESHOLD.toLocaleString()} containers — {needed.toLocaleString()} more to unlock a run. Scan containers at home and sort into four bags.
                    </p>
                    <button
                      type="button"
                      onClick={handleScanClick}
                      className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 text-[15px] shadow-sm active:scale-[0.99] transition-all"
                    >
                      Scan a container
                    </button>
                  </div>
                )}

                {/* Grouped White Action List (exact Trips bottom menu) */}
                <div className="rounded-2xl bg-white shadow-[0_2px_12px_rgba(15,23,42,0.05)] divide-y divide-slate-100 overflow-hidden">
                  <ListLinkRow
                    href="/bags"
                    icon={<Package className="w-5 h-5 text-slate-700" strokeWidth={1.75} />}
                    label="Tag my 4 home bags"
                  />
                  <ListLinkRow
                    href="/marketplace"
                    icon={<MapPin className="w-5 h-5 text-slate-700" strokeWidth={1.75} />}
                    label="View Brisbane suburb progress"
                  />
                  <ListLinkRow
                    href="/flyer"
                    icon={<Printer className="w-5 h-5 text-slate-700" strokeWidth={1.75} />}
                    label="Print street sorting flyer"
                  />
                  <ListLinkRow
                    href="/onboard"
                    icon={<Home className="w-5 h-5 text-slate-700" strokeWidth={1.75} />}
                    label="Manage home address & payouts"
                  />
                </div>
              </>
            )}

            {pickupsFilter === "bags" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {STREAMS.map((s) => (
                    <div
                      key={s.key}
                      className="rounded-2xl bg-white p-4 shadow-[0_2px_10px_rgba(15,23,42,0.05)]"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${s.soft}`}>
                          <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                          {s.short}
                        </span>
                        <span className="text-[22px] font-display font-bold text-slate-900 tabular-nums">
                          {summary.streams[s.key]}
                        </span>
                      </div>
                      <p className="text-[14px] font-bold text-slate-900">{s.label}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{s.hint}</p>
                    </div>
                  ))}
                </div>
                <Link
                  href="/bags"
                  className="block w-full rounded-xl bg-slate-900 text-white text-center font-bold py-3.5 text-[14px]"
                >
                  Open QR bag tagger →
                </Link>
              </div>
            )}

            {pickupsFilter === "suburb" && (
              <div className="space-y-4">
                <WaitlistCard
                  suburb={suburb ?? null}
                  households={have}
                  containers={containers}
                  needed={needed}
                  live={live}
                  binStatus={household?.binStatus}
                  dayName={dayName}
                  day={household?.councilCollectionDay}
                  building={building}
                  hideInvite
                />
                {canInviteSuburb && (
                  <div className="rounded-2xl bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
                    <p className="text-[15px] font-display font-bold text-slate-900 mb-1">
                      Grow your neighbour network · earn 1¢/can
                    </p>
                    <p className="text-[12px] text-slate-500 mb-3">
                      Earn $1 when a neighbour joins plus a 1¢ bonus on every container they sort.
                    </p>
                    <InviteActions url={inviteUrl} message={message} compact />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ TAB 4: POINTS (Mirrors Points) ══════════════════ */}
        {activeTab === "points" && (
          <div className="px-5" style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}>
            {/* Centered Points Header */}
            <div className="text-center mb-5">
              <h1 className="text-[17px] font-display font-bold text-slate-900">Points</h1>
              <p className="text-[13px] font-medium text-slate-500 tabular-nums mt-0.5">
                {summary.goodSortPoints.toLocaleString()} PTS · {formatCents(summary.totalCreditCents)}
              </p>
            </div>

            {/* Segmented Pills: Earn Points / Rewards */}
            <div className="flex items-center gap-2 mb-5">
              <button
                type="button"
                onClick={() => setPointsFilter("earn")}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold transition-all ${
                  pointsFilter === "earn"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-white text-slate-800 shadow-[0_1px_6px_rgba(15,23,42,0.05)]"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Earn Points
              </button>
              <button
                type="button"
                onClick={() => setPointsFilter("rewards")}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold transition-all ${
                  pointsFilter === "rewards"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-white text-slate-800 shadow-[0_1px_6px_rgba(15,23,42,0.05)]"
                }`}
              >
                <Gift className="w-3.5 h-3.5" />
                Use Points
              </button>
            </div>

            {/* Rounded Pill Scan Launcher (mirrors Qantas Search products pill) */}
            <button
              type="button"
              onClick={handleScanClick}
              className="w-full rounded-full bg-white pl-5 pr-2 py-2 shadow-[0_2px_12px_rgba(15,23,42,0.06)] flex items-center justify-between gap-3 mb-6 active:scale-[0.99] transition-transform"
            >
              <div className="text-left min-w-0">
                <p className="text-[14px] font-semibold text-slate-900 truncate">Scan a container</p>
                <p className="text-[11px] text-slate-500 truncate">Earn 10¢ + 10 Good Sort Points per scan</p>
              </div>
              <span className="h-11 w-11 shrink-0 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-sm">
                <ScanBarcode className="w-5 h-5" />
              </span>
            </button>

            {pointsFilter === "earn" ? (
              <div className="space-y-6">
                {/* Milestones */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h2 className="text-[17px] font-display font-bold text-slate-900">Milestones</h2>
                      <p className="text-[12px] text-slate-500">
                        {summary.milestones.filter((m) => m.earned).length} of {summary.milestones.length} unlocked
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {summary.milestones.map((m) => (
                      <div
                        key={m.id}
                        className={`rounded-2xl p-3.5 shadow-[0_2px_10px_rgba(15,23,42,0.05)] ${
                          m.earned ? "bg-white" : "bg-white/70"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <Award
                            className={`w-5 h-5 ${m.earned ? "text-amber-500" : "text-slate-300"}`}
                          />
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              m.earned
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-400"
                            }`}
                          >
                            {m.earned ? "Earned" : m.targetText}
                          </span>
                        </div>
                        <p className={`text-[14px] font-bold ${m.earned ? "text-slate-900" : "text-slate-500"}`}>
                          {m.label}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Neighbour Network Offer Card */}
                <div className="rounded-2xl bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
                  <p className="text-[15px] font-display font-bold text-slate-900 mb-1">
                    Earn 1¢/can from your neighbour network
                  </p>
                  <p className="text-[12px] text-slate-500 leading-relaxed mb-3">
                    Get $1 when a neighbour joins {place} plus 1¢ and 1 bonus point on every container they sort.
                  </p>
                  {network && network.sortersCount > 0 && (
                    <p className="text-[12px] font-semibold text-emerald-700 mb-3">
                      Active network: {network.sortersCount} sorter{network.sortersCount === 1 ? "" : "s"} · {network.referredContainers} cans · +{formatCredit(network.totalNetworkCents)}
                    </p>
                  )}
                  <Link
                    href="/invite"
                    className="inline-flex items-center gap-1 text-[13px] font-bold text-emerald-700 hover:text-emerald-900"
                  >
                    Share invite link <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <MemberStatusCard
                  suburbLabel={suburb ? titleSuburb(suburb) : null}
                  onOpenPayouts={() => onOpenAccount?.()}
                />
                <div className="rounded-2xl bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
                  <p className="text-[14px] font-bold text-slate-900 mb-1">How points &amp; credits clear</p>
                  <p className="text-[12px] text-slate-500 leading-relaxed">
                    Every eligible 150mL–3L container earns 10¢ sorting credit + 10 Good Sort Points. Credits clear after kerbside pickup and depot verification, ready to cash out via PayID or bank transfer.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ TAB 5: PROFILE (Mirrors My QFF) ══════════════════ */}
        {activeTab === "profile" && (
          <div>
            {/* Brushed Metallic Tier Header Band */}
            <div
              className={`bg-gradient-to-b ${summary.tier.headerGradient} px-5 pb-14`}
              style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}
            >
              <div className="flex items-center justify-end gap-2.5 mb-3">
                <Link
                  href="/invite"
                  aria-label="Invite neighbours"
                  className="h-10 w-10 rounded-full bg-white/90 shadow-sm flex items-center justify-center text-slate-800 active:scale-95 transition-transform"
                >
                  <Share2 className="w-4 h-4" />
                </Link>
                <button
                  type="button"
                  onClick={() => onOpenAccount?.()}
                  aria-label="Account settings and payouts"
                  className="h-10 w-10 rounded-full bg-white/90 shadow-sm flex items-center justify-center text-slate-800 active:scale-95 transition-transform"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>
              <h1 className="text-[32px] leading-tight font-display font-bold tracking-tight text-slate-900">
                {firstName === "there" ? "Member" : firstName}
              </h1>
            </div>

            <div className="px-5 -mt-10 space-y-3.5">
              {/* Overlapping White Tier Identity Card */}
              <div className="rounded-2xl bg-white px-4 py-3.5 shadow-[0_4px_18px_rgba(15,23,42,0.06)] flex items-center justify-between gap-3">
                <div>
                  <p className="text-[20px] leading-tight font-display font-bold text-slate-900">
                    {summary.tier.label}
                  </p>
                  <button
                    type="button"
                    onClick={copyMemberCode}
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-800 mt-0.5"
                  >
                    <span className="tabular-nums">{memberCode}</span>
                    {copiedMemberId ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </button>
                </div>
                <div
                  className={`h-12 w-12 shrink-0 rounded-full bg-gradient-to-br ${summary.tier.medallionGradient} flex items-center justify-center shadow-inner`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/images/tgs-glass-icon.webp"
                    alt=""
                    aria-hidden="true"
                    width={28}
                    height={28}
                    className="h-7 w-7 drop-shadow-[0_2px_4px_rgba(0,0,0,0.25)]"
                  />
                </div>
              </div>

              {/* Points, Status & Recent Activity Statement Card */}
              <div className="rounded-2xl bg-white p-5 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
                <div className="grid grid-cols-2 gap-4 pb-4 border-b border-slate-100">
                  <div>
                    <p className="text-[12px] font-medium text-slate-500">Points</p>
                    <p className="text-[26px] leading-tight font-display font-bold text-slate-900 tabular-nums mt-0.5">
                      {summary.goodSortPoints.toLocaleString()}
                    </p>
                    <p className="text-[11px] font-medium text-emerald-700 mt-0.5">
                      {formatCents(summary.totalCreditCents)} credit
                    </p>
                  </div>
                  <div className="border-l border-slate-100 pl-4">
                    <p className="text-[12px] font-medium text-slate-500">Status</p>
                    <p className="text-[26px] leading-tight font-display font-bold text-slate-900 tabular-nums mt-0.5">
                      {summary.totalContainers.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {summary.tier.nextTierLabel
                        ? `${summary.containersToNextTier.toLocaleString()} to ${summary.tier.nextTierLabel}`
                        : "Top tier unlocked"}
                    </p>
                  </div>
                </div>

                {/* Subtle tier progress bar */}
                <div className="pt-3 pb-4">
                  <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.max(summary.progressPct, summary.totalContainers > 0 ? 4 : 0)}%`,
                        backgroundColor: summary.tier.accentHex,
                      }}
                    />
                  </div>
                </div>

                {/* Recent Activity (exact clean Qantas statement typography) */}
                <p className="text-[13px] font-bold text-slate-900 mb-3">Recent activity</p>
                {recentScans.length > 0 ? (
                  <div className="space-y-3 mb-4">
                    {recentScans.slice(0, 4).map((scan) => {
                      const streamKey = bucketScanMaterial(scan.material);
                      return (
                        <div key={scan.id} className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${STREAM_DOT_BY_KEY[streamKey]}`} />
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-slate-800 uppercase tracking-tight truncate">
                                {scan.containerName || "ELIGIBLE CONTAINER"}
                              </p>
                              <p className="text-[11px] text-slate-400">
                                {new Date(scan.timestamp).toLocaleString("en-AU", {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </p>
                            </div>
                          </div>
                          <div className="text-right shrink-0 tabular-nums">
                            <p className="text-[13px] font-semibold text-emerald-700">
                              + 10 PTS
                            </p>
                            <p className="text-[11px] font-medium text-slate-500">
                              + {scan.refundCents || 10}¢
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[13px] text-slate-400 mb-4">
                    No scans yet — scan your first container to earn 10¢ + 10 PTS.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => onOpenAccount?.()}
                  className="w-full pt-3.5 border-t border-slate-100 flex items-center justify-between text-[14px] font-semibold text-slate-900"
                >
                  <span>View payouts &amp; activity statement</span>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </button>
              </div>

              {/* 4-Column Quick Action Squares (mirrors My QFF 4-icon strip) */}
              <div className="grid grid-cols-4 gap-2.5">
                <ActionTile
                  label="Earn Points"
                  icon={<ScanBarcode className="w-5 h-5 text-emerald-600" strokeWidth={1.75} />}
                  onClick={handleScanClick}
                />
                <ActionTile
                  label="Rewards"
                  icon={<Sparkles className="w-5 h-5 text-slate-800" strokeWidth={1.75} />}
                  onClick={() => { setPointsFilter("rewards"); setActiveTab("points"); }}
                />
                <ActionTile
                  label={`${summary.currentStreakDays}d Streak`}
                  icon={<Flame className="w-5 h-5 text-amber-500" strokeWidth={1.75} />}
                  onClick={() => setActiveTab("points")}
                />
                <ActionTile
                  label={`${summary.co2SavedKg.toFixed(1)}kg CO₂`}
                  icon={<Leaf className="w-5 h-5 text-emerald-600" strokeWidth={1.75} />}
                  onClick={() => onOpenAccount?.()}
                />
              </div>

              {/* Bonus Reward Card (mirrors "Your Loyalty Bonus Reward is waiting") */}
              <div className="rounded-2xl bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 shrink-0 rounded-xl bg-emerald-50 flex items-center justify-center">
                    <Gift className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-display font-bold text-slate-900 leading-snug">
                      Neighbour Network bonus
                    </p>
                    <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
                      Earn $1 when a neighbour joins {place} plus 1¢ on every container they sort.
                    </p>
                    {!showInviteSheet ? (
                      <button
                        type="button"
                        onClick={() => setShowInviteSheet(true)}
                        className="mt-2.5 text-[13px] font-bold text-emerald-700 hover:text-emerald-900"
                      >
                        Share invite link
                      </button>
                    ) : (
                      <div className="mt-3">
                        <InviteActions url={inviteUrl} message={message} compact />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════ FLOATING iOS 26 LIQUID GLASS BOTTOM TAB BAR ══════════════════ */}
      <nav
        aria-label="Main app navigation"
        className="fixed inset-x-0 z-30 flex justify-center px-4 pointer-events-none"
        style={{ bottom: "max(14px, env(safe-area-inset-bottom, 14px))" }}
      >
        <div className="pointer-events-auto w-full max-w-[390px] rounded-full bg-white/90 backdrop-blur-2xl border border-white/95 shadow-[0_12px_36px_rgba(15,23,42,0.14),0_2px_8px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,1)] p-1.5 grid grid-cols-5 items-center gap-0.5">
          <TabPill
            label="Home"
            active={activeTab === "home"}
            icon={<Home className="w-[21px] h-[21px]" strokeWidth={activeTab === "home" ? 2.25 : 1.75} />}
            onClick={() => setActiveTab("home")}
          />
          <TabPill
            label="Pickups"
            active={activeTab === "pickups"}
            icon={<Truck className="w-[21px] h-[21px]" strokeWidth={activeTab === "pickups" ? 2.25 : 1.75} />}
            onClick={() => setActiveTab("pickups")}
          />
          <TabPill
            label="Scan"
            active={false}
            icon={<ScanBarcode className="w-[21px] h-[21px]" strokeWidth={1.9} />}
            onClick={handleScanClick}
          />
          <TabPill
            label="Points"
            active={activeTab === "points"}
            icon={<Sparkles className="w-[21px] h-[21px]" strokeWidth={activeTab === "points" ? 2.25 : 1.75} />}
            onClick={() => setActiveTab("points")}
          />
          <TabPill
            label="Profile"
            active={activeTab === "profile"}
            icon={<UserIcon className="w-[21px] h-[21px]" strokeWidth={activeTab === "profile" ? 2.25 : 1.75} />}
            onClick={() => setActiveTab("profile")}
          />
        </div>
      </nav>
    </div>
  );
}

function TabPill({
  label,
  active,
  icon,
  onClick,
}: {
  label: string;
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex flex-col items-center justify-center rounded-full py-2 px-1 transition-all duration-150 ${
        active
          ? "bg-[#e8eaed]/90 text-emerald-600 shadow-[inset_0_1px_1px_rgba(255,255,255,0.65)]"
          : "text-slate-900 hover:bg-slate-900/[0.04]"
      }`}
    >
      {icon}
      <span className={`text-[10px] mt-1 leading-none tracking-[-0.01em] ${active ? "font-bold" : "font-medium"}`}>
        {label}
      </span>
    </button>
  );
}

function ActionTile({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center group">
      <div className="w-full aspect-square rounded-2xl bg-white shadow-[0_2px_10px_rgba(15,23,42,0.045)] flex items-center justify-center group-active:scale-[0.95] transition-transform">
        {icon}
      </div>
      <span className="text-[11px] font-medium text-slate-700 text-center mt-1.5 leading-tight">
        {label}
      </span>
    </button>
  );
}

function ActionTileLink({
  label,
  href,
  icon,
}: {
  label: string;
  href: string;
  icon: React.ReactNode;
}) {
  return (
    <Link href={href} className="flex flex-col items-center group">
      <div className="w-full aspect-square rounded-2xl bg-white shadow-[0_2px_10px_rgba(15,23,42,0.045)] flex items-center justify-center group-active:scale-[0.95] transition-transform">
        {icon}
      </div>
      <span className="text-[11px] font-medium text-slate-700 text-center mt-1.5 leading-tight">
        {label}
      </span>
    </Link>
  );
}

function ListLinkRow({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-slate-50 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        {icon}
        <span className="text-[14px] font-medium text-slate-900 truncate">{label}</span>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
    </Link>
  );
}
