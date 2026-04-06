"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";

export default function VerifyPage() {
  const [otp, setOtp] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    const stored = sessionStorage.getItem("goodsort_verify_phone");
    if (!stored) {
      router.push("/login");
      return;
    }
    setPhone(stored);
  }, [router]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (otp.length < 6) return;
    setError("");
    setLoading(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({
        phone,
        token: otp,
        type: "sms",
      });

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      sessionStorage.removeItem("goodsort_verify_phone");
      router.push("/onboard");
    } catch {
      setError("Verification failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="h-dvh bg-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-display font-extrabold text-slate-900">Enter code</h1>
          <p className="text-slate-400 text-[13px] mt-1">
            Sent to {phone ? phone.replace(/(\+61)(\d{3})(\d{3})(\d{3})/, "$1 $2 $3 $4") : "your phone"}
          </p>
        </div>

        <form onSubmit={handleVerify} className="space-y-4">
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            className="w-full text-center text-3xl font-display font-extrabold tracking-[0.3em] border border-slate-200 rounded-xl px-4 py-4 text-slate-900 placeholder-slate-200 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
            autoFocus
          />

          {error && (
            <p className="text-red-500 text-[13px] text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || otp.length < 6}
            className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 min-h-[48px]"
          >
            {loading ? "Verifying..." : "Verify"}
          </button>
        </form>

        <button
          onClick={() => router.push("/login")}
          className="w-full text-center text-[13px] text-slate-400 hover:text-slate-600 font-medium py-3 mt-2 transition-colors"
        >
          ← Use different number
        </button>
      </div>
    </div>
  );
}
