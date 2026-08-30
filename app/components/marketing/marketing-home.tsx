"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ChevronRight, Recycle, Banknote, Truck, ArrowDown, Check, MapPin, Home } from "lucide-react";
import { launchBonusHeadline } from "@/lib/credit";
import { apiUrl, clearAuth, hasValidToken, persistWaitlistFromUrl, readDayHint, readReferrerId, waitlistContinuePath, writeDayHint } from "@/lib/config";
import { track } from "@/lib/analytics";
import { BCC_BIN_DAY_DATASET, LIVE_VOLUME_THRESHOLD, dayClusterStats, daySlug, findSuburb, inviteMessage, sameSuburb, streetInviteUrl, type GrowthSuburb } from "@/lib/brisbane";
import { Logo } from "@/app/components/shared/logo";
import { SortAnimation } from "@/app/components/shared/sort-animation";
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [growth, setGrowth] = useState<GrowthResponse | null>(null);
  const [inviteFrom, setInviteFrom] = useState<{ name: string; suburb: string | null; dayName?: string | null } | null>(null);
  const [dayHint, setDayHint] = useState<number | null>(null);
  const [lookedUpSuburb, setLookedUpSuburb] = useState<string | null>(null);

  useEffect(() => {
    persistWaitlistFromUrl();
    setDayHint(readDayHint());
    if (suburbName) sessionStorage.setItem("goodsort_suburb_hint", suburbName);
    if (!hasValidToken()) {
      if (localStorage.getItem("goodsort_token")) clearAuth();
    } else {
      try {
        const hid = JSON.parse(localStorage.getItem("goodsort_profile") || "{}").householdId;
        if (hid) {
          void waitlistContinuePath().then((path) => {
            if (path === APP_HOME_PATH) router.push(path);
          });
        }
      } catch { /* stay on the invite landing */ }
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
      if (!res.ok) { setError("Invalid code"); setLoading(false); return; }
      const data = await res.json();
      localStorage.setItem("goodsort_token", data.token);
      localStorage.setItem("goodsort_profile", JSON.stringify(data.profile));
      document.cookie = `goodsort_token=${data.token}; path=/; max-age=${30*24*60*60}; SameSite=Lax; Secure`;
      track("otp_verified", { suburb: place });
      router.push(await waitlistContinuePath());
    } catch { setError("Verification failed"); }
    setLoading(false);
  }

  if (showAuth) {
    return (
      <div className="min-h-dvh bg-white flex flex-col items-center justify-center px-6" style={{ paddingTop: "env(safe-area-inset-top,0)", paddingBottom: "env(safe-area-inset-bottom,0)" }}>
        <div className="w-full max-w-sm">
          {step === "email" ? (
            <>
              <div className="text-center mb-8">
                <div className="flex justify-center mb-5"><Logo size="lg" /></div>
                <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-2">Start scanning today</h1>
                <p className="text-slate-400 text-[13px]">Your email. Then your address. Scan for 5¢ — suburb volume unlocks a driver trip.</p>
              </div>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com"
                onFocus={(e) => setTimeout(() => e.target.scrollIntoView({ behavior: "smooth", block: "center" }), 300)}
                className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500 mb-3" autoFocus />
              {error && <p className="text-red-500 text-[12px] mb-2">{error}</p>}
              <GreenButton onClick={sendOtp} disabled={loading || !email.includes("@")}>
                {loading ? "Sending code..." : "Continue"}
              </GreenButton>
              <button onClick={() => setShowAuth(false)} className="w-full text-slate-400 text-[13px] mt-4 py-2">Back</button>
            </>
          ) : (
            <>
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <ShieldCheck className="w-8 h-8 text-green-600" />
                </div>
                <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-1">Check your email</h1>
                <p className="text-slate-400 text-[13px]">Code sent to {email}. The code is in the subject line — check spam too. It expires in 15 minutes.</p>
                {devCode && <p className="text-[12px] text-violet-700 mt-2">Local code {devCode} — ACS email is not configured on this machine.</p>}
              </div>
              <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="000000"
                className="w-full text-center text-3xl font-display font-extrabold tracking-[0.3em] border border-slate-200 rounded-xl px-4 py-4 text-slate-900 placeholder-slate-200 focus:outline-none focus:ring-2 focus:ring-green-500/30 mb-3" autoFocus />
              {error && <p className="text-red-500 text-[12px] mb-2 text-center">{error}</p>}
              <GreenButton onClick={verifyOtp} disabled={loading || otp.length < 6}>
                {loading ? "Verifying..." : "Verify"}
              </GreenButton>
              <button type="button" onClick={() => void sendOtp()} className="w-full text-green-700 text-[13px] font-semibold py-3 mt-1">
                Resend code
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white overflow-y-auto overscroll-none" style={{ paddingTop: "env(safe-area-inset-top,0)" }}>
      <section className="relative min-h-[88svh] overflow-hidden px-6 py-8 flex items-center bg-gradient-to-br from-white via-violet-50 to-emerald-50">
        <div className="relative z-10 w-full max-w-6xl mx-auto lg:grid lg:grid-cols-2 lg:gap-12 lg:items-center">
          <div>
          <div className="mb-9"><Logo size="lg" /></div>

          <div className="inline-flex items-center gap-2 bg-white/82 text-violet-800 text-[12px] font-semibold px-3.5 py-1.5 rounded-full mb-6 border border-violet-200">
            <MapPin className="w-3.5 h-3.5" /> {suburbName ? `${suburbName} · scan first` : "Brisbane · scan first"}
          </div>

          {inviteFrom && (
            <p className="max-w-xl mb-5 text-[15px] font-semibold text-violet-900 bg-violet-50/90 border border-violet-200 rounded-2xl px-4 py-3">
              {inviteFrom.name} invited you{suburbName ? ` to scan in ${suburbName}` : ""}. Join and scan — suburb volume unlocks a driver trip.
            </p>
          )}

          <h1 className="text-[40px] sm:text-[60px] max-w-2xl leading-[0.98] font-display font-extrabold text-slate-950 mb-6">
            Scan, sort, skip the depot.
          </h1>
          <p className="text-slate-700 text-[17px] sm:text-[19px] leading-relaxed mb-4 max-w-xl">
            Scan a can, earn 5¢. We collect from your kerb — you never drive to a depot.
          </p>
          {launchBonusHeadline(growth?.launchBonusContainers) && (
            <p className="inline-block rounded-full bg-violet-100 text-violet-900 text-[13px] font-semibold px-4 py-2 mb-6">
              {launchBonusHeadline(growth?.launchBonusContainers)}
            </p>
          )}
          <p className="text-slate-500 text-[13px] mb-8 max-w-xl">
            A 5¢ sorting credit, not the 10¢ scheme refund. <a href="/terms" className="underline text-violet-800">How it works</a>.
          </p>

          <div className="w-full max-w-xs">
            <GreenButton onClick={() => { track("waitlist_cta", { suburb: place }); router.push("/scan"); }}>
              Scan a container <ChevronRight className="w-5 h-5 inline ml-1" />
            </GreenButton>
            <button onClick={() => {
              track("waitlist_cta", { suburb: place });
              if (hasValidToken()) { void waitlistContinuePath().then((path) => router.push(path)); return; }
              setShowAuth(true);
            }} className="block mt-3 text-green-700 text-[13px] font-semibold hover:text-green-800 transition-colors">
              Already have an account? Sign in
            </button>
          </div>

          {place && (
            <div className="mt-10 max-w-md bg-white/85 border border-violet-200 rounded-2xl px-4 py-3">
              <p className="text-[12px] text-slate-500 uppercase tracking-wider mb-1">{place}</p>
              <p className="text-[15px] font-semibold text-slate-900">
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

          <div className="mt-10 text-slate-500 animate-bounce lg:hidden">
            <ArrowDown className="w-5 h-5 mx-auto" />
          </div>
          </div>
          <div className="hidden lg:block pt-8">
            <SortAnimation />
            <p className="text-center text-[12px] text-slate-500 mt-3">Scan → sort into bags → bag out for a volume run.</p>
          </div>
        </div>
      </section>

      {!suburbName && (
        <section className="px-6 py-10 max-w-lg mx-auto">
          <h2 className="text-center text-[12px] text-slate-400 font-semibold uppercase tracking-[0.15em] mb-4">Your suburb</h2>
          <SuburbFinder />
          <div className="mt-8"><DensityBoard /></div>
        </section>
      )}

      <section className="px-6 py-12 bg-slate-900 text-white">
        <div className="max-w-lg mx-auto text-center">
          <p className="text-slate-400 text-[12px] uppercase tracking-[0.15em] mb-5">The leak</p>
          <h2 className="text-[24px] sm:text-[28px] font-display font-extrabold leading-tight mb-4">
            The depot trip is where<br /><span className="text-green-400">the 10¢ goes unclaimed</span>
          </h2>
          <p className="text-slate-400 text-[14px] leading-relaxed max-w-sm mx-auto mb-8">
            About a third of eligible containers in Queensland never reach a refund point. People are recycling. They are not driving to a depot for 10¢ a bottle.
          </p>
          <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
            <MiniStat value="10¢" label="scheme refund" />
            <MiniStat value="5¢" label="your credit" />
            <MiniStat value="scan" label="the habit" />
          </div>
        </div>
      </section>

      <section id="how-it-works" className="px-6 py-14 max-w-lg mx-auto">
        <h2 className="text-center text-[12px] text-slate-400 font-semibold uppercase tracking-[0.15em] mb-3">How it works</h2>
        <div className="mb-10"><SortAnimation /></div>

        <div className="relative">
          <div className="absolute left-[23px] top-6 bottom-6 w-[2px] bg-slate-200 rounded-full" />
          <div className="space-y-10">
            <StepRow icon={<Home className="w-5 h-5" />} color="from-violet-400 to-violet-600" num={1}
              title="Scan a container"
              body="Point your camera at a can or bottle. 5¢ pending, straight away."
              tag="Scan first" tagColor="bg-violet-100 text-violet-700" />
            <StepRow icon={<Recycle className="w-5 h-5" />} color="from-blue-400 to-blue-600" num={2}
              title="Sort into your bags"
              body="Four streams at home: cans, PET, glass, other."
              tag="Your bags, your sort" tagColor="bg-blue-100 text-blue-700" />
            <StepRow icon={<Truck className="w-5 h-5" />} color="from-amber-400 to-amber-600" num={3}
              title="Suburb volume run"
              body={`At about ${LIVE_VOLUME_THRESHOLD} containers in your suburb, we drive. Bag out; we do the depot run.`}
              tag="One driver trip" tagColor="bg-amber-100 text-amber-700" />
            <StepRow icon={<Banknote className="w-5 h-5" />} color="from-emerald-400 to-emerald-600" num={4}
              title="Get paid after the depot"
              body="Credits clear after the depot verifies. Bank transfer from $20 once payouts are live."
              tag="5¢ sorting credit" tagColor="bg-emerald-100 text-emerald-700" />
          </div>
        </div>
      </section>

      <section className="px-6 py-10">
        <div className="max-w-lg mx-auto flex flex-wrap justify-center gap-6">
          <TrustItem icon={<MapPin className="w-4 h-4" />} text="Scan today in Brisbane" />
          <TrustItem icon={<Check className="w-4 h-4" />} text="Volume run when ready" />
          <TrustItem icon={<Check className="w-4 h-4" />} text="Credits clear after depot verify" />
        </div>
      </section>

      <section className="px-6 py-14 text-center">
        <div className="max-w-sm mx-auto">
          <h2 className="text-[28px] font-display font-extrabold text-slate-900 mb-3 leading-tight">
            Start scanning in your suburb
          </h2>
          <p className="text-slate-400 text-[14px] mb-8">
            About {LIVE_VOLUME_THRESHOLD} containers in your suburb and we drive.
          </p>
          <GreenButton onClick={() => { track("waitlist_cta", { suburb: place }); router.push("/scan"); }}>
            Scan a container <ChevronRight className="w-5 h-5 inline ml-1" />
          </GreenButton>
        </div>
      </section>

      <footer className="px-6 py-8 text-center border-t border-slate-100">
        <div className="flex justify-center mb-3"><Logo size="sm" /></div>
        <p className="text-[11px] text-slate-400">
          Not a live city-wide pickup. Sorting credits are a private reward, not the 10¢ Containers for Change refund. We are not claiming approval as a Containers for Change refund point.
        </p>
        <div className="flex justify-center gap-4 mt-2">
          <a href="/brisbane" className="text-[11px] text-slate-400 hover:text-slate-600 transition-colors">Brisbane suburbs</a>
          <a href="/terms" className="text-[11px] text-slate-400 hover:text-slate-600 transition-colors">Terms</a>
          <a href="/privacy" className="text-[11px] text-slate-400 hover:text-slate-600 transition-colors">Privacy</a>
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
