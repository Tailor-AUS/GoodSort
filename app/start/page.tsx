"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ChevronRight, Scan, Recycle, Banknote, Truck, ArrowDown } from "lucide-react";
import { apiUrl } from "@/lib/config";
import { Logo } from "@/app/components/shared/logo";

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
                <p className="text-slate-400 text-[13px]">Enter your email — we'll send a code</p>
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
      <section className="relative px-6 pt-12 pb-16 text-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-green-50/80 to-white" />
        <div className="relative z-10 max-w-lg mx-auto">
          <div className="flex justify-center mb-6"><Logo size="lg" /></div>
          <h1 className="text-[32px] leading-[1.1] font-display font-extrabold text-slate-900 mb-4">
            Earn money from<br />your recycling
          </h1>
          <p className="text-slate-500 text-[15px] leading-relaxed mb-2">
            Scan your cans and bottles. We pick them up<br className="hidden sm:block" /> from your yellow bin. You earn <strong className="text-green-600">5¢ per container</strong>.
          </p>
          <p className="text-slate-400 text-[13px] mb-8">Brisbane · Containers for Change · Cash to your bank</p>
          <GreenButton onClick={() => setShowAuth(true)}>
            Get Started <ChevronRight className="w-5 h-5 inline ml-1" />
          </GreenButton>
          <button onClick={() => setShowAuth(true)} className="block mx-auto mt-3 text-green-600 text-[13px] font-semibold">
            Already have an account? Sign in
          </button>
          <div className="mt-10 text-slate-300 animate-bounce">
            <ArrowDown className="w-5 h-5 mx-auto" />
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="px-6 py-12 max-w-lg mx-auto">
        <h2 className="text-center text-[12px] text-slate-400 font-semibold uppercase tracking-[0.15em] mb-8">How it works</h2>
        <div className="space-y-8">
          <StepRow icon={<Scan className="w-6 h-6" />} color="bg-green-500" num={1}
            title="Scan your containers"
            body="Take a photo or scan the barcode. Our AI identifies each container and confirms it's eligible for the 10¢ refund." />
          <StepRow icon={<Recycle className="w-6 h-6" />} color="bg-blue-500" num={2}
            title="Sort into your yellow bin"
            body="The app tells you which compartment — Blue, Teal, Amber, or Green. Your balance updates instantly." />
          <StepRow icon={<Truck className="w-6 h-6" />} color="bg-amber-500" num={3}
            title="We pick up on bin day"
            body="A Runner collects your sorted containers from the kerb and delivers them to an approved Containers for Change depot." />
          <StepRow icon={<Banknote className="w-6 h-6" />} color="bg-emerald-600" num={4}
            title="Cash out to your bank"
            body="Your balance clears once containers hit the depot. Cash out via bank transfer once you reach $20." />
        </div>
      </section>

      {/* ── Value props ── */}
      <section className="px-6 py-12 bg-slate-50">
        <div className="max-w-lg mx-auto grid grid-cols-2 gap-4">
          <ValueCard emoji="🏠" title="Zero effort" body="No driving to depots. No queuing. Just scan, sort, put your bin out." />
          <ValueCard emoji="💰" title="5¢ per container" body="Every can, bottle, and carton earns you credits. It adds up fast." />
          <ValueCard emoji="🤖" title="AI-powered" body="Our vision AI identifies containers instantly. No manual counting." />
          <ValueCard emoji="🏦" title="Bank transfer" body="Cash out direct to your bank account. Weekly batch payments." />
        </div>
      </section>

      {/* ── The numbers ── */}
      <section className="px-6 py-12 max-w-lg mx-auto text-center">
        <h2 className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.15em] mb-6">Every container tracked</h2>
        <div className="flex items-center justify-center gap-2 flex-wrap mb-6">
          <ChainNode color="bg-green-500">You scan</ChainNode>
          <span className="text-green-400 font-bold">→</span>
          <ChainNode color="bg-blue-500">AI verifies</ChainNode>
          <span className="text-green-400 font-bold">→</span>
          <ChainNode color="bg-amber-500">Runner counts</ChainNode>
          <span className="text-green-400 font-bold">→</span>
          <ChainNode color="bg-purple-500">Depot confirms</ChainNode>
        </div>
        <p className="text-slate-500 text-[13px] leading-relaxed">
          Three checkpoints. Each handoff is reconciled.<br />You earn on what physically arrives.
        </p>
      </section>

      {/* ── CTA ── */}
      <section className="px-6 py-12 bg-gradient-to-b from-green-50/50 to-white">
        <div className="max-w-sm mx-auto text-center">
          <h2 className="text-2xl font-display font-extrabold text-slate-900 mb-2">Ready to start earning?</h2>
          <p className="text-slate-400 text-[13px] mb-6">Takes 30 seconds. Just your email.</p>
          <GreenButton onClick={() => setShowAuth(true)}>
            Get Started <ChevronRight className="w-5 h-5 inline ml-1" />
          </GreenButton>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="px-6 py-8 text-center border-t border-slate-100">
        <p className="text-[11px] text-slate-400">
          Queensland Container Refund Scheme · Containers for Change
        </p>
        <div className="flex justify-center gap-4 mt-2">
          <a href="/terms" className="text-[11px] text-slate-400 hover:text-slate-600">Terms</a>
          <a href="/privacy" className="text-[11px] text-slate-400 hover:text-slate-600">Privacy</a>
        </div>
      </footer>

    </div>
  );
}

function StepRow({ icon, color, num, title, body }: { icon: React.ReactNode; color: string; num: number; title: string; body: string }) {
  return (
    <div className="flex gap-4 items-start">
      <div className="relative flex-shrink-0">
        <div className={`w-12 h-12 ${color} rounded-2xl flex items-center justify-center text-white shadow-lg`}>
          {icon}
        </div>
        <span className="absolute -top-1.5 -left-1.5 w-5 h-5 bg-slate-900 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{num}</span>
      </div>
      <div>
        <h3 className="text-[15px] font-bold text-slate-900 mb-1">{title}</h3>
        <p className="text-[13px] text-slate-500 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function ValueCard({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-200">
      <span className="text-2xl">{emoji}</span>
      <h3 className="text-[14px] font-bold text-slate-900 mt-2 mb-1">{title}</h3>
      <p className="text-[12px] text-slate-500 leading-relaxed">{body}</p>
    </div>
  );
}

function ChainNode({ color, children }: { color: string; children: React.ReactNode }) {
  return <span className={`${color} text-white text-[11px] font-semibold px-3 py-1.5 rounded-lg`}>{children}</span>;
}

function GreenButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 transition-all min-h-[48px] flex items-center justify-center">
      {children}
    </button>
  );
}
