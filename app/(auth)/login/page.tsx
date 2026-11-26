"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { apiUrl, persistWaitlistFromUrl } from "@/lib/config";
import { track } from "@/lib/analytics";
import { Logo } from "@/app/components/shared/logo";
import { GlassBackdrop } from "@/app/components/shared/glass-backdrop";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => { persistWaitlistFromUrl(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(apiUrl("/api/auth/send-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to send code");
        setLoading(false);
        return;
      }

      const data = await res.json().catch(() => ({}));
      track("otp_sent");
      sessionStorage.setItem("goodsort_verify_email", email.trim());
      if (typeof data.devCode === "string") sessionStorage.setItem("goodsort_dev_otp", data.devCode);
      else sessionStorage.removeItem("goodsort_dev_otp");
      router.push("/verify");
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-dvh overflow-x-clip flex flex-col items-center justify-center px-5 py-8 overflow-y-auto text-white">
      <GlassBackdrop />
      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 min-h-[44px] rounded-full liquid-glass-pill px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-white/25"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
        </div>

        <div className="rounded-[28px] liquid-glass p-6">
          <div className="text-center mb-6">
            <div className="flex justify-center mb-3">
              <Logo size="lg" dark />
            </div>
            <p className="text-white/85 text-[13px] mt-1">Scan for 8¢. We’ll tell you when we collect.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-[13px] font-semibold text-white/90 mb-1.5">Email address</label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-white/95 border border-white/70 rounded-xl px-4 py-3 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 focus:border-emerald-400"
                onFocus={(e) => setTimeout(() => e.target.scrollIntoView({ behavior: "smooth", block: "center" }), 300)}
                required
                autoFocus
              />
            </div>

            {error && <p className="rounded-xl bg-red-500/20 border border-red-200/40 px-3 py-2 text-red-100 text-[13px]">{error}</p>}

            <button
              type="submit"
              disabled={loading || !email.includes("@")}
              className="w-full bg-gradient-to-b from-emerald-500 to-emerald-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-emerald-950/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 min-h-[48px]"
            >
              {loading ? "Sending code..." : "Continue"}
            </button>
          </form>

          <p className="text-center text-[12px] text-white/75 mt-5">We'll send a verification code to your email</p>
        </div>
      </div>
    </div>
  );
}
