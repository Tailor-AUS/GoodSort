"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Recycle, Check } from "lucide-react";
import { apiUrl, authHeaders, hasValidToken, clearAuth, readDayHint, readPlaceHint, readStoredProfileId } from "@/lib/config";
import { track } from "@/lib/analytics";
import { canonicalSuburb, DAY_NAMES, inviteMessage, streetInviteUrl } from "@/lib/brisbane";
import { AddressAutocomplete, geocodeAddress } from "@/app/components/shared/address-autocomplete";
import { InviteActions } from "@/app/components/shared/invite-actions";

type Step = "place" | "unit_waitlist";

export default function OnboardPage() {
  const [step, setStep] = useState<Step>("place");
  const [name, setName] = useState("");
  const [type, setType] = useState<"residential" | "unit_complex">("residential");
  const [address, setAddress] = useState("");
  const [buildingName, setBuildingName] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [collectionDay, setCollectionDay] = useState<number | null>(null);
  const [councilArea, setCouncilArea] = useState<string | null>(null);
  const [dayAuto, setDayAuto] = useState(false);
  const [accessConsent, setAccessConsent] = useState(false);
  const [suburbHint, setSuburbHint] = useState<string | null>(null);
  const [pickedSuburb, setPickedSuburb] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    try { setSuburbHint(sessionStorage.getItem("goodsort_suburb_hint")); } catch { /* ignore */ }
    const hinted = readDayHint();
    if (hinted != null) { setCollectionDay(hinted); setDayAuto(true); }
    const place = readPlaceHint();
    if (place) {
      setAddress(place.address);
      setLat(place.lat);
      setLng(place.lng);
      if (place.suburb) {
        setPickedSuburb(place.suburb);
        setSuburbHint(place.suburb);
      }
      if (place.councilArea) setCouncilArea(place.councilArea);
      if (hinted == null) lookupBinDay(place.lat, place.lng, place.address);
    }
    try {
      const p = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
      if (p.name && p.name !== "New User" && p.name !== "You") setName(p.name);
      else if (typeof p.email === "string" && p.email.includes("@")) setName(p.email.split("@")[0]);
    } catch { /* ignore */ }
  }, []);

  function lookupBinDay(la: number, ln: number, addr: string) {
    fetch(apiUrl("/api/households/lookup-bin-day"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: la, lng: ln, address: addr }),
    }).then((r) => r.json()).then((d) => {
      if (d.found) { setCollectionDay(d.dayOfWeek); setCouncilArea(d.councilArea); setDayAuto(true); }
    }).catch(() => {});
  }

  async function handleResidentialSubmit(override?: { address?: string; lat?: number; lng?: number; suburb?: string | null }) {
    const addr = override?.address ?? address;
    const la = override?.lat ?? lat;
    const ln = override?.lng ?? lng;
    const suburb = canonicalSuburb(override?.suburb) ?? canonicalSuburb(pickedSuburb) ?? canonicalSuburb(suburbHint);
    if (!addr || la == null || ln == null || collectionDay == null) { setError("Pick your address and collection day."); return; }
    if (!accessConsent) { setError("Tick the box so we can contact you when we launch your street."); return; }
    if (!hasValidToken()) { clearAuth(); setError("Your session expired — please sign in again."); router.push("/login"); return; }
    setLoading(true); setError("");

    try {
      const profile = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
      const existingId = typeof profile.householdId === "string" && profile.householdId ? profile.householdId : null;
      const hhRes = await fetch(apiUrl(existingId ? `/api/households/${existingId}/street` : "/api/households"), {
        method: existingId ? "PATCH" : "POST", headers: authHeaders(),
        body: JSON.stringify(existingId ? {
          address: addr, lat: la, lng: ln,
          suburb,
          councilCollectionDay: collectionDay,
          councilArea,
          accessConsent: true,
        } : {
          name: `${name}'s Place`,
          address: addr, lat: la, lng: ln,
          type: "residential",
          councilCollectionDay: collectionDay,
          councilArea,
          suburb,
          usesDivider: true,
          accessConsent: true,
          accessConsentAt: new Date().toISOString(),
        }),
      });
      if (hhRes.status === 401) { clearAuth(); setError("Your session expired — please sign in again."); router.push("/login"); return; }
      if (!hhRes.ok) {
        const data = await hhRes.json().catch(() => ({} as { error?: string }));
        setError(typeof data.error === "string" && data.error ? data.error : "Failed to join the waitlist");
        setLoading(false);
        return;
      }
      const hh = await hhRes.json();
      if (profile.id) {
        await fetch(apiUrl(`/api/profiles/${profile.id}`), {
          method: "PATCH", headers: authHeaders(),
          body: JSON.stringify({ name, householdId: hh.id }),
        });
        profile.name = name; profile.householdId = hh.id;
        localStorage.setItem("goodsort_profile", JSON.stringify(profile));
      }
      track("household_joined", { suburb });
      router.push("/invite");
    } catch {
      setError("Something went wrong"); setLoading(false);
    }
  }

  async function handleUnitWaitlist(overrideLat?: number, overrideLng?: number) {
    const la = overrideLat ?? lat;
    const ln = overrideLng ?? lng;
    if (!address || la == null || ln == null || !buildingName) { setError("Enter your building name and address."); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(apiUrl("/api/waitlist/unit-complex"), {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({
          buildingName,
          address,
          lat: la,
          lng: ln,
          suburb: canonicalSuburb(pickedSuburb) ?? canonicalSuburb(suburbHint),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        setError(typeof data.error === "string" && data.error ? data.error : "Failed to join the building list");
        return;
      }
      const data = await res.json().catch(() => ({}));
      const profile = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
      if (profile.id && data.id) {
        profile.householdId = data.id;
        localStorage.setItem("goodsort_profile", JSON.stringify(profile));
      }
      track("household_joined", { suburb: canonicalSuburb(pickedSuburb) ?? canonicalSuburb(suburbHint) });
      setStep("unit_waitlist");
    } catch {
      setError("Something went wrong");
    } finally { setLoading(false); }
  }

  async function continueFromPlace() {
    const addr = address.trim();
    if (!addr) { setError("Enter your address."); return; }
    let la = lat;
    let ln = lng;
    let resolved = address;
    let suburb = pickedSuburb;
    if (la == null || ln == null) {
      setLoading(true); setError("");
      const geo = await geocodeAddress(addr);
      setLoading(false);
      if (!geo) { setError("Couldn't find that address. Try selecting from the dropdown."); return; }
      resolved = geo.address; la = geo.lat; ln = geo.lng;
      suburb = geo.suburb ?? suburb;
      setAddress(geo.address); setLat(geo.lat); setLng(geo.lng);
      setPickedSuburb(geo.suburb ?? null);
      lookupBinDay(geo.lat, geo.lng, geo.address);
    }
    setError("");
    if (type === "unit_complex") {
      if (!accessConsent) { setError("Tick the box so we can contact you about this building."); return; }
      await handleUnitWaitlist(la, ln);
      return;
    }
    if (collectionDay == null) {
      setError("Pick your recycling day — we unlock a street only when neighbours share the same day.");
      return;
    }
    await handleResidentialSubmit({ address: resolved, lat: la, lng: ln, suburb });
  }

  if (step === "place") return (
    <Shell
      icon={type === "unit_complex" ? Building2 : Recycle}
      title={type === "unit_complex" ? "Your building" : "Your street"}
      sub={type === "unit_complex"
        ? "High-rise common-area pickups are phase 2. If you put a bin on the street, join as a house so your recycling day can unlock."
        : suburbHint
          ? `Put ${suburbHint} on the waitlist. Address, recycling day, done.`
          : "Address and recycling day. That's a request for a purple bin."}
    >
      <div className="space-y-3 mb-4">
        {type === "residential" && (
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Your name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sarah"
              className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500" />
          </div>
        )}
        {type === "unit_complex" && (
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Building name</label>
            <input type="text" value={buildingName} onChange={e => setBuildingName(e.target.value)} placeholder="e.g. Kurilpa Apartments"
              className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500" />
          </div>
        )}
        <div>
          <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Address</label>
          <AddressAutocomplete
            value={address}
            onChange={(text) => {
              setAddress(text);
              setLat(null); setLng(null); setCollectionDay(null); setDayAuto(false); setPickedSuburb(null);
            }}
            onSelect={(sel) => {
              setAddress(sel.address); setLat(sel.lat); setLng(sel.lng);
              setPickedSuburb(sel.suburb ?? null);
              lookupBinDay(sel.lat, sel.lng, sel.address);
            }}
            placeholder={suburbHint ? `Start typing your ${suburbHint} address…` : "Start typing your address…"}
          />
          {lat != null && lng != null && (
            <p className="text-[11px] text-slate-500 mt-1.5">Kept from the recycling-day check. Change it if this is the wrong house.</p>
          )}
        </div>
      </div>

      {type === "residential" && (
        <>
          <p className="text-[13px] font-semibold text-slate-700 mb-1.5">
            Recycling day {dayAuto ? "— from Brisbane City Council open data" : ""}
          </p>
          <div className="grid grid-cols-4 gap-2 mb-4">
            {DAY_NAMES.map((d, i) => (
              <button key={d} onClick={() => { setCollectionDay(i); setDayAuto(false); }} type="button"
                className={`py-2.5 rounded-lg text-[12px] font-semibold border transition-colors ${collectionDay === i ? "bg-green-600 text-white border-green-600" : "bg-white text-slate-700 border-slate-200 hover:border-green-400"}`}>
                {d.slice(0, 3)}
              </button>
            ))}
          </div>
          <div className="p-3 bg-violet-50 border border-violet-200 rounded-xl mb-3">
            <p className="text-[13px] font-semibold text-slate-900">Purple bin + divider, when your street unlocks</p>
            <p className="text-[11px] text-slate-500 mt-0.5">We do not rummage your council yellow bin. 12 houses on the same day and we order ours.</p>
          </div>
          <label className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-xl mb-4 cursor-pointer">
            <input type="checkbox" checked={accessConsent} onChange={e => setAccessConsent(e.target.checked)} className="w-4 h-4 accent-green-600 mt-0.5" />
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-slate-900">Put me on the waitlist for a purple The Good Sort bin</p>
              <p className="text-[11px] text-slate-500">
                Contact me when you are collecting in my area. When you deliver the bin, I authorise The Good Sort to collect it from my kerb. See our <a href="/terms" target="_blank" className="underline text-green-600">Terms</a> and <a href="/privacy" target="_blank" className="underline text-green-600">Privacy Policy</a>.
              </p>
            </div>
          </label>
        </>
      )}

      {type === "unit_complex" && (
        <label className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-xl mb-4 cursor-pointer">
          <input type="checkbox" checked={accessConsent} onChange={e => setAccessConsent(e.target.checked)} className="w-4 h-4 accent-green-600 mt-0.5" />
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-slate-900">Put this building on the waitlist</p>
            <p className="text-[11px] text-slate-500">
              Contact me about common-area pickups. I can invite houses on my street — they unlock a run first. See our <a href="/terms" target="_blank" className="underline text-green-600">Terms</a> and <a href="/privacy" target="_blank" className="underline text-green-600">Privacy Policy</a>.
            </p>
          </div>
        </label>
      )}

      {error && <p className="text-red-500 text-[13px] mb-3">{error}</p>}
      <Continue
        onClick={continueFromPlace}
        disabled={loading || !address.trim() || !accessConsent || (type === "unit_complex" ? !buildingName.trim() : !name.trim() || collectionDay == null)}
        label={loading ? "Joining..." : "Join the waitlist"}
      />
      <button
        type="button"
        onClick={() => {
          setType(type === "residential" ? "unit_complex" : "residential");
          setError("");
        }}
        className="w-full text-center text-[13px] text-slate-500 hover:text-slate-700 font-medium py-2 mt-1"
      >
        {type === "residential" ? "I live in a unit / apartment" : "I live in a house"}
      </button>
    </Shell>
  );

  if (step === "unit_waitlist") {
    const place = suburbHint ?? pickedSuburb;
    const inviteUrl = streetInviteUrl({ suburb: place, profileId: readStoredProfileId() });
    return (
    <Shell icon={Check} title="You're on the building list" sub="We'll email you when we launch common-area pickups. Invite houses on your street — they unlock a run first.">
      <p className="text-[13px] text-slate-500 mb-4">Body-corporate bins are phase 2. A neighbour in a house on the same recycling day still gets you closer to a purple-bin night.</p>
      <div className="mb-4">
        <InviteActions url={inviteUrl} message={inviteMessage(inviteUrl, place)} />
      </div>
      <button onClick={() => router.push("/sort")}
        className="w-full bg-slate-100 hover:bg-slate-200 text-slate-900 font-semibold py-3.5 rounded-xl text-[15px] min-h-[48px]">Done</button>
    </Shell>
    );
  }

  return null;
}

function Shell({ icon: Icon, title, sub, children }: { icon: React.ElementType; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-white flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Icon className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-display font-extrabold text-slate-900">{title}</h1>
          {sub && <p className="text-slate-400 text-[13px] mt-1">{sub}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

function Continue({ onClick, disabled, label = "Continue" }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 transition-all min-h-[48px]">
      {label}
    </button>
  );
}

