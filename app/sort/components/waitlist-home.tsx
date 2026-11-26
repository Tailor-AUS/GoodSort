"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Award,
  Building2,
  Check,
  CheckCircle2,
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
  X,
} from "lucide-react";
import {
  LIVE_VOLUME_THRESHOLD,
  inviteMessage,
  residentialNeedsStreet,
  streetInviteUrl,
  titleSuburb,
  canonicalSuburb,
} from "@/lib/brisbane";
import { apiUrl, authHeaders, isStoredAdmin, readStoredProfileId } from "@/lib/config";
import { formatCents, type User } from "@/lib/store";
import { buildSorterLoyaltySummary, bucketScanMaterial } from "@/lib/sorter-loyalty";
import { WaitlistCard } from "@/app/components/shared/waitlist-card";
import { CollectionNightCard } from "@/app/components/shared/collection-night-card";
import { InviteActions } from "@/app/components/shared/invite-actions";
import { GlassBackdrop } from "@/app/components/shared/glass-backdrop";
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

const FIRST_BAG_TARGET = 50;

const TAB_DOCK_INDEX: Record<AppTab, number> = {
  home: 0,
  pickups: 1,
  points: 3,
  profile: 4,
};

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
  const [showHelpSheet, setShowHelpSheet] = useState(false);
  const [showPassSheet, setShowPassSheet] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

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
  const [network, setNetwork] = useState<{ sortersCount: number; referredContainers: number; totalNetworkPoints?: number } | null>(null);
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
    setIsAdmin(isStoredAdmin());
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

  function switchTab(next: AppTab) {
    setActiveTab(next);
    if (typeof window !== "undefined") {
      window.scrollTo(0, 0);
    }
  }

  function handleScanClick() {
    if (onScanPress) onScanPress();
    else window.location.href = "/scan";
  }

  const firstBagCount = Math.min(FIRST_BAG_TARGET, summary.totalContainers);
  const firstBagPct = Math.min(100, Math.round((firstBagCount / FIRST_BAG_TARGET) * 100));
  const fullBagReady = summary.totalContainers >= FIRST_BAG_TARGET;
  const dockCol = TAB_DOCK_INDEX[activeTab];

  return (
    <div className="relative min-h-dvh text-white pb-28 overflow-x-clip">
      <GlassBackdrop />

      <div className="relative z-10 mx-auto w-full max-w-[430px]">
        {/* ══════════════════ TAB 1: HOME ══════════════════ */}
        {activeTab === "home" && (
          <div key="tab-home" className="px-5 animate-tab-in" style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}>
            {/* Top Bar: Liquid Glass Quick Guide pill (left) + Member Pass pill (right) */}
            <div className="flex items-center justify-between mb-5">
              <button
                type="button"
                onClick={() => setShowHelpSheet(true)}
                className="inline-flex items-center gap-1.5 min-h-[40px] rounded-full liquid-glass-pill px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-white/25 active:scale-[0.97] transition-all"
              >
                <HelpCircle className="w-4 h-4 text-white/90" />
                Guide
              </button>
              <button
                type="button"
                onClick={() => setShowPassSheet(true)}
                className="inline-flex items-center gap-1.5 min-h-[40px] rounded-full liquid-glass-pill px-3.5 py-2 text-[13px] font-bold text-white hover:bg-white/25 active:scale-[0.97] transition-all"
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
            <h1 className="text-[28px] leading-tight font-display font-bold tracking-tight text-white glass-text-shadow mb-4">
              Hi {firstName}
            </h1>

            {/* Refractive Liquid Glass Balance + Dual Momentum Rings Card */}
            <div
              className={`w-full text-left rounded-[26px] ${
                summary.totalContainers > 0 ? "liquid-glass-emerald" : "liquid-glass"
              } p-5 mb-4`}
            >
              <button
                type="button"
                onClick={() => switchTab("profile")}
                className="w-full text-left flex items-start justify-between gap-3 active:opacity-90 transition-opacity"
              >
                <div className="flex items-center gap-5 min-w-0">
                  <div>
                    <p className="text-[12px] font-medium text-white/85">
                      {user.clearedCents > 0 ? "Balance" : "Pending credit"}
                    </p>
                    <p className="text-[32px] leading-tight font-display font-extrabold text-white tabular-nums mt-0.5 tracking-[-0.03em] glass-text-shadow">
                      {formatCents(summary.totalCreditCents)}
                    </p>
                  </div>
                  <div className="h-10 w-px bg-white/25" />
                  <div>
                    <p className="text-[12px] font-medium text-white/85">Containers</p>
                    <p className="text-[26px] leading-tight font-display font-bold text-white tabular-nums tracking-[-0.02em] mt-0.5">
                      {summary.totalContainers.toLocaleString()}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-400/25 border border-emerald-200/45 px-2.5 py-1 text-[11px] font-bold text-emerald-100">
                  {live ? "Ready" : summary.tier.label}
                </span>
              </button>

              {/* Dual Progress: Personal First Bag (moves every scan) + Suburb Unlock */}
              <div className="mt-4 pt-3.5 border-t border-white/15 space-y-3">
                <div>
                  <div className="flex items-center justify-between text-[11px] font-semibold text-white/90 mb-1.5">
                    <span>{fullBagReady ? "Kitchen bag ready to tag" : "First kitchen bag ($4.00)"}</span>
                    <span className="tabular-nums text-emerald-200 shrink-0 ml-2">
                      {fullBagReady ? `${summary.totalContainers.toLocaleString()} scanned` : `${firstBagCount} / ${FIRST_BAG_TARGET} cans`}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-black/25 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-teal-200 transition-all duration-300"
                      style={{ width: `${Math.max(firstBagPct, summary.totalContainers > 0 ? 5 : 2)}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-white/85 mb-1.5">
                    <span className="truncate">
                      {building ? `${place} street pool` : `${place} run`}
                      {!live && !building && needed > 0 ? ` · ${needed.toLocaleString()} more to unlock a run` : ""}
                    </span>
                    <Link
                      href="/marketplace#suburb-map"
                      className="tabular-nums text-emerald-200 hover:text-white shrink-0 inline-flex items-center gap-0.5"
                    >
                      {containers.toLocaleString()}/{LIVE_VOLUME_THRESHOLD.toLocaleString()}
                      <ChevronRight className="w-3 h-3" />
                    </Link>
                  </div>
                  <div className="h-1.5 rounded-full bg-black/25 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-300 transition-all duration-300"
                      style={{ width: `${Math.max(pct, containers > 0 ? 4 : 2)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Primary Apple-style Bright Liquid Glass Scan Action Capsule */}
            <button
              type="button"
              onClick={handleScanClick}
              className="w-full min-h-[60px] rounded-full liquid-glass-bright pl-5 pr-2 py-2 flex items-center justify-between gap-3 text-left mb-5 active:scale-[0.98] transition-transform"
            >
              <div className="min-w-0">
                <p className="text-[15px] font-display font-extrabold text-slate-950 leading-tight truncate">
                  Scan a container · +8¢
                </p>
                <p className="text-[12px] font-medium text-slate-700 leading-tight mt-0.5 truncate">
                  Photo AI or rapid barcode · sort at home
                </p>
              </div>
              <span className="h-11 w-11 shrink-0 rounded-full bg-gradient-to-b from-emerald-500 to-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-900/25">
                <ScanBarcode className="w-5 h-5" />
              </span>
            </button>

            {/* Setup prompt if address or PayID still missing */}
            {residentialNeedsStreet(household) ? (
              <Link
                href="/onboard"
                className="mb-5 flex items-center justify-between gap-3 rounded-2xl liquid-glass px-4 py-3.5 hover:bg-white/20 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-white">Add home address &amp; payout</p>
                  <p className="text-[11px] text-white/80">So we can collect &amp; pay your 8¢ credits</p>
                </div>
                <ChevronRight className="w-4 h-4 text-white/80 shrink-0" />
              </Link>
            ) : hasPayoutDetails === false ? (
              <Link
                href="/onboard"
                className="mb-5 flex items-center justify-between gap-3 rounded-2xl liquid-glass px-4 py-3.5 hover:bg-white/20 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-white">Add PayID or bank details</p>
                  <p className="text-[11px] text-white/80">Ready for cashout once verified at depot</p>
                </div>
                <ChevronRight className="w-4 h-4 text-white/80 shrink-0" />
              </Link>
            ) : null}

            {/* Section: Sort and explore (clean 2x2 Apple Liquid Glass tile grid, zero jargon) */}
            <h2 className="text-[15px] font-display font-bold text-white/95 glass-text-shadow mb-3 tracking-[-0.015em]">
              Sort and explore
            </h2>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <GlassTileLink
                label="Home Bags"
                caption="Cans, plastic & glass"
                href="/bags"
                icon={<Package className="w-6 h-6 text-white" strokeWidth={1.75} />}
              />
              <GlassTileLink
                label="Suburb Map"
                caption="Live Brisbane pools"
                href="/marketplace#suburb-map"
                icon={<MapPin className="w-6 h-6 text-emerald-300" strokeWidth={1.75} />}
              />
              <GlassTileLink
                label="Invite Street"
                caption="+100 pts per neighbour"
                href="/invite"
                icon={<Users className="w-6 h-6 text-amber-200" strokeWidth={1.75} />}
              />
              <GlassTileLink
                label="Household"
                caption="Address & kerb status"
                href="/household"
                icon={<Home className="w-6 h-6 text-white" strokeWidth={1.75} />}
              />
            </div>

            {/* Anonymous Building Syndicate Notification / Quick Entry Card */}
            {syndicateData?.eligible && syndicateData.syndicate && syndicateData.myMembership && (
              <button
                type="button"
                onClick={() => {
                  setPickupsFilter("building");
                  switchTab("pickups");
                }}
                className="w-full text-left mb-5 rounded-2xl liquid-glass-emerald p-4 flex items-center justify-between gap-3 active:scale-[0.99] transition-transform"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-xl bg-white/15 border border-white/25 text-emerald-200 flex items-center justify-center shrink-0">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-[14px] font-display font-bold text-white truncate">
                        {syndicateData.myMembership.status === "approved"
                          ? syndicateData.syndicate.channelName
                          : syndicateData.myMembership.status === "pending"
                            ? `Pending · ${syndicateData.syndicate.displayName}`
                            : "Building syndicate detected"}
                      </p>
                      {syndicateData.syndicate.status === "official" && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-400/25 border border-emerald-200/40 px-2 py-0.5 text-[10px] font-bold text-emerald-100">
                          <ShieldCheck className="w-3 h-3" /> Official
                        </span>
                      )}
                      {syndicateData.myMembership.canApprovePending && syndicateData.syndicate.pendingRequestsCount > 0 && (
                        <span className="rounded-full bg-amber-400/90 px-2 py-0.5 text-[10px] font-bold text-slate-950">
                          {syndicateData.syndicate.pendingRequestsCount} to approve
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-white/80 mt-0.5 truncate">
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
                <ChevronRight className="w-4 h-4 text-white/75 shrink-0" />
              </button>
            )}

            <div className="text-slate-900">
              <CollectionNightCard
                nextPickup={nextPickup}
                confirmed={pickupConfirmed}
                unlocked={live || household?.binStatus === "allocated"}
                dayName={dayName}
              />
            </div>
          </div>
        )}

        {/* ══════════════════ TAB 2: PICKUPS ══════════════════ */}
        {activeTab === "pickups" && (
          <div key="tab-pickups" className="px-5 animate-tab-in" style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}>
            <div className="flex items-center justify-end mb-1">
              <button
                type="button"
                onClick={handleScanClick}
                aria-label="Scan a container"
                className="h-10 w-10 rounded-full liquid-glass-pill flex items-center justify-center text-white active:scale-95 transition-transform"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>

            <h1 className="text-[32px] font-display font-bold tracking-tight text-white glass-text-shadow mb-4">
              Pickups
            </h1>

            {/* Segmented Filter Pills (4-column Liquid Glass track — fits 360px+ with zero horizontal overflow) */}
            <div className="grid grid-cols-4 gap-1 rounded-2xl liquid-glass p-1 mb-5">
              {(
                [
                  { id: "upcoming", label: "Upcoming", icon: <Truck className="w-3.5 h-3.5 shrink-0" /> },
                  { id: "building", label: "Building", icon: <Building2 className="w-3.5 h-3.5 shrink-0" /> },
                  { id: "bags", label: "My Bags", icon: <Package className="w-3.5 h-3.5 shrink-0" /> },
                  { id: "suburb", label: "Suburb", icon: <Users className="w-3.5 h-3.5 shrink-0" /> },
                ] as const
              ).map((pill) => {
                const selected = pickupsFilter === pill.id;
                return (
                  <button
                    key={pill.id}
                    type="button"
                    onClick={() => setPickupsFilter(pill.id)}
                    className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-semibold transition-all ${
                      selected
                        ? "bg-white/95 text-slate-950 shadow-sm"
                        : "text-white/85 hover:bg-white/10"
                    }`}
                  >
                    {pill.icon}
                    <span className="leading-none truncate max-w-full">{pill.label}</span>
                  </button>
                );
              })}
            </div>

            {pickupsFilter === "building" && (
              <div className="text-slate-900">
                <BuildingSyndicatePanel
                  data={syndicateData}
                  loading={syndicateLoading}
                  onUpdate={setSyndicateData}
                  onRefresh={refreshSyndicate}
                />
              </div>
            )}

            {pickupsFilter === "upcoming" && (
              <>
                {pickupConfirmed ? (
                  <div className="mb-6 text-slate-900">
                    <CollectionNightCard
                      nextPickup={nextPickup}
                      confirmed={pickupConfirmed}
                      unlocked={live || household?.binStatus === "allocated"}
                      dayName={dayName}
                    />
                  </div>
                ) : (
                  <div className="rounded-[26px] liquid-glass p-5 text-center mb-5">
                    <div className="relative mx-auto w-60 h-32 mb-5">
                      <div className="absolute inset-0 rotate-3 rounded-2xl bg-white/15 border border-white/25" />
                      <div className="relative h-full w-full -rotate-1 rounded-2xl bg-white/95 p-3.5 shadow-xl flex items-center justify-between gap-3">
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
                          <div className="h-2 w-16 rounded-full bg-emerald-200" />
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

                    <h2 className="text-[20px] font-display font-bold text-white mb-1.5">
                      No scheduled pickups yet
                    </h2>
                    <p className="text-[13px] text-white/80 max-w-[290px] mx-auto leading-relaxed mb-5">
                      {place} is at {containers.toLocaleString()}/{LIVE_VOLUME_THRESHOLD.toLocaleString()} containers — {needed.toLocaleString()} more to unlock a run. Scan containers at home and sort into four bags.
                    </p>
                    <button
                      type="button"
                      onClick={handleScanClick}
                      className="w-full min-h-[48px] rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3.5 text-[15px] shadow-lg active:scale-[0.99] transition-all"
                    >
                      Scan a container
                    </button>
                  </div>
                )}

                {/* Grouped Liquid Glass Action List */}
                <div className="rounded-[24px] liquid-glass divide-y divide-white/15 overflow-hidden">
                  <ListLinkRow
                    href="/bags"
                    icon={<Package className="w-5 h-5 text-white/90" strokeWidth={1.75} />}
                    label="Tag my 4 home bags"
                  />
                  <ListLinkRow
                    href="/marketplace#suburb-map"
                    icon={<MapPin className="w-5 h-5 text-emerald-300" strokeWidth={1.75} />}
                    label="View Brisbane suburb progress"
                  />
                  <ListLinkRow
                    href="/flyer"
                    icon={<Printer className="w-5 h-5 text-white/90" strokeWidth={1.75} />}
                    label="Print street sorting flyer"
                  />
                  <ListLinkRow
                    href="/onboard"
                    icon={<Home className="w-5 h-5 text-white/90" strokeWidth={1.75} />}
                    label="Manage home address & payouts"
                  />
                </div>
              </>
            )}

            {pickupsFilter === "bags" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {STREAMS.map((s) => {
                    const glassTone =
                      s.key === "aluminium"
                        ? "liquid-glass-blue"
                        : s.key === "clearPet"
                          ? "liquid-glass-teal"
                          : s.key === "coloured"
                            ? "liquid-glass-amber"
                            : "liquid-glass-green";
                    return (
                      <div
                        key={s.key}
                        className={`rounded-2xl ${glassTone} p-4`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 border border-white/30 px-2.5 py-1 text-[11px] font-bold text-white">
                            <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                            {s.short}
                          </span>
                          <span className="text-[22px] font-display font-bold text-white tabular-nums">
                            {summary.streams[s.key]}
                          </span>
                        </div>
                        <p className="text-[14px] font-bold text-white">{s.label}</p>
                        <p className="text-[11px] text-white/80 mt-0.5">{s.hint}</p>
                      </div>
                    );
                  })}
                </div>
                <Link
                  href="/bags"
                  className="block w-full min-h-[48px] rounded-full bg-white/95 hover:bg-white text-slate-950 text-center font-bold py-3.5 text-[14px] shadow-lg"
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
                  <div className="rounded-2xl liquid-glass p-4">
                    <p className="text-[15px] font-display font-bold text-white mb-1">
                      Grow your neighbour network · earn bonus points
                    </p>
                    <p className="text-[12px] text-white/80 mb-3">
                      Earn 100 Good Sort Points when a neighbour joins plus 1 bonus point on every container they sort.
                    </p>
                    <InviteActions url={inviteUrl} message={message} compact />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ TAB 4: POINTS ══════════════════ */}
        {activeTab === "points" && (
          <div key="tab-points" className="px-5 animate-tab-in" style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}>
            {/* Centered Points Header */}
            <div className="text-center mb-5">
              <h1 className="text-[20px] font-display font-bold text-white glass-text-shadow">Points</h1>
              <p className="text-[13px] font-semibold text-emerald-200 tabular-nums mt-0.5">
                {summary.goodSortPoints.toLocaleString()} PTS · {formatCents(summary.totalCreditCents)}
              </p>
            </div>

            {/* Segmented Liquid Glass Pills: Earn Points / Use Points */}
            <div className="flex items-center gap-2 mb-5">
              <button
                type="button"
                onClick={() => setPointsFilter("earn")}
                className={`inline-flex items-center gap-1.5 min-h-[40px] rounded-full px-4 py-2 text-[13px] font-semibold transition-all ${
                  pointsFilter === "earn"
                    ? "bg-white/95 text-slate-950 shadow-md"
                    : "liquid-glass-pill text-white"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Earn Points
              </button>
              <button
                type="button"
                onClick={() => setPointsFilter("rewards")}
                className={`inline-flex items-center gap-1.5 min-h-[40px] rounded-full px-4 py-2 text-[13px] font-semibold transition-all ${
                  pointsFilter === "rewards"
                    ? "bg-white/95 text-slate-950 shadow-md"
                    : "liquid-glass-pill text-white"
                }`}
              >
                <Gift className="w-3.5 h-3.5" />
                Use Points
              </button>
            </div>

            {/* Rounded Liquid Glass Scan Launcher */}
            <button
              type="button"
              onClick={handleScanClick}
              className="w-full rounded-full liquid-glass pl-5 pr-2 py-2 flex items-center justify-between gap-3 mb-6 active:scale-[0.99] transition-transform"
            >
              <div className="text-left min-w-0">
                <p className="text-[14px] font-semibold text-white truncate">Scan a container</p>
                <p className="text-[11px] text-white/75 truncate">Earn 8¢ + 10 Good Sort Points per scan</p>
              </div>
              <span className="h-11 w-11 shrink-0 rounded-full bg-emerald-400 text-slate-950 flex items-center justify-center shadow-md">
                <ScanBarcode className="w-5 h-5" />
              </span>
            </button>

            {pointsFilter === "earn" ? (
              <div className="space-y-6">
                {/* Milestones */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h2 className="text-[17px] font-display font-bold text-white glass-text-shadow">Milestones</h2>
                      <p className="text-[12px] text-white/75">
                        {summary.milestones.filter((m) => m.earned).length} of {summary.milestones.length} unlocked
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {summary.milestones.map((m) => (
                      <div
                        key={m.id}
                        className={`rounded-2xl p-3.5 ${
                          m.earned ? "liquid-glass-emerald" : "liquid-glass-subtle"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <Award
                            className={`w-5 h-5 ${m.earned ? "text-amber-300" : "text-white/40"}`}
                          />
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              m.earned
                                ? "bg-emerald-400/25 text-emerald-100 border border-emerald-200/40"
                                : "bg-white/10 text-white/70"
                            }`}
                          >
                            {m.earned ? "Earned" : m.targetText}
                          </span>
                        </div>
                        <p className={`text-[14px] font-bold ${m.earned ? "text-white" : "text-white/75"}`}>
                          {m.label}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Neighbour Network Offer Card */}
                <div className="rounded-2xl liquid-glass p-4">
                  <p className="text-[15px] font-display font-bold text-white mb-1">
                    Earn Good Sort Points from your neighbour network
                  </p>
                  <p className="text-[12px] text-white/80 leading-relaxed mb-3">
                    Get 100 Good Sort Points when a neighbour joins {place} plus 1 bonus point on every container they sort.
                  </p>
                  {network && network.sortersCount > 0 && (
                    <p className="text-[12px] font-semibold text-emerald-300 mb-3">
                      Active network: {network.sortersCount} sorter{network.sortersCount === 1 ? "" : "s"} · {network.referredContainers} cans · +{(network.totalNetworkPoints ?? network.sortersCount * 100 + network.referredContainers).toLocaleString()} PTS
                    </p>
                  )}
                  <Link
                    href="/invite"
                    className="inline-flex items-center gap-1 min-h-[40px] py-2 -mb-2 text-[13px] font-bold text-emerald-300 hover:text-emerald-200"
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
                <div className="rounded-2xl liquid-glass p-4">
                  <p className="text-[14px] font-bold text-white mb-1">How points &amp; credits clear</p>
                  <p className="text-[12px] text-white/80 leading-relaxed">
                    Every eligible 150mL–3L container earns 8¢ sorting credit + 10 Good Sort Points. Credits clear after kerbside pickup and depot verification, ready to cash out via PayID or bank transfer.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ TAB 5: PROFILE ══════════════════ */}
        {activeTab === "profile" && (
          <div key="tab-profile" className="px-5 animate-tab-in" style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}>
            <div className="flex items-center justify-between gap-2.5 mb-4">
              <h1 className="text-[32px] leading-tight font-display font-bold tracking-tight text-white glass-text-shadow">
                {firstName === "there" ? "Member" : firstName}
              </h1>
              <div className="flex items-center gap-2">
                <Link
                  href="/invite"
                  aria-label="Invite neighbours"
                  className="h-10 w-10 rounded-full liquid-glass-pill flex items-center justify-center text-white active:scale-95 transition-transform"
                >
                  <Share2 className="w-4 h-4" />
                </Link>
                <button
                  type="button"
                  onClick={() => onOpenAccount?.()}
                  aria-label="Account settings and payouts"
                  className="h-10 w-10 rounded-full liquid-glass-pill flex items-center justify-center text-white active:scale-95 transition-transform"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-3.5">
              {/* Liquid Glass Tier Identity Card */}
              <div className="rounded-[24px] liquid-glass-emerald px-4 py-3.5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[20px] leading-tight font-display font-bold text-white">
                    {summary.tier.label}
                  </p>
                  <button
                    type="button"
                    onClick={copyMemberCode}
                    className="inline-flex items-center gap-1.5 min-h-[40px] py-1.5 -my-1 text-[13px] font-medium text-white/80 hover:text-white"
                  >
                    <span className="tabular-nums">{memberCode}</span>
                    {copiedMemberId ? (
                      <Check className="w-3.5 h-3.5 text-emerald-300" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-white/70" />
                    )}
                  </button>
                </div>
                <div
                  className={`h-12 w-12 shrink-0 rounded-full bg-gradient-to-br ${summary.tier.medallionGradient} flex items-center justify-center shadow-inner ring-1 ring-white/40`}
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

              {/* Admin-only quick shortcut (invisible to non-admin sorters) */}
              {isAdmin && (
                <div className="rounded-[24px] liquid-glass-dock text-white p-3.5 space-y-2.5">
                  <Link
                    href="/admin"
                    className="min-h-[44px] flex items-center justify-between gap-2.5 px-1"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="h-9 w-9 rounded-xl bg-emerald-400/20 border border-emerald-200/30 text-emerald-300 flex items-center justify-center shrink-0">
                        <ShieldCheck className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold leading-tight">Admin Command Centre</p>
                        <p className="text-[11px] text-white/70 leading-tight mt-0.5">Funnel, live activity &amp; ops</p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-white/60 shrink-0" />
                  </Link>
                  <div className="grid grid-cols-2 gap-2">
                    <Link
                      href="/admin/users"
                      className="min-h-[40px] px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-bold text-white inline-flex items-center justify-center gap-1"
                    >
                      Users CRM
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                    <Link
                      href="/admin/runners"
                      className="min-h-[40px] px-3 py-2 rounded-xl bg-emerald-400/25 hover:bg-emerald-400/35 text-xs font-bold text-emerald-100 inline-flex items-center justify-center gap-1"
                    >
                      Runners
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              )}

              {/* Points, Status & Recent Activity Statement Card */}
              <div className="rounded-[24px] liquid-glass p-5">
                <div className="grid grid-cols-2 gap-4 pb-4 border-b border-white/15">
                  <div>
                    <p className="text-[12px] font-medium text-white/75">Points</p>
                    <p className="text-[26px] leading-tight font-display font-bold text-white tabular-nums mt-0.5">
                      {summary.goodSortPoints.toLocaleString()}
                    </p>
                    <p className="text-[11px] font-medium text-emerald-300 mt-0.5">
                      {formatCents(summary.totalCreditCents)} credit
                    </p>
                  </div>
                  <div className="border-l border-white/15 pl-4">
                    <p className="text-[12px] font-medium text-white/75">Containers</p>
                    <p className="text-[26px] leading-tight font-display font-bold text-white tabular-nums mt-0.5">
                      {summary.totalContainers.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-white/75 mt-0.5">
                      {summary.tier.nextTierLabel
                        ? `${summary.containersToNextTier.toLocaleString()} to ${summary.tier.nextTierLabel}`
                        : "Top tier unlocked"}
                    </p>
                  </div>
                </div>

                {/* Subtle tier progress bar */}
                <div className="pt-3 pb-4">
                  <div className="h-1.5 w-full rounded-full bg-black/25 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-400 transition-all"
                      style={{
                        width: `${Math.max(summary.progressPct, summary.totalContainers > 0 ? 4 : 0)}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Recent Activity */}
                <p className="text-[13px] font-bold text-white mb-3">Recent activity</p>
                {recentScans.length > 0 ? (
                  <div className="space-y-3 mb-4">
                    {recentScans.slice(0, 4).map((scan) => {
                      const streamKey = bucketScanMaterial(scan.material);
                      return (
                        <div key={scan.id} className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${STREAM_DOT_BY_KEY[streamKey]}`} />
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-white uppercase tracking-tight truncate">
                                {scan.containerName || "ELIGIBLE CONTAINER"}
                              </p>
                              <p className="text-[11px] text-white/65">
                                {new Date(scan.timestamp).toLocaleString("en-AU", {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </p>
                            </div>
                          </div>
                          <div className="text-right shrink-0 tabular-nums">
                            <p className="text-[13px] font-semibold text-emerald-300">
                              + 10 PTS
                            </p>
                            <p className="text-[11px] font-medium text-white/75">
                              + {scan.refundCents || 8}¢
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[13px] text-white/70 mb-4">
                    No scans yet — scan your first container to earn 8¢ + 10 PTS.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => onOpenAccount?.()}
                  className="w-full min-h-[44px] pt-3.5 pb-1 border-t border-white/15 flex items-center justify-between text-[14px] font-semibold text-white"
                >
                  <span>View payouts &amp; activity statement</span>
                  <ChevronRight className="w-4 h-4 text-white/70" />
                </button>
              </div>

              {/* 4-Column Liquid Glass Quick Stat Squares */}
              <div className="grid grid-cols-4 gap-2.5">
                <ActionTile
                  label="Earn Points"
                  icon={<ScanBarcode className="w-5 h-5 text-emerald-300" strokeWidth={1.75} />}
                  onClick={handleScanClick}
                />
                <ActionTile
                  label="Rewards"
                  icon={<Sparkles className="w-5 h-5 text-white" strokeWidth={1.75} />}
                  onClick={() => { setPointsFilter("rewards"); switchTab("points"); }}
                />
                <ActionTile
                  label={`${summary.currentStreakDays}d Streak`}
                  icon={<Flame className="w-5 h-5 text-amber-300" strokeWidth={1.75} />}
                  onClick={() => switchTab("points")}
                />
                <ActionTile
                  label={`${summary.co2SavedKg.toFixed(1)}kg CO₂`}
                  icon={<Leaf className="w-5 h-5 text-emerald-300" strokeWidth={1.75} />}
                  onClick={() => onOpenAccount?.()}
                />
              </div>

              {/* Bonus Reward Card */}
              <div className="rounded-[24px] liquid-glass p-4">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 shrink-0 rounded-xl bg-emerald-400/20 border border-emerald-200/30 flex items-center justify-center">
                    <Gift className="w-5 h-5 text-emerald-200" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-display font-bold text-white leading-snug">
                      Neighbour Network bonus
                    </p>
                    <p className="text-[12px] text-white/80 mt-1 leading-relaxed">
                      Earn 100 Good Sort Points when a neighbour joins {place} plus 1 bonus point on every container they sort.
                    </p>
                    {!showInviteSheet ? (
                      <button
                        type="button"
                        onClick={() => setShowInviteSheet(true)}
                        className="mt-1 inline-flex items-center min-h-[40px] py-2 -mb-2 text-[13px] font-bold text-emerald-300 hover:text-emerald-200"
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

      {/* ══════════════════ QUICK SORTING GUIDE SHEET (z-50) ══════════════════ */}
      {showHelpSheet && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-3 pb-4 sm:p-5">
          <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" onClick={() => setShowHelpSheet(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="What containers are eligible"
            className="relative z-10 w-full max-w-[400px] rounded-[28px] liquid-glass-light p-6 text-slate-900 shadow-2xl animate-slide-up"
          >
            <div className="flex items-center justify-between gap-2 mb-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">10-second guide</p>
                <h2 className="text-[20px] font-display font-extrabold text-slate-950 leading-tight">What earns 8¢?</h2>
              </div>
              <button
                type="button"
                aria-label="Close sorting guide"
                onClick={() => setShowHelpSheet(false)}
                className="h-10 w-10 rounded-full bg-slate-900/10 hover:bg-slate-900/15 flex items-center justify-center text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2.5 text-[13px] mb-5">
              <div className="flex items-start gap-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-600/20 p-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <p className="text-slate-800">
                  <strong>Yes:</strong> 150mL–3L drink cans, clear &amp; coloured plastic bottles, glass beer/wine/spirit bottles, and poppers with the 10¢ refund mark.
                </p>
              </div>
              <div className="flex items-start gap-2.5 rounded-2xl bg-slate-900/5 border border-slate-900/10 p-3">
                <X className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <p className="text-slate-700">
                  <strong>No:</strong> Plain milk cartons, cordial/syrup bottles, wine casks, or crushed containers whose barcode can&apos;t be verified.
                </p>
              </div>
              <p className="text-[12px] text-slate-600 px-1">
                Empty &amp; rinse lightly, keep lids off or loose, and sort into your 4 home bags: <strong>Cans, Clear PET, Coloured, Glass</strong>.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setShowHelpSheet(false); handleScanClick(); }}
                className="flex-1 min-h-[46px] rounded-full bg-gradient-to-b from-emerald-500 to-emerald-600 text-white font-bold text-[14px] shadow-md"
              >
                Scan now
              </button>
              <Link
                href="/guides/containers-for-change-brisbane"
                onClick={() => setShowHelpSheet(false)}
                className="min-h-[46px] inline-flex items-center justify-center rounded-full bg-slate-900/10 hover:bg-slate-900/15 px-4 text-[13px] font-bold text-slate-800"
              >
                Full FAQ
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════ APPLE WALLET-STYLE MEMBER PASS SHEET (z-50) ══════════════════ */}
      {showPassSheet && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-3 pb-4 sm:p-5">
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setShowPassSheet(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Good Sort Member Card"
            className="relative z-10 w-full max-w-[390px] rounded-[28px] liquid-glass-emerald p-6 text-white shadow-2xl animate-slide-up"
          >
            <div className="flex items-center justify-between gap-2 mb-5">
              <div className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/tgs-glass-icon.webp"
                  alt=""
                  aria-hidden="true"
                  width={28}
                  height={28}
                  className="h-7 w-7 rounded-[7px]"
                />
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-200">Member Pass</p>
                  <p className="text-[15px] font-display font-bold text-white leading-tight">{summary.tier.label} Sorter</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close member card"
                onClick={() => setShowPassSheet(false)}
                className="h-10 w-10 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-2xl bg-black/25 border border-white/20 p-4 mb-4">
              <p className="text-[11px] uppercase tracking-wider text-white/70 mb-1">Member ID</p>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[22px] font-mono font-extrabold tracking-wide text-white tabular-nums">{memberCode}</p>
                <button
                  type="button"
                  onClick={copyMemberCode}
                  className="inline-flex items-center gap-1.5 min-h-[38px] rounded-full bg-white/95 text-slate-950 px-3.5 py-1.5 text-[12px] font-bold"
                >
                  {copiedMemberId ? <><Check className="w-3.5 h-3.5 text-emerald-600" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-5 text-center">
              <div className="rounded-xl bg-white/10 border border-white/15 py-2.5 px-2">
                <p className="text-[15px] font-display font-extrabold text-white tabular-nums">{formatCents(summary.totalCreditCents)}</p>
                <p className="text-[10px] uppercase tracking-wider text-white/70 mt-0.5">Credit</p>
              </div>
              <div className="rounded-xl bg-white/10 border border-white/15 py-2.5 px-2">
                <p className="text-[15px] font-display font-extrabold text-white tabular-nums">{summary.totalContainers.toLocaleString()}</p>
                <p className="text-[10px] uppercase tracking-wider text-white/70 mt-0.5">Cans</p>
              </div>
              <div className="rounded-xl bg-white/10 border border-white/15 py-2.5 px-2">
                <p className="text-[15px] font-display font-extrabold text-emerald-200 tabular-nums">{summary.goodSortPoints.toLocaleString()}</p>
                <p className="text-[10px] uppercase tracking-wider text-white/70 mt-0.5">Points</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setShowPassSheet(false); onOpenAccount?.(); }}
                className="flex-1 min-h-[46px] rounded-full bg-white/95 hover:bg-white text-slate-950 font-bold text-[13px]"
              >
                Payouts &amp; settings
              </button>
              <Link
                href="/invite"
                onClick={() => setShowPassSheet(false)}
                className="min-h-[46px] inline-flex items-center justify-center rounded-full liquid-glass-pill px-4 text-[13px] font-bold text-white"
              >
                Share
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════ FLOATING iOS 26 LIQUID GLASS BOTTOM TAB BAR (SPRING SLIDER) ══════════════════ */}
      <nav
        aria-label="Main app navigation"
        className="fixed inset-x-0 z-30 flex justify-center px-4 pointer-events-none"
        style={{ bottom: "max(14px, env(safe-area-inset-bottom, 14px))" }}
      >
        <div className="pointer-events-auto relative w-full max-w-[390px] rounded-full liquid-glass-dock p-1.5 grid grid-cols-5 items-center gap-0.5">
          {/* Smooth spring sliding white pill behind active tab */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1.5 bottom-1.5 left-1.5 rounded-full bg-white/95 shadow-[0_4px_14px_rgba(0,0,0,0.22)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{
              width: "calc((100% - 12px) / 5)",
              transform: `translateX(${dockCol * 100}%)`,
            }}
          />
          <TabPill
            label="Home"
            active={activeTab === "home"}
            icon={<Home className="w-[20px] h-[20px]" strokeWidth={activeTab === "home" ? 2.25 : 1.75} />}
            onClick={() => switchTab("home")}
          />
          <TabPill
            label="Pickups"
            active={activeTab === "pickups"}
            icon={<Truck className="w-[20px] h-[20px]" strokeWidth={activeTab === "pickups" ? 2.25 : 1.75} />}
            onClick={() => switchTab("pickups")}
          />
          <TabPill
            label="Scan"
            active={false}
            accent
            icon={<ScanBarcode className="w-[20px] h-[20px]" strokeWidth={2.25} />}
            onClick={handleScanClick}
          />
          <TabPill
            label="Points"
            active={activeTab === "points"}
            icon={<Sparkles className="w-[20px] h-[20px]" strokeWidth={activeTab === "points" ? 2.25 : 1.75} />}
            onClick={() => switchTab("points")}
          />
          <TabPill
            label="Profile"
            active={activeTab === "profile"}
            icon={<UserIcon className="w-[20px] h-[20px]" strokeWidth={activeTab === "profile" ? 2.25 : 1.75} />}
            onClick={() => switchTab("profile")}
          />
        </div>
      </nav>
    </div>
  );
}

function TabPill({
  label,
  active,
  accent,
  icon,
  onClick,
}: {
  label: string;
  active: boolean;
  accent?: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`relative z-10 flex flex-col items-center justify-center rounded-full py-2 px-1 transition-all duration-200 active:scale-[0.94] ${
        active
          ? "text-slate-950"
          : accent
            ? "bg-gradient-to-b from-emerald-400 to-emerald-600 text-slate-950 shadow-[0_6px_18px_rgba(16,185,129,0.45)] mx-0.5"
            : "text-white/90 hover:text-white"
      }`}
    >
      {icon}
      <span className={`text-[10px] mt-1 leading-none tracking-[-0.01em] ${active || accent ? "font-bold" : "font-medium"}`}>
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
      <div className="w-full aspect-square rounded-2xl liquid-glass flex items-center justify-center group-active:scale-[0.95] transition-transform">
        {icon}
      </div>
      <span className="text-[11px] font-semibold text-white/90 text-center mt-1.5 leading-tight glass-text-shadow">
        {label}
      </span>
    </button>
  );
}

function GlassTileLink({
  label,
  caption,
  href,
  icon,
}: {
  label: string;
  caption: string;
  href: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-[24px] liquid-glass p-4 min-h-[116px] flex flex-col items-center justify-center text-center gap-2 hover:bg-white/20 active:scale-[0.97] transition-all"
    >
      <div className="h-11 w-11 rounded-2xl bg-white/15 border border-white/25 flex items-center justify-center shadow-inner">
        {icon}
      </div>
      <div>
        <p className="text-[14px] font-display font-bold text-white leading-tight">{label}</p>
        <p className="text-[11px] text-white/75 leading-tight mt-0.5">{caption}</p>
      </div>
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
      className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-white/10 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        {icon}
        <span className="text-[14px] font-medium text-white truncate">{label}</span>
      </div>
      <ChevronRight className="w-4 h-4 text-white/70 shrink-0" />
    </Link>
  );
}
