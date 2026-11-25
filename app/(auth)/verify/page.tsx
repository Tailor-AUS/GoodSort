"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { apiUrl, persistWaitlistFromUrl, readReferrerId, waitlistContinuePath } from "@/lib/config";
import { track } from "@/lib/analytics";
import { GlassBackdrop } from "@/app/components/shared/glass-backdrop";
import { Logo } from "@/app/components/shared/logo";

export default function VerifyPage() {
  const [otp, setOtp] = useState("");
  const [devCode, setDevCode] = useState("");
  const [email, setEmail] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    persistWaitlistFromUrl();
    const stored = sessionStorage.getItem("goodsort_verify_email");
    if (!stored) { router.push("/login"); return; }
    setEmail(stored);
    const localCode = sessionStorage.getItem("goodsort_dev_otp");
    if (localCode && localCode.length === 6) {
      setDevCode(localCode);
      setOtp(localCode);
    }
  }, [router]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (otp.length < 6) return;
    setError("");
    setLoading(true);

    try {
      const referrerId = readReferrerId();
      const res = await fetch(apiUrl("/api/auth/verify-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: otp, referrerId }),
      });

      const data = await res.json().catch(() => ({} as { error?: string; token?: string; profile?: unknown }));
      if (!res.ok || !data.token || !data.profile) {
        setError(typeof data.error === "string" && data.error ? data.error : "Verification failed. Please try again.");
        setLoading(false);
        return;
      }

      localStorage.setItem("goodsort_token", data.token);
      localStorage.setItem("goodsort_profile", JSON.stringify(data.profile));
      sessionStorage.removeItem("goodsort_verify_email");
      track("otp_verified");

      router.push(await waitlistContinuePath());
    } catch {
      setError("Verification failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-dvh overflow-x-clip flex flex-col items-center justify-center px-5 py-8 text-white">
      <GlassBackdrop />
      <div className="relative z-10 w-full max-w-sm">
        <div className="flex justify-center mb-5">
          <Logo size="md" dark />
        </div>
        <div className="rounded-[28px] liquid-glass p-6">
          <div className="text-center mb-7">
            <div className="w-16 h-16 rounded-2xl bg-emerald-400/25 border border-emerald-200/50 flex items-center justify-center mx-auto mb-4 shadow-inner">
              <ShieldCheck className="w-8 h-8 text-emerald-100" />
            </div>
            <h1 className="text-2xl font-display font-extrabold text-white glass-text-shadow">Check your email</h1>
            <p className="text-white/80 text-[13px] mt-1.5 leading-relaxed">Code sent to {email}. The code is in the subject line — check spam too. It expires in 15 minutes.</p>
            {devCode && <p className="text-[12px] text-amber-100 bg-amber-500/25 border border-amber-200/40 rounded-xl px-3 py-1.5 mt-3">Local code {devCode} — ACS email is not configured on this machine.</p>}
          </div>

          <form onSubmit={handleVerify} className="space-y-4">
            <input
              type="text"
              aria-label="6-digit verification code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="w-full text-center text-3xl font-display font-extrabold tracking-[0.3em] bg-white/95 border border-white/70 rounded-xl px-4 py-4 text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 focus:border-emerald-400"
              autoFocus
            />

            {error && <p className="rounded-xl bg-red-500/20 border border-red-200/40 px-3 py-2 text-red-100 text-[13px] text-center">{error}</p>}

            <button
              type="submit"
              disabled={loading || otp.length < 6}
              className="w-full bg-gradient-to-b from-emerald-500 to-emerald-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-emerald-950/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 min-h-[48px]"
            >
              {loading ? "Verifying..." : "Verify"}
            </button>
          </form>

          <button
            type="button"
            disabled={loading || resendIn > 0}
            onClick={async () => {
              setLoading(true); setError("");
              try {
                const res = await fetch(apiUrl("/api/auth/send-otp"), {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email }),
                });
                const data = await res.json().catch(() => ({} as { error?: string; devCode?: string }));
                if (!res.ok) {
                  setError(typeof data.error === "string" && data.error ? data.error : "Couldn't resend. Try again shortly.");
                } else {
                  setResendIn(30);
                  if (typeof data.devCode === "string" && data.devCode.length === 6) {
                    setDevCode(data.devCode);
                    setOtp(data.devCode);
                  }
                }
              } catch {
                setError("Couldn't resend. Try again shortly.");
              }
              setLoading(false);
            }}
            className="w-full text-center text-[13px] text-emerald-200 hover:text-white disabled:text-white/40 font-semibold py-3 mt-2"
          >
            {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="w-full text-center text-[13px] text-white/75 hover:text-white font-medium py-2 transition-colors"
          >
            Use different email
          </button>
        </div>
      </div>
    </div>
  );
}
