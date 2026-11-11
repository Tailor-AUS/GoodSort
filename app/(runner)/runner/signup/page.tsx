"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Car, Mail, ShieldCheck } from "lucide-react";
import { apiUrl, authHeaders, hasValidToken, persistWaitlistFromUrl, readReferrerId } from "@/lib/config";
import { track } from "@/lib/analytics";

type Step = "vehicle" | "auth" | "verify";

export default function RunnerSignupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("vehicle");
  const [signedIn, setSignedIn] = useState(false);
  const [vehicleType, setVehicleType] = useState("car");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleRego, setVehicleRego] = useState("");
  const [capacityBags, setCapacityBags] = useState(10);
  const [serviceRadiusKm, setServiceRadiusKm] = useState(10);
  const [coexSchemeId, setCoexSchemeId] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [devCode, setDevCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    persistWaitlistFromUrl();
    setSignedIn(hasValidToken());
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function submitRunnerRegistration(tokenOverride?: string, profileIdOverride?: string) {
    setError("");
    setLoading(true);
    try {
      const storedProfile = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
      const profileId = profileIdOverride || storedProfile.id;
      const headers = tokenOverride
        ? { "Content-Type": "application/json", Authorization: `Bearer ${tokenOverride}` }
        : authHeaders();
      const res = await fetch(apiUrl("/api/runner/register"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          profileId,
          vehicleType,
          vehicleMake: vehicleMake.trim() || undefined,
          vehicleRego: vehicleRego.trim() || undefined,
          capacityBags,
          serviceRadiusKm,
          coexSchemeId: coexSchemeId.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        setError(typeof data.error === "string" && data.error ? data.error : "Registration failed.");
        setLoading(false);
        return;
      }
      localStorage.setItem(
        "goodsort_profile",
        JSON.stringify({
          ...storedProfile,
          ...(profileId ? { id: profileId } : {}),
          role: "both",
        }),
      );
      router.push("/runner");
    } catch {
      setError("Something went wrong.");
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!hasValidToken()) {
      setStep("auth");
      return;
    }
    await submitRunnerRegistration();
  }

  async function sendOtp(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!email.includes("@")) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/api/auth/send-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({} as { error?: string; devCode?: string }));
      if (!res.ok) {
        setError(typeof data.error === "string" && data.error ? data.error : "Couldn't send code");
        setLoading(false);
        return;
      }
      if (typeof data.devCode === "string" && data.devCode.length === 6) {
        setDevCode(data.devCode);
        setOtp(data.devCode);
      } else {
        setDevCode("");
      }
      track("otp_sent");
      setResendIn(30);
      setStep("verify");
    } catch {
      setError("Something went wrong");
    }
    setLoading(false);
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (otp.length < 6) return;
    setLoading(true);
    setError("");
    try {
      const referrerId = readReferrerId();
      const res = await fetch(apiUrl("/api/auth/verify-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: otp, referrerId }),
      });
      const data = await res.json().catch(() => ({} as { error?: string; token?: string; profile?: { id?: string } }));
      if (!res.ok || !data.token || !data.profile) {
        setError(typeof data.error === "string" && data.error ? data.error : "Verification failed. Please try again.");
        setLoading(false);
        return;
      }
      localStorage.setItem("goodsort_token", data.token);
      localStorage.setItem("goodsort_profile", JSON.stringify(data.profile));
      document.cookie = `goodsort_token=${data.token}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Lax; Secure`;
      setSignedIn(true);
      track("otp_verified");
      await submitRunnerRegistration(data.token, data.profile.id);
    } catch {
      setError("Verification failed");
      setLoading(false);
    }
  }

  if (step === "auth") {
    return (
      <div className="min-h-dvh bg-white flex flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Mail className="w-8 h-8 text-green-600" />
            </div>
            <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-1">Verify your driver email</h1>
            <p className="text-slate-500 text-[13px]">
              Enter your email to activate your Runner profile ({vehicleType.toUpperCase()} · up to {capacityBags} bags).
            </p>
          </div>
          <form onSubmit={sendOtp} className="space-y-3">
            <input
              id="runner-auth-email"
              aria-label="Driver email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="driver@email.com"
              autoComplete="email"
              autoFocus
              className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
            />
            {error && <p className="text-red-500 text-[13px]">{error}</p>}
            <button
              type="submit"
              disabled={loading || !email.includes("@")}
              className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 min-h-[48px]"
            >
              {loading ? "Sending code..." : "Send verification code"}
            </button>
          </form>
          <button
            type="button"
            onClick={() => { setStep("vehicle"); setError(""); }}
            className="w-full text-slate-400 hover:text-slate-600 text-[13px] font-medium mt-4 py-2"
          >
            Back to vehicle details
          </button>
        </div>
      </div>
    );
  }

  if (step === "verify") {
    return (
      <div className="min-h-dvh bg-white flex flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <ShieldCheck className="w-8 h-8 text-green-600" />
            </div>
            <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-1">Check your email</h1>
            <p className="text-slate-500 text-[13px]">
              Code sent to {email}. Check spam too — expires in 15 minutes.
            </p>
            {devCode && (
              <p className="text-[12px] text-violet-700 mt-2">
                Local code {devCode} — ACS email is not configured on this machine.
              </p>
            )}
          </div>
          <form onSubmit={verifyOtp} className="space-y-3">
            <input
              id="runner-auth-otp"
              aria-label="6-digit verification code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              autoFocus
              className="w-full text-center text-3xl font-display font-extrabold tracking-[0.3em] border border-slate-200 rounded-xl px-4 py-4 text-slate-900 placeholder-slate-200 focus:outline-none focus:ring-2 focus:ring-green-500/30"
            />
            {error && <p className="text-red-500 text-[13px] text-center">{error}</p>}
            <button
              type="submit"
              disabled={loading || otp.length < 6}
              className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 min-h-[48px]"
            >
              {loading ? "Finishing registration..." : "Verify & register as Runner"}
            </button>
          </form>
          <div className="flex items-center justify-between mt-4 text-[13px]">
            <button
              type="button"
              onClick={() => void sendOtp()}
              disabled={loading || resendIn > 0}
              className="text-green-700 font-semibold py-2 disabled:text-slate-300"
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
            </button>
            <button
              type="button"
              onClick={() => { setStep("auth"); setOtp(""); setError(""); setDevCode(""); }}
              className="text-slate-400 hover:text-slate-600 py-2"
            >
              Use a different email
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white">
      <div className="max-w-sm mx-auto px-6 py-8">
        <Link href={signedIn ? "/sort" : "/marketplace"} className="inline-flex items-center gap-1 text-[13px] text-slate-500 mb-6">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>

        <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mb-4">
          <Car className="w-8 h-8 text-green-600" />
        </div>
        <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-1">Become a Runner</h1>
        <p className="text-[13px] text-slate-500 mb-6">Collect sorted bags from the kerb on suburb volume runs. Deliver to a refund point or depot we nominate. Paid on the runner count — separate from the household 10¢ sorting credit.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="runner-vehicle-type" className="block text-[13px] font-semibold text-slate-700 mb-1.5">Vehicle type</label>
            <select id="runner-vehicle-type" value={vehicleType} onChange={e => setVehicleType(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500">
              <option value="car">Car</option>
              <option value="ute">Ute / Van</option>
              <option value="bike">Bike / Cargo bike</option>
              <option value="walk">On foot</option>
            </select>
          </div>
          <div>
            <label htmlFor="runner-vehicle-make" className="block text-[13px] font-semibold text-slate-700 mb-1.5">Make / model</label>
            <input id="runner-vehicle-make" type="text" value={vehicleMake} onChange={e => setVehicleMake(e.target.value)} placeholder="e.g. Toyota Corolla"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500" />
          </div>
          <div>
            <label htmlFor="runner-vehicle-rego" className="block text-[13px] font-semibold text-slate-700 mb-1.5">Registration</label>
            <input id="runner-vehicle-rego" type="text" value={vehicleRego} onChange={e => setVehicleRego(e.target.value.toUpperCase())} placeholder="e.g. 123ABC"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="runner-capacity-bags" className="block text-[13px] font-semibold text-slate-700 mb-1.5">Bag capacity</label>
              <input id="runner-capacity-bags" type="number" min={1} max={100} value={capacityBags} onChange={e => setCapacityBags(Math.min(100, Math.max(1, Math.round(Number(e.target.value) || 1))))}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500" />
            </div>
            <div>
              <label htmlFor="runner-service-radius" className="block text-[13px] font-semibold text-slate-700 mb-1.5">Range (km)</label>
              <input id="runner-service-radius" type="number" min={1} max={200} value={serviceRadiusKm} onChange={e => setServiceRadiusKm(Math.min(200, Math.max(1, Number(e.target.value) || 1)))}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500" />
            </div>
          </div>
          <div>
            <label htmlFor="runner-scheme-id" className="block text-[13px] font-semibold text-slate-700 mb-1.5">Containers for Change Scheme ID (optional)</label>
            <input id="runner-scheme-id" type="text" value={coexSchemeId} onChange={e => setCoexSchemeId(e.target.value.toUpperCase())} placeholder="e.g. C101234567"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base text-slate-900 placeholder-slate-300 font-mono focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500" />
          </div>
          {error && <p className="text-red-500 text-[13px]">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 min-h-[48px]">
            {loading ? "Registering..." : signedIn ? "Register as Runner" : "Continue & verify email"}
          </button>
          <p className="text-[11px] text-slate-400 text-center">
            By registering you agree to collect sorted containers from the kerb and drop them at a depot or refund point we nominate.
          </p>
        </form>
      </div>
    </div>
  );
}
