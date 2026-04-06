"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScanBarcode } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/send-otp", {
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

      sessionStorage.setItem("goodsort_verify_email", email.trim());
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
            <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
              required
              autoFocus
            />
          </div>

          {error && <p className="text-red-500 text-[13px]">{error}</p>}

          <button
            type="submit"
            disabled={loading || !email.includes("@")}
            className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 min-h-[48px]"
          >
            {loading ? "Sending code..." : "Continue"}
          </button>
        </form>

        <p className="text-center text-[12px] text-slate-400 mt-6">We'll send a verification code to your email</p>
      </div>
    </div>
  );
}
