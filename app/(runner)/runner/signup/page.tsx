"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Car } from "lucide-react";
import { apiUrl } from "@/lib/config";

export default function RunnerSignupPage() {
  const router = useRouter();
  const [vehicleType, setVehicleType] = useState("car");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleRego, setVehicleRego] = useState("");
  const [capacityBags, setCapacityBags] = useState(10);
  const [serviceRadiusKm, setServiceRadiusKm] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    const profile = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
    if (!profile.id) { router.push("/login"); return; }

    try {
      const res = await fetch(apiUrl("/api/runner/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: profile.id,
          vehicleType,
          vehicleMake,
          vehicleRego,
          capacityBags,
          serviceRadiusKm,
        }),
      });
      if (!res.ok) { setError("Registration failed."); setLoading(false); return; }
      router.push("/runner");
    } catch {
      setError("Something went wrong."); setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-white">
      <div className="max-w-sm mx-auto px-6 py-8">
        <Link href="/" className="inline-flex items-center gap-1 text-[13px] text-slate-500 mb-6">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>

        <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mb-4">
          <Car className="w-8 h-8 text-green-600" />
        </div>
        <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-1">Become a Runner</h1>
        <p className="text-[13px] text-slate-500 mb-6">Pick up full bins from houses near you, drop them at Tomra, earn 5c per container.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Vehicle type</label>
            <select value={vehicleType} onChange={e => setVehicleType(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500">
              <option value="car">Car</option>
              <option value="ute">Ute / Van</option>
              <option value="bike">Bike / Cargo bike</option>
              <option value="walk">On foot</option>
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Make / model</label>
            <input type="text" value={vehicleMake} onChange={e => setVehicleMake(e.target.value)} placeholder="e.g. Toyota Corolla"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500" />
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Registration</label>
            <input type="text" value={vehicleRego} onChange={e => setVehicleRego(e.target.value.toUpperCase())} placeholder="e.g. 123ABC"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Bag capacity</label>
              <input type="number" min={1} max={50} value={capacityBags} onChange={e => setCapacityBags(+e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500" />
            </div>
            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Range (km)</label>
              <input type="number" min={1} max={50} value={serviceRadiusKm} onChange={e => setServiceRadiusKm(+e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500" />
            </div>
          </div>
          {error && <p className="text-red-500 text-[13px]">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 min-h-[48px]">
            {loading ? "Registering..." : "Register as Runner"}
          </button>
          <p className="text-[11px] text-slate-400 text-center">
            By registering you agree to collect, transport and drop off containers at approved depots.
          </p>
        </form>
      </div>
    </div>
  );
}
