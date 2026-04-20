"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ChevronRight, Scan, Recycle, Banknote, Truck, ArrowDown, Check, MapPin, Shield } from "lucide-react";
import { apiUrl } from "@/lib/config";
import { Logo } from "@/app/components/shared/logo";
import { SortAnimation } from "@/app/components/shared/sort-animation";

export default function StartPage() {
  const router = useRouter();
  const [showAuth, setShowAuth] = useState(false);
  const [step, setStep] = useState<"email" | "verify">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("goodsort_token");
    if (token) router.push("/");
  }, [router]);

  async function sendOtp() {
    if (!email.includes("@")) return;
    setLoading(true); setError("");
    try {
      const res = await fetch(apiUrl("/api/auth/send-otp"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) { setError("Failed to send code"); setLoading(false); return; }
      setStep("verify");
    } catch { setError("Something went wrong"); }
    setLoading(false);
  }

  async function verifyOtp() {
    if (otp.length < 6) return;
    setLoading(true); setError("");
    try {
      const referrerId = (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("r") : null) || undefined;
      const res = await fetch(apiUrl("/api/auth/verify-otp"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: otp, referrerId }),
      });
      if (!res.ok) { setError("Invalid code"); setLoading(false); return; }
      const data = await res.json();
      localStorage.setItem("goodsort_token", data.token);
      localStorage.setItem("goodsort_profile", JSON.stringify(data.profile));
      document.cookie = `goodsort_token=${data.token}; path=/; max-age=${30*24*60*60}; SameSite=Lax; Secure`;
      router.push(data.profile.householdId ? "/" : "/onboard");
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
                <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-2">Get started</h1>
                <p className="text-slate-400 text-[13px]">Enter your email — we&apos;ll send a code</p>
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
                <p className="text-slate-400 text-[13px]">Code sent to {email}</p>
              </div>
              <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="000000"
                className="w-full text-center text-3xl font-display font-extrabold tracking-[0.3em] border border-slate-200 rounded-xl px-4 py-4 text-slate-900 placeholder-slate-200 focus:outline-none focus:ring-2 focus:ring-green-500/30 mb-3" autoFocus />
              {error && <p className="text-red-500 text-[12px] mb-2 text-center">{error}</p>}
              <GreenButton onClick={verifyOtp} disabled={loading || otp.length < 6}>
                {loading ? "Verifying..." : "Verify"}
              </GreenButton>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white overflow-y-auto overscroll-none" style={{ paddingTop: "env(safe-area-inset-top,0)" }}>

      {/* ── Hero ── */}
      <section className="relative px-6 pt-14 pb-20 text-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-green-50 via-green-50/40 to-white" />
        {/* Floating container icons */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none select-none opacity-[0.07]">
          <span className="absolute text-[80px] top-[10%] left-[5%] animate-float-slow">🥫</span>
          <span className="absolute text-[60px] top-[15%] right-[8%] animate-float-med">🍺</span>
          <span className="absolute text-[70px] top-[55%] left-[10%] animate-float-med">🧃</span>
          <span className="absolute text-[50px] top-[60%] right-[12%] animate-float-slow">🍷</span>
          <span className="absolute text-[90px] top-[35%] left-[50%] -translate-x-1/2 animate-float-fast">♻️</span>
        </div>

        <div className="relative z-10 max-w-lg mx-auto">
          <div className="flex justify-center mb-8"><Logo size="lg" /></div>

          <div className="inline-flex items-center gap-2 bg-green-100 text-green-700 text-[12px] font-semibold px-3.5 py-1.5 rounded-full mb-6">
            <MapPin className="w-3.5 h-3.5" /> Now in Brisbane
          </div>

          <h1 className="text-[36px] sm:text-[42px] leading-[1.05] font-display font-extrabold text-slate-900 mb-5">
            Your recyclables<br />are worth money
          </h1>
          <p className="text-slate-500 text-[16px] leading-relaxed mb-2 max-w-xs mx-auto">
            Scan your cans and bottles. We pick them up from your yellow bin. You earn <strong className="text-green-600 font-bold">5¢ per container</strong>.
          </p>
          <p className="text-slate-400 text-[13px] mb-6">Containers for Change · cash to your bank</p>

          <div className="mb-8 rounded-2xl overflow-hidden border border-green-200/60 shadow-sm bg-white">
            <SortAnimation />
          </div>

          <div className="max-w-xs mx-auto">
            <GreenButton onClick={() => setShowAuth(true)}>
              Get Started <ChevronRight className="w-5 h-5 inline ml-1" />
            </GreenButton>
            <button onClick={() => setShowAuth(true)} className="block mx-auto mt-3 text-green-600 text-[13px] font-semibold hover:text-green-700 transition-colors">
              Already have an account? Sign in
            </button>
          </div>

          <div className="mt-12 text-slate-300 animate-bounce">
            <ArrowDown className="w-5 h-5 mx-auto" />
          </div>
        </div>
      </section>

      {/* ── The problem ── */}
      <section className="px-6 py-12 bg-slate-900 text-white">
        <div className="max-w-lg mx-auto text-center">
          <p className="text-slate-400 text-[12px] uppercase tracking-[0.15em] mb-5">Right now</p>
          <h2 className="text-[24px] sm:text-[28px] font-display font-extrabold leading-tight mb-4">
            Every can you bin is<br /><span className="text-green-400">10¢ you&apos;re throwing away</span>
          </h2>
          <p className="text-slate-400 text-[14px] leading-relaxed max-w-xs mx-auto mb-8">
            Queensland&apos;s Container Refund Scheme pays 10¢ for every eligible container. Most people never claim it because the depot is a 40-minute round trip.
          </p>
          <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
            <MiniStat value="10¢" label="per container" />
            <MiniStat value="~50" label="per fortnight" />
            <MiniStat value="0 min" label="effort with us" />
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="px-6 py-14 max-w-lg mx-auto">
        <h2 className="text-center text-[12px] text-slate-400 font-semibold uppercase tracking-[0.15em] mb-3">How it works</h2>
        <p className="text-center text-slate-500 text-[14px] mb-10">Four steps. Zero trips to the depot.</p>

        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[23px] top-6 bottom-6 w-[2px] bg-gradient-to-b from-green-400 via-blue-400 via-amber-400 to-emerald-400 rounded-full" />

          <div className="space-y-10">
            <StepRow icon={<Scan className="w-5 h-5" />} color="from-green-400 to-green-600" num={1}
              title="Scan your containers"
              body="Take a photo or scan the barcode. Our AI identifies each container, confirms CDS eligibility, and tells you which compartment."
              tag="5¢ pending instantly" tagColor="bg-green-100 text-green-700" />
            <StepRow icon={<Recycle className="w-5 h-5" />} color="from-blue-400 to-blue-600" num={2}
              title="Sort into your yellow bin"
              body="Four compartments — Blue (aluminium), Teal (plastic), Amber (glass), Green (other). The app tells you where each container goes."
              tag="No guesswork" tagColor="bg-blue-100 text-blue-700" />
            <StepRow icon={<Truck className="w-5 h-5" />} color="from-amber-400 to-amber-600" num={3}
              title="We pick up on bin day"
              body="A local Runner collects your sorted containers from the kerb on your council collection day and delivers them to an approved depot."
              tag="You do nothing" tagColor="bg-amber-100 text-amber-700" />
            <StepRow icon={<Banknote className="w-5 h-5" />} color="from-emerald-400 to-emerald-600" num={4}
              title="Cash out to your bank"
              body="Your balance clears once containers hit the depot. Cash out via bank transfer when you reach $20. Weekly payments."
              tag="Direct to your bank" tagColor="bg-emerald-100 text-emerald-700" />
          </div>
        </div>
      </section>

      {/* ── Value props ── */}
      <section className="px-6 py-12 bg-gradient-to-b from-slate-50 to-white">
        <div className="max-w-lg mx-auto">
          <h2 className="text-center text-[12px] text-slate-400 font-semibold uppercase tracking-[0.15em] mb-8">Why Good Sort</h2>
          <div className="grid grid-cols-2 gap-3">
            <ValueCard icon={<span className="text-2xl">🏠</span>} title="Zero effort" body="No driving to depots. No queuing. Just put your bin out." />
            <ValueCard icon={<span className="text-2xl">💰</span>} title="5¢ per container" body="Every can, bottle, and carton earns you credits." />
            <ValueCard icon={<span className="text-2xl">🤖</span>} title="AI-powered" body="Our vision AI identifies containers and checks eligibility instantly." />
            <ValueCard icon={<span className="text-2xl">🏦</span>} title="Bank transfer" body="Cash out direct to your Aussie bank account." />
          </div>
        </div>
      </section>

      {/* ── Accountability chain ── */}
      <section className="px-6 py-14 max-w-lg mx-auto text-center">
        <h2 className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.15em] mb-3">Every container tracked</h2>
        <p className="text-slate-500 text-[14px] mb-8">Three digital checkpoints. Each handoff is reconciled.</p>

        <div className="inline-flex flex-col gap-3 items-center">
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <ChainNode color="bg-green-500" icon="📸">You scan</ChainNode>
            <ChainArrow />
            <ChainNode color="bg-blue-500" icon="🤖">AI verifies</ChainNode>
          </div>
          <ChainArrow vertical />
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <ChainNode color="bg-amber-500" icon="🚗">Runner counts</ChainNode>
            <ChainArrow />
            <ChainNode color="bg-purple-500" icon="✅">Depot confirms</ChainNode>
          </div>
        </div>

        <p className="text-slate-400 text-[13px] mt-8 leading-relaxed max-w-xs mx-auto">
          You earn on what physically arrives at the depot — no guesswork, no scales, no trucks.
        </p>
      </section>

      {/* ── Trust ── */}
      <section className="px-6 py-10 bg-slate-50">
        <div className="max-w-lg mx-auto flex flex-wrap justify-center gap-6">
          <TrustItem icon={<Shield className="w-4 h-4" />} text="Containers for Change approved" />
          <TrustItem icon={<MapPin className="w-4 h-4" />} text="Brisbane-based" />
          <TrustItem icon={<Check className="w-4 h-4" />} text="Australian AI" />
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="px-6 py-14 text-center">
        <div className="max-w-sm mx-auto">
          <h2 className="text-[28px] font-display font-extrabold text-slate-900 mb-3 leading-tight">
            Stop throwing<br />money in the bin
          </h2>
          <p className="text-slate-400 text-[14px] mb-8">Takes 30 seconds. Just your email.</p>
          <GreenButton onClick={() => setShowAuth(true)}>
            Get Started — it&apos;s free <ChevronRight className="w-5 h-5 inline ml-1" />
          </GreenButton>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="px-6 py-8 text-center border-t border-slate-100">
        <div className="flex justify-center mb-3"><Logo size="sm" /></div>
        <p className="text-[11px] text-slate-400">
          Queensland Container Refund Scheme · Containers for Change
        </p>
        <div className="flex justify-center gap-4 mt-2">
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
        <div className={`w-12 h-12 bg-gradient-to-br ${color} rounded-2xl flex items-center justify-center text-white shadow-lg`}>
          {icon}
        </div>
        <span className="absolute -top-1.5 -left-1.5 w-5 h-5 bg-slate-900 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow">{num}</span>
      </div>
      <div className="pt-0.5">
        <h3 className="text-[15px] font-bold text-slate-900 mb-1">{title}</h3>
        <p className="text-[13px] text-slate-500 leading-relaxed mb-2">{body}</p>
        <span className={`inline-block text-[11px] font-semibold px-2.5 py-1 rounded-full ${tagColor}`}>{tag}</span>
      </div>
    </div>
  );
}

function ValueCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-200 hover:border-green-200 hover:shadow-sm transition-all">
      {icon}
      <h3 className="text-[14px] font-bold text-slate-900 mt-2.5 mb-1">{title}</h3>
      <p className="text-[12px] text-slate-500 leading-relaxed">{body}</p>
    </div>
  );
}

function ChainNode({ color, icon, children }: { color: string; icon: string; children: React.ReactNode }) {
  return (
    <span className={`${color} text-white text-[12px] font-semibold px-3.5 py-2 rounded-xl inline-flex items-center gap-1.5 shadow-sm`}>
      <span className="text-[14px]">{icon}</span> {children}
    </span>
  );
}

function ChainArrow({ vertical }: { vertical?: boolean }) {
  return <span className={`text-green-300 font-bold text-lg ${vertical ? "rotate-90" : ""}`}>→</span>;
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
      className="w-full bg-gradient-to-b from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-extrabold py-4 rounded-2xl text-[16px] shadow-lg shadow-green-600/25 disabled:opacity-50 transition-all min-h-[52px] flex items-center justify-center active:scale-[0.98]">
      {children}
    </button>
  );
}
