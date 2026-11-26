"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, ChevronRight, Recycle, Banknote, Truck, ArrowDown, Check, MapPin, Home, ScanBarcode } from "lucide-react";
import { launchBonusHeadline } from "@/lib/credit";
import { apiUrl, clearAuth, hasValidToken, persistWaitlistFromUrl, readDayHint, readReferrerId, readStoredProfile, waitlistContinuePath, writeDayHint } from "@/lib/config";
import { track } from "@/lib/analytics";
import { BCC_BIN_DAY_DATASET, LIVE_VOLUME_THRESHOLD, dayClusterStats, daySlug, findSuburb, inviteMessage, sameSuburb, streetInviteUrl, titleSuburb, type GrowthSuburb } from "@/lib/brisbane";
import { Logo } from "@/app/components/shared/logo";
import { GlassBackdrop } from "@/app/components/shared/glass-backdrop";
import { HeroKerbsideCard, SortAnimation } from "@/app/components/shared/sort-animation";
import { InviteActions } from "@/app/components/shared/invite-actions";
import { SuburbFinder } from "@/app/components/marketing/suburb-finder";
import { DensityBoard } from "@/app/components/marketing/density-board";

const APP_HOME_PATH = "/sort";

type GrowthResponse = { liveThreshold: number; launchBonusContainers?: number; totalHouseholds: number; totalContainers?: number; suburbs: GrowthSuburb[] };

export function MarketingHome({ suburbName }: { suburbName?: string }) {
  const router = useRouter();
  const [showAuth, setShowAuth] = useState(false);
  const [step, setStep] = useState<"email" | "verify">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [devCode, setDevCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [growth, setGrowth] = useState<GrowthResponse | null>(null);
  const [inviteFrom, setInviteFrom] = useState<{ name: string; suburb: string | null; dayName?: string | null } | null>(null);
  const [dayHint, setDayHint] = useState<number | null>(null);
  const [lookedUpSuburb, setLookedUpSuburb] = useState<string | null>(null);
  const [redirectingToApp, setRedirectingToApp] = useState(false);

  useEffect(() => {
    persistWaitlistFromUrl();
    setDayHint(readDayHint());
    if (suburbName) sessionStorage.setItem("goodsort_suburb_hint", suburbName);
    if (!hasValidToken()) {
      if (localStorage.getItem("goodsort_token")) clearAuth();
      track(suburbName ? "suburb_page_viewed" : "landing_viewed", { suburb: suburbName ?? null });
    } else if (!suburbName && !new URLSearchParams(window.location.search).has("home")) {
      setRedirectingToApp(true);
      const cachedProfile = readStoredProfile();
      if (typeof cachedProfile.householdId === "string" && cachedProfile.householdId) {
        router.replace(APP_HOME_PATH);
      }
      void waitlistContinuePath()
        .then((path) => {
          if (path === APP_HOME_PATH) router.replace(path);
          else setRedirectingToApp(false);
        })
        .catch(() => { setRedirectingToApp(false); });
    } else {
      track(suburbName ? "suburb_page_viewed" : "landing_viewed", { suburb: suburbName ?? null });
    }
    const rid = readReferrerId();
    if (!rid) return;
    fetch(apiUrl(`/api/growth/invite/${rid}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { name?: string; suburb?: string | null; day?: number | null; dayName?: string | null } | null) => {
        if (!d?.name) return;
        setInviteFrom({ name: d.name, suburb: d.suburb ?? null, dayName: d.dayName ?? null });
        track("invite_landed", { suburb: d.suburb ?? suburbName });
        const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : `r=${rid}`);
        if (d.day != null && !params.get("day")) params.set("day", daySlug(d.day) ?? String(d.day));
        if (d.day != null) setDayHint(d.day);
        if (suburbName || !d.suburb) return;
        const known = findSuburb(d.suburb);
        if (!known) return;
        router.replace(`/brisbane/${known.slug}?${params.toString()}`);
      })
      .catch(() => {});
  }, [router, suburbName]);

  useEffect(() => {
    fetch(apiUrl("/api/growth/brisbane"))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setGrowth(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const place = suburbName ?? lookedUpSuburb;
  const local = place
      ? growth?.suburbs.find((s) => sameSuburb(s.suburb, place))
    : null;
  const cluster = dayClusterStats(local, dayHint) ?? dayClusterStats(local);
  const scanned = place ? (local?.containers ?? cluster?.containers ?? 0) : null;
  const needed = local?.needed ?? cluster?.needed ?? LIVE_VOLUME_THRESHOLD;
  const dayLive = !!(local?.live ?? cluster?.live);
  const shareUrl = streetInviteUrl({ suburb: place, day: dayHint, dayName: cluster?.dayName });
  const shareMessage = inviteMessage(shareUrl, place, {
    dayName: cluster?.dayName,
    containers: place ? (scanned ?? 0) : undefined,
    needed: place ? needed : undefined,
    live: dayLive,
  });

  async function sendOtp() {
    if (!email.includes("@")) return;
    setLoading(true); setError("");
    try {
      const res = await fetch(apiUrl("/api/auth/send-otp"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({} as { error?: string; devCode?: string }));
      if (!res.ok) {
        setError(typeof data.error === "string" && data.error ? data.error : "Failed to send code");
        setLoading(false);
        return;
      }
      if (typeof data.devCode === "string" && data.devCode.length === 6) {
        setDevCode(data.devCode);
        setOtp(data.devCode);
      } else {
        setDevCode("");
      }
      track("otp_sent", { suburb: place });
      setResendIn(30);
      setStep("verify");
    } catch { setError("Something went wrong"); }
    setLoading(false);
  }

  async function verifyOtp() {
    if (otp.length < 6) return;
    setLoading(true); setError("");
    try {
      const referrerId = readReferrerId();
      const res = await fetch(apiUrl("/api/auth/verify-otp"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: otp, referrerId }),
      });
      const data = await res.json().catch(() => ({} as { error?: string; token?: string; profile?: unknown }));
      if (!res.ok || !data.token || !data.profile) {
        setError(typeof data.error === "string" && data.error ? data.error : "Verification failed. Please try again.");
        setLoading(false);
        return;
      }
      localStorage.setItem("goodsort_token", data.token);
      localStorage.setItem("goodsort_profile", JSON.stringify(data.profile));
      track("otp_verified", { suburb: place });
      router.push(await waitlistContinuePath());
    } catch { setError("Verification failed"); }
    setLoading(false);
  }

  if (redirectingToApp) {
    return (
      <div className="relative min-h-dvh flex flex-col items-center justify-center px-6 overflow-x-clip" aria-busy="true" aria-label="Opening your dashboard">
        <GlassBackdrop />
        <div className="relative z-10 animate-pulse">
          <Logo size="lg" dark />
        </div>
      </div>
    );
  }

  if (showAuth) {
    return (
      <div className="relative min-h-dvh text-white flex flex-col items-center justify-center px-5 py-8 overflow-x-clip" style={{ paddingTop: "max(24px, env(safe-area-inset-top, 24px))", paddingBottom: "max(24px, env(safe-area-inset-bottom, 24px))" }}>
        <GlassBackdrop />
        <div className="relative z-10 w-full max-w-sm rounded-[28px] liquid-glass p-6">
          {step === "email" ? (
            <>
              <div className="text-center mb-6">
                <div className="flex justify-center mb-4"><Logo size="md" dark /></div>
                <h1 className="text-2xl font-display font-extrabold text-white glass-text-shadow mb-2">Start scanning today</h1>
                <p className="text-white/85 text-[13px]">Your email. Then your address &amp; payout details. Scan for 8¢ — suburb volume unlocks a driver trip.</p>
              </div>
              <input type="email" aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com"
                onFocus={(e) => setTimeout(() => e.target.scrollIntoView({ behavior: "smooth", block: "center" }), 300)}
                className="w-full bg-white/95 border border-white rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 mb-3" autoFocus />
              {error && <p className="text-red-200 bg-red-950/40 rounded-xl px-3 py-2 text-[12px] mb-2">{error}</p>}
              <GreenButton onClick={sendOtp} disabled={loading || !email.includes("@")}>
                {loading ? "Sending code..." : "Continue"}
              </GreenButton>
              <button type="button" onClick={() => setShowAuth(false)} className="w-full min-h-[44px] text-white/85 hover:text-white text-[13px] font-semibold mt-2 py-2.5">Back</button>
            </>
          ) : (
            <>
              <div className="text-center mb-6">
                <div className="w-14 h-14 liquid-glass-emerald rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <ShieldCheck className="w-7 h-7 text-emerald-200" />
                </div>
                <h1 className="text-2xl font-display font-extrabold text-white glass-text-shadow mb-1">Check your email</h1>
                <p className="text-white/85 text-[13px]">Code sent to {email}. The code is in the subject line — check spam too. It expires in 15 minutes.</p>
                {devCode && <p className="text-[12px] text-amber-200 mt-2">Local code {devCode} — ACS email is not configured on this machine.</p>}
              </div>
              <input type="text" aria-label="6-digit verification code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="000000"
                className="w-full text-center text-3xl font-display font-extrabold tracking-[0.3em] bg-white/95 border border-white rounded-xl px-4 py-4 text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 mb-3" autoFocus />
              {error && <p className="text-red-200 bg-red-950/40 rounded-xl px-3 py-2 text-[12px] mb-2 text-center">{error}</p>}
              <GreenButton onClick={verifyOtp} disabled={loading || otp.length < 6}>
                {loading ? "Verifying..." : "Verify"}
              </GreenButton>
              <div className="flex items-center justify-between mt-3 text-[13px]">
                <button
                  type="button"
                  disabled={loading || resendIn > 0}
                  onClick={() => void sendOtp()}
                  className="min-h-[44px] text-emerald-200 font-semibold py-2.5 disabled:text-white/40"
                >
                  {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                </button>
                <button
                  type="button"
                  onClick={() => { setStep("email"); setOtp(""); setError(""); setDevCode(""); }}
                  className="min-h-[44px] text-white/80 hover:text-white py-2.5"
                >
                  Use a different email
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const heroSuburbs = (() => {
    const liveList = (growth?.suburbs ?? [])
      .filter((s) => s.suburb && s.suburb !== "UNKNOWN")
      .slice(0, 3)
      .map((s) => ({
        name: titleSuburb(s.suburb),
        slug: findSuburb(s.suburb)?.slug ?? s.suburb.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        containers: s.containers ?? 0,
        live: Boolean(s.live),
      }));
    if (liveList.length >= 3) return liveList;
    const defaults = [
      { name: "Moorooka", slug: "moorooka", containers: 0, live: false },
      { name: "Annerley", slug: "annerley", containers: 0, live: false },
      { name: "Tarragindi", slug: "tarragindi", containers: 0, live: false },
    ];
    for (const d of defaults) {
      if (liveList.length >= 3) break;
      if (!liveList.some((x) => x.slug === d.slug)) liveList.push(d);
    }
    return liveList;
  })();

  return (
    <div className="min-h-dvh bg-[#f6f7f5] overflow-y-auto overscroll-none">
      {/* ══════════════════ FULL-BLEED APPLE LIQUID GLASS HERO ══════════════════ */}
      <section
        className="relative min-h-[92svh] overflow-hidden flex flex-col justify-between text-white"
        style={{ paddingTop: "max(16px, env(safe-area-inset-top, 16px))" }}
      >
        {/* Full-bleed sunlit Brisbane Queenslander veranda backdrop */}
        <div className="absolute inset-0 z-0 select-none pointer-events-none" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/brisbane-veranda-glass.webp"
            alt=""
            className="h-full w-full object-cover object-center brightness-[1.14] saturate-[1.08]"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, rgba(10,28,38,0.16) 0%, rgba(14,32,36,0.12) 44%, rgba(8,22,22,0.40) 100%)",
            }}
          />
        </div>

        {/* Floating Apple iOS 26 Liquid Glass Top Bar */}
        <header className="relative z-10 w-full max-w-6xl mx-auto px-5 sm:px-8 pt-1 pb-4 flex items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 min-h-[44px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/tgs-glass-icon.webp"
              alt=""
              aria-hidden="true"
              width={32}
              height={32}
              className="h-8 w-8 rounded-[9px] shadow-md"
            />
            <span className="font-display font-extrabold text-[17px] tracking-tight text-white glass-text-shadow">
              thegoodsort.org
            </span>
          </Link>

          <nav
            aria-label="Primary navigation"
            className="hidden md:inline-flex items-center gap-1 rounded-full liquid-glass-pill p-1"
          >
            <Link
              href="/scan"
              className="min-h-[36px] px-4 py-1.5 rounded-full bg-white/95 text-slate-950 text-[13px] font-bold shadow-sm inline-flex items-center"
            >
              Scan
            </Link>
            <Link
              href="/marketplace#suburb-map"
              className="min-h-[36px] px-4 py-1.5 rounded-full text-white/90 hover:text-white hover:bg-white/10 text-[13px] font-semibold inline-flex items-center transition-colors"
            >
              Suburbs
            </Link>
            <Link
              href="/bags"
              className="min-h-[36px] px-4 py-1.5 rounded-full text-white/90 hover:text-white hover:bg-white/10 text-[13px] font-semibold inline-flex items-center transition-colors"
            >
              Bags
            </Link>
            <Link
              href="/runner/signup"
              className="min-h-[36px] px-4 py-1.5 rounded-full text-white/90 hover:text-white hover:bg-white/10 text-[13px] font-semibold inline-flex items-center transition-colors"
            >
              Runners
            </Link>
          </nav>

          <button
            type="button"
            onClick={() => {
              track("waitlist_cta", { suburb: place });
              if (hasValidToken()) { void waitlistContinuePath().then((path) => router.push(path)); return; }
              setShowAuth(true);
            }}
            className="min-h-[42px] px-4 py-2 rounded-full liquid-glass-pill text-[13px] font-bold text-white hover:bg-white/25 active:scale-[0.97] transition-all"
          >
            Start Free
          </button>
        </header>

        {/* Centerpiece Hero Typography + Liquid Glass Scan Capsule */}
        <div className="relative z-10 w-full max-w-3xl mx-auto px-5 sm:px-8 py-8 sm:py-12 text-center">
          <div className="inline-flex items-center gap-2 liquid-glass-pill text-white text-[12px] font-semibold px-3.5 py-1.5 rounded-full mb-5">
            <MapPin className="w-3.5 h-3.5 text-emerald-300" />
            <span>{suburbName ? `${suburbName} · 8¢ at your door` : "Brisbane · 8¢ at your door"}</span>
          </div>

          {inviteFrom && (
            <p className="max-w-xl mx-auto mb-5 text-[14px] font-semibold text-white liquid-glass-emerald rounded-2xl px-4 py-3">
              {inviteFrom.name} invited you{suburbName ? ` to scan in ${suburbName}` : ""}. Join and scan — suburb volume unlocks a driver trip.
            </p>
          )}

          <h1 className="text-[40px] sm:text-[62px] leading-[1.02] font-display font-extrabold tracking-[-0.03em] text-white glass-text-shadow mb-4">
            Scan, sort, skip the depot.
          </h1>
          <p className="text-white/90 text-[16px] sm:text-[19px] leading-relaxed max-w-xl mx-auto mb-6 glass-text-shadow">
            Scan a can, earn 8¢. We collect from your kerb — you never drive to a depot.
          </p>

          {/* Primary Liquid Glass Scan Action Capsule (bright milky glass for WCAG AAA legibility over sunlit sky) */}
          <div className="max-w-lg mx-auto mb-3">
            <button
              type="button"
              onClick={() => { track("waitlist_cta", { suburb: place }); router.push("/scan"); }}
              className="w-full min-h-[62px] rounded-full liquid-glass-bright pl-6 pr-2 py-2 flex items-center justify-between gap-3 text-left group active:scale-[0.99] transition-transform"
            >
              <div className="min-w-0">
                <p className="text-[15px] sm:text-[16px] font-display font-extrabold text-slate-950 truncate">
                  Scan a container · earn 8¢
                </p>
                <p className="text-[12px] font-medium text-slate-700 truncate">
                  Moorooka, Annerley, Tarragindi &amp; Brisbane suburbs
                </p>
              </div>
              <span className="h-11 w-11 shrink-0 rounded-full bg-gradient-to-b from-emerald-500 to-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-900/25 group-hover:scale-105 transition-transform">
                <ScanBarcode className="w-5 h-5" />
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                track("waitlist_cta", { suburb: place });
                if (hasValidToken()) { void waitlistContinuePath().then((path) => router.push(path)); return; }
                setShowAuth(true);
              }}
              className="inline-flex items-center justify-center min-h-[44px] mt-2 px-4 py-2 text-white/90 hover:text-white text-[13px] font-semibold transition-colors glass-text-shadow"
            >
              No container handy? Join your suburb waitlist or sign in →
            </button>
          </div>

          {growth === null ? (
            <p aria-hidden className="inline-block rounded-full text-[12px] font-semibold px-4 py-1.5 opacity-0 select-none">
              {launchBonusHeadline(20)}
            </p>
          ) : (
            launchBonusHeadline(growth.launchBonusContainers) && (
              <p className="inline-block rounded-full liquid-glass-emerald text-emerald-100 text-[12px] font-semibold px-4 py-1.5 mb-2">
                {launchBonusHeadline(growth.launchBonusContainers)}
              </p>
            )
          )}

          <p className="text-white/75 text-[12px] max-w-md mx-auto">
            An 8¢ sorting credit paid after pickup and depot verification.{" "}
            <a href="/terms" className="underline text-white hover:text-emerald-200">How it works</a>.
          </p>

          {place && (
            <div className="mt-6 max-w-md mx-auto liquid-glass rounded-2xl px-4 py-3.5 text-left">
              <p className="text-[11px] font-bold text-emerald-200 uppercase tracking-wider mb-1">{place}</p>
              <p className="text-[15px] font-semibold text-white">
                {dayLive
                  ? `Enough containers for a driver trip — bag out when we collect.`
                  : scanned === 0
                    ? `Be the first scan here.`
                    : `${scanned?.toLocaleString()}/${LIVE_VOLUME_THRESHOLD.toLocaleString()} containers. ${needed.toLocaleString()} more and we drive.`}
              </p>
              <div className="mt-3">
                <InviteActions url={shareUrl} message={shareMessage} compact />
              </div>
            </div>
          )}
        </div>

        {/* Bottom Floating Translucent Liquid Glass Suburb Cards (matching 2D inspiration) */}
        <div className="relative z-10 w-full max-w-6xl mx-auto px-5 sm:px-8 pb-7">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {heroSuburbs.map((s) => {
              const progressPct = Math.min(100, Math.round((s.containers / LIVE_VOLUME_THRESHOLD) * 100));
              return (
                <Link
                  key={s.slug}
                  href={`/brisbane/${s.slug}`}
                  className={`${s.live ? "liquid-glass-emerald" : "liquid-glass"} rounded-[22px] p-4 flex flex-col justify-between gap-2.5 hover:scale-[1.01] active:scale-[0.99] transition-transform`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[16px] font-display font-bold text-white truncate">
                      {s.name}
                    </p>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        s.live
                          ? "bg-emerald-400/90 text-slate-950"
                          : "bg-emerald-500/35 border border-emerald-200/40 text-emerald-100"
                      }`}
                    >
                      {s.live ? "Ready" : "Forming"}
                    </span>
                  </div>
                  <div>
                    <p className="text-[12px] text-white/85 tabular-nums mb-1.5">
                      {s.containers > 0
                        ? `${s.containers.toLocaleString()} / ${LIVE_VOLUME_THRESHOLD.toLocaleString()} cans`
                        : `1,000 cans unlocks kerb pickup`}
                    </p>
                    <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-400"
                        style={{ width: `${Math.max(progressPct, s.containers > 0 ? 6 : 4)}%` }}
                      />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
          <div className="mt-4 text-white/70 animate-bounce sm:hidden">
            <ArrowDown className="w-5 h-5 mx-auto" />
          </div>
        </div>
      </section>

      {!suburbName && (
        <section className="px-5 py-12 max-w-xl mx-auto">
          <div className="rounded-[30px] bg-white border border-slate-200/80 shadow-[0_10px_30px_-14px_rgba(15,23,42,0.08)] p-6 sm:p-8">
            <h2 className="text-center text-[12px] text-slate-500 font-semibold uppercase tracking-[0.15em] mb-4">Your suburb</h2>
            <SuburbFinder />
            <div className="mt-8"><DensityBoard /></div>
          </div>
        </section>
      )}

      <section className="px-5 py-4 max-w-2xl mx-auto">
        <div className="rounded-[32px] bg-gradient-to-br from-[#0d2229] via-[#0e2a2c] to-[#0a1b20] text-white px-6 py-12 sm:px-10 shadow-[0_24px_60px_-24px_rgba(8,22,26,0.45)] border border-white/10">
          <div className="max-w-lg mx-auto text-center">
            <p className="text-emerald-300/90 text-[12px] font-semibold uppercase tracking-[0.16em] mb-4">Why at home</p>
            <h2 className="text-[24px] sm:text-[30px] font-display font-extrabold leading-tight tracking-[-0.02em] mb-4">
              The depot trip is where<br /><span className="text-emerald-300">the 10¢ goes unclaimed</span>
            </h2>
            <p className="text-white/75 text-[14px] leading-relaxed max-w-sm mx-auto mb-8">
              About a third of eligible containers in Queensland never reach a refund point. People are recycling. They are not driving to a depot for 10¢ a bottle.
            </p>
            <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
              <MiniStat value="8¢" label="your credit" />
              <MiniStat value="+100" label="invite pts" />
              <MiniStat value="scan" label="the habit" />
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="px-5 py-14 max-w-2xl mx-auto">
        <h2 className="text-center text-[12px] text-slate-500 font-semibold uppercase tracking-[0.15em] mb-4">How it works</h2>
        <div className="hidden lg:block mb-8"><HeroKerbsideCard suburbName={suburbName} /></div>
        <div className="mb-10"><SortAnimation /></div>

        <div className="rounded-[30px] bg-white border border-slate-200/80 shadow-[0_10px_30px_-14px_rgba(15,23,42,0.08)] p-6 sm:p-8 relative">
          <div className="relative">
            <div className="absolute left-[23px] top-6 bottom-6 w-[2px] bg-slate-200/80 rounded-full" />
            <div className="space-y-9">
              <StepRow icon={<Home className="w-5 h-5" />} color="from-slate-800 to-slate-950" num={1}
                title="Scan a container"
                body="Point your camera at a can or bottle. 8¢ pending, straight away."
                tag="Scan first" tagColor="bg-slate-100 text-slate-700" />
              <StepRow icon={<Recycle className="w-5 h-5" />} color="from-emerald-600 to-teal-700" num={2}
                title="Sort into your bags"
                body="Four streams at home: cans, clear plastic, coloured plastic, glass."
                tag="Your bags, your sort" tagColor="bg-emerald-50 text-emerald-800" />
              <StepRow icon={<Truck className="w-5 h-5" />} color="from-slate-800 to-slate-950" num={3}
                title="Suburb volume run"
                body={`At about ${LIVE_VOLUME_THRESHOLD} containers in your suburb, we drive. Bag out; we do the depot run.`}
                tag="One driver trip" tagColor="bg-slate-100 text-slate-700" />
              <StepRow icon={<Banknote className="w-5 h-5" />} color="from-emerald-500 to-emerald-700" num={4}
                title="Get paid 8¢/can — plus Good Sort Points"
                body="Credits clear after depot verification. Share your link to earn 100 Good Sort Points when a neighbour joins plus 1 bonus point on every container they sort."
                tag="8¢ credit + Good Sort Points" tagColor="bg-emerald-50 text-emerald-800" />
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-6">
        <div className="max-w-lg mx-auto flex flex-wrap justify-center gap-4">
          <TrustItem icon={<MapPin className="w-4 h-4" />} text="Scan today in Brisbane" />
          <TrustItem icon={<Check className="w-4 h-4" />} text="Volume run when ready" />
          <TrustItem icon={<Check className="w-4 h-4" />} text="Credits clear after depot verify" />
        </div>
      </section>

      <section className="px-6 py-14 text-center">
        <div className="max-w-sm mx-auto">
          <h2 className="text-[28px] font-display font-extrabold text-slate-900 mb-3 leading-tight tracking-[-0.02em]">
            Start scanning in your suburb
          </h2>
          <p className="text-slate-500 text-[14px] mb-8">
            About {LIVE_VOLUME_THRESHOLD} containers in your suburb and we drive.
          </p>
          <GreenButton onClick={() => { track("waitlist_cta", { suburb: place }); router.push("/scan"); }}>
            Scan a container <ChevronRight className="w-5 h-5 inline ml-1" />
          </GreenButton>
        </div>
      </section>

      <footer className="px-6 py-8 text-center border-t border-slate-200/70">
        <div className="flex justify-center mb-3"><Logo size="sm" /></div>
        <p className="text-[11px] text-slate-400">
          Not a live city-wide pickup. Sorting credits are a private reward, not the 10¢ Containers for Change refund. We are not claiming approval as a Containers for Change refund point.
        </p>
        <div className="flex flex-wrap justify-center gap-x-1 gap-y-0.5 mt-2">
          <a href="/brisbane" className="inline-flex items-center min-h-[44px] px-2.5 text-[12px] text-slate-500 hover:text-slate-700 transition-colors">Brisbane suburbs</a>
          <a href="/marketplace" className="inline-flex items-center min-h-[44px] px-2.5 text-[12px] text-slate-500 hover:text-slate-700 transition-colors">Suburb map</a>
          <a href="/guides/containers-for-change-brisbane" className="inline-flex items-center min-h-[44px] px-2.5 text-[12px] text-slate-500 hover:text-slate-700 transition-colors">Containers for Change</a>
          <a href="/terms" className="inline-flex items-center min-h-[44px] px-2.5 text-[12px] text-slate-500 hover:text-slate-700 transition-colors">Terms</a>
          <a href="/privacy" className="inline-flex items-center min-h-[44px] px-2.5 text-[12px] text-slate-500 hover:text-slate-700 transition-colors">Privacy</a>
        </div>
      </footer>
    </div>
  );
}

function StepRow({ icon, color, num, title, body, tag, tagColor }: {
  icon: React.ReactNode; color: string; num: number; title: string; body: string; tag: string; tagColor: string;
}) {
  return (
    <div className="flex gap-4 items-start relative">
      <div className="relative flex-shrink-0 z-10">
        <div className={`w-12 h-12 bg-gradient-to-br ${color} rounded-2xl flex items-center justify-center text-white`}>
          {icon}
        </div>
        <span className="absolute -top-1.5 -left-1.5 w-5 h-5 bg-slate-900 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{num}</span>
      </div>
      <div className="pt-0.5">
        <h3 className="text-[15px] font-bold text-slate-900 mb-1">{title}</h3>
        <p className="text-[13px] text-slate-500 leading-relaxed mb-2">{body}</p>
        <span className={`inline-block text-[11px] font-semibold px-2.5 py-1 rounded-full ${tagColor}`}>{tag}</span>
      </div>
    </div>
  );
}

function ValueCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-200">
      <h3 className="text-[14px] font-bold text-slate-900 mb-1">{title}</h3>
      <p className="text-[12px] text-slate-500 leading-relaxed">{body}</p>
    </div>
  );
}

function TrustItem({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 text-slate-500">
      <div className="w-7 h-7 bg-white border border-slate-200 rounded-full flex items-center justify-center text-green-600">{icon}</div>
      <span className="text-[12px] font-medium">{text}</span>
    </div>
  );
}

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl py-3 px-2">
      <p className="text-[22px] font-display font-extrabold text-green-400">{value}</p>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}

function GreenButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-full bg-gradient-to-b from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-extrabold py-4 rounded-2xl text-[16px] disabled:opacity-50 transition-all min-h-[52px] flex items-center justify-center active:scale-[0.98]">
      {children}
    </button>
  );
}
