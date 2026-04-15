"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { Home, User } from "lucide-react";
import { apiUrl } from "@/lib/config";

export default function OnboardPage() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const addressInput = useRef<HTMLInputElement>(null);

  // Google Places Autocomplete for accurate address + lat/lng
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key || !addressInput.current || step !== 1) return;
    setOptions({ key, v: "weekly" });
    importLibrary("places").then(() => {
      if (!addressInput.current) return;
      const ac = new google.maps.places.Autocomplete(addressInput.current, {
        componentRestrictions: { country: "au" },
        fields: ["formatted_address", "geometry"],
        types: ["address"],
      });
      ac.addListener("place_changed", () => {
        const p = ac.getPlace();
        if (p.formatted_address) setAddress(p.formatted_address);
        if (p.geometry?.location) {
          setLat(p.geometry.location.lat());
          setLng(p.geometry.location.lng());
        }
      });
    });
  }, [step]);

  async function handleComplete() {
    if (!name || !address) return;
    setLoading(true);
    setError("");

    try {
      // Use Autocomplete-selected coords, fall back to Geocoding
      let hLat = lat ?? -27.48;
      let hLng = lng ?? 153.02;
      const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      if ((lat == null || lng == null) && mapsKey) {
        try {
          const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${mapsKey}&region=au`);
          const geoData = await geoRes.json();
          if (geoData.results?.[0]?.geometry?.location) {
            hLat = geoData.results[0].geometry.location.lat;
            hLng = geoData.results[0].geometry.location.lng;
          }
        } catch { /* use default coords */ }
      }

      // Create household via API
      const hhRes = await fetch(apiUrl("/api/households"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: householdName || `${name}'s Place`,
          address,
          lat: hLat,
          lng: hLng,
        }),
      });

      if (!hhRes.ok) { setError("Failed to create household"); setLoading(false); return; }
      const household = await hhRes.json();

      // Update profile on backend AND localStorage
      const profile = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
      if (profile.id) {
        await fetch(apiUrl(`/api/profiles/${profile.id}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, householdId: household.id }),
        });
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
            <input ref={addressInput} type="text" value={address} onChange={(e) => { setAddress(e.target.value); setLat(null); setLng(null); }} placeholder="Start typing your address..."
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
