"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScanBarcode } from "lucide-react";

export default function LoginPage() {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    let formatted = phone.trim().replace(/\s/g, "");
    if (formatted.startsWith("0")) formatted = "+61" + formatted.slice(1);
    else if (!formatted.startsWith("+")) formatted = "+61" + formatted;

    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: formatted }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to send code");
        setLoading(false);
        return;
      }

      sessionStorage.setItem("goodsort_verify_phone", formatted);
      router.push("/verify");
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="h-dvh bg-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-green-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-green-600/20">
            <ScanBarcode className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-display font-extrabold text-slate-900">The Good Sort</h1>
          <p className="text-slate-400 text-[13px] mt-1">Scan. Sort. Earn 10c per container.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Phone number</label>
            <div className="flex gap-2">
              <span className="flex items-center px-3 bg-slate-100 border border-slate-200 rounded-xl text-[14px] text-slate-500 font-medium">+61</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="412 345 678"
                className="flex-1 border border-slate-200 rounded-xl px-4 py-3 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
                required
                autoFocus
              />
            </div>
          </div>

          {error && <p className="text-red-500 text-[13px]">{error}</p>}

          <button
            type="submit"
            disabled={loading || !phone.trim()}
            className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 min-h-[48px]"
          >
            {loading ? "Sending code..." : "Continue"}
          </button>
        </form>

        <p className="text-center text-[12px] text-slate-400 mt-6">We'll send a verification code via SMS</p>
      </div>
    </div>
  );
}
