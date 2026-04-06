"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Home, User } from "lucide-react";

export default function OnboardPage() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleComplete() {
    if (!name || !address) return;
    setLoading(true);
    setError("");

    try {
      // Create household via API
      const hhRes = await fetch("/api/households", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: householdName || `${name}'s Place`,
          address,
          lat: -27.48, // TODO: geocode via Google Places
          lng: 153.02,
        }),
      });

      if (!hhRes.ok) { setError("Failed to create household"); setLoading(false); return; }
      const household = await hhRes.json();

      // Update profile name + household
      const profile = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
      if (profile.id) {
        // TODO: Add PATCH /api/profiles/{id} endpoint
        profile.name = name;
        profile.householdId = household.id;
        localStorage.setItem("goodsort_profile", JSON.stringify(profile));
      }

      router.push("/");
    } catch {
      setError("Something went wrong");
      setLoading(false);
    }
  }

  if (step === 0) {
    return (
      <div className="h-dvh bg-white flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-10">
            <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <User className="w-8 h-8 text-green-600" />
            </div>
            <h1 className="text-2xl font-display font-extrabold text-slate-900">What's your name?</h1>
          </div>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sarah"
            className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500 mb-4" autoFocus />
          <button onClick={() => { if (name.trim()) setStep(1); }} disabled={!name.trim()}
            className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 transition-all min-h-[48px]">
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh bg-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Home className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-display font-extrabold text-slate-900">Where do you live?</h1>
          <p className="text-slate-400 text-[13px] mt-1">This is where your collection bags will be</p>
        </div>
        <div className="space-y-3 mb-6">
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Address</label>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 45 Boundary St, South Brisbane"
              className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500" autoFocus />
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Household name</label>
            <input type="text" value={householdName} onChange={(e) => setHouseholdName(e.target.value)} placeholder={name ? `${name}'s Place` : "e.g. The Smiths"}
              className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500" />
          </div>
        </div>
        {error && <p className="text-red-500 text-[13px] mb-3">{error}</p>}
        <button onClick={handleComplete} disabled={loading || !address.trim()}
          className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 transition-all min-h-[48px]">
          {loading ? "Setting up..." : "Start Sorting"}
        </button>
        <button onClick={() => setStep(0)} className="w-full text-center text-[13px] text-slate-400 hover:text-slate-600 font-medium py-3 mt-2 transition-colors">Back</button>
      </div>
    </div>
  );
}
