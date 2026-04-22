"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { Home, User, Building2, Recycle, Check } from "lucide-react";
import { apiUrl } from "@/lib/config";

type Step = "name" | "type" | "address" | "bin_day" | "unit_waitlist";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function OnboardPage() {
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [type, setType] = useState<"residential" | "unit_complex">("residential");
  const [address, setAddress] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [buildingName, setBuildingName] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [collectionDay, setCollectionDay] = useState<number | null>(null);
  const [councilArea, setCouncilArea] = useState<string | null>(null);
  const [dayAuto, setDayAuto] = useState(false);
  const [usesDivider, setUsesDivider] = useState(true);
  const [accessConsent, setAccessConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const addressInput = useRef<HTMLInputElement>(null);
  const hasSelectedPlace = useRef(false);

  // Places Autocomplete
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key || !addressInput.current || step !== "address") return;
    setOptions({ key, v: "weekly" });
    importLibrary("places").then(async () => {
      if (!addressInput.current) return;
      const ac = new google.maps.places.Autocomplete(addressInput.current, {
        componentRestrictions: { country: "au" },
        fields: ["formatted_address", "geometry"],
        types: ["address"],
      });
      ac.addListener("place_changed", () => {
        const p = ac.getPlace();
        if (p.formatted_address) {
          setAddress(p.formatted_address);
          hasSelectedPlace.current = true;
          if (addressInput.current) addressInput.current.value = p.formatted_address;
        }
        if (p.geometry?.location) {
          const la = p.geometry.location.lat();
          const ln = p.geometry.location.lng();
          setLat(la); setLng(ln);
          fetch(apiUrl("/api/households/lookup-bin-day"), {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: la, lng: ln, address: p.formatted_address }),
          }).then(r => r.json()).then(d => {
            if (d.found) {
              setCollectionDay(d.dayOfWeek);
              setCouncilArea(d.councilArea);
              setDayAuto(true);
            }
          }).catch(() => {});
        }
      });
    });
  }, [step]);

  async function geocodeAddress(addr: string): Promise<{ lat: number; lng: number } | null> {
    try {
      const geocoder = new google.maps.Geocoder();
      const result = await geocoder.geocode({ address: addr, componentRestrictions: { country: "au" } });
      if (result.results.length > 0) {
        const loc = result.results[0].geometry.location;
        return { lat: loc.lat(), lng: loc.lng() };
      }
    } catch { /* fall through */ }
    return null;
  }

  async function handleResidentialSubmit() {
    if (!address || lat == null || lng == null || collectionDay == null) { setError("Pick your address and collection day."); return; }
    if (!accessConsent) { setError("Please tick the consent box so we can access your yellow bin."); return; }
    setLoading(true); setError("");

    try {
      const hhRes = await fetch(apiUrl("/api/households"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: householdName || `${name}'s Place`,
          address, lat, lng,
          type: "residential",
          councilCollectionDay: collectionDay,
          councilArea,
          usesDivider,
          accessConsent: true,
          accessConsentAt: new Date().toISOString(),
        }),
      });
      if (!hhRes.ok) { setError("Failed to create household"); setLoading(false); return; }
      const hh = await hhRes.json();
      const profile = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
      if (profile.id) {
        await fetch(apiUrl(`/api/profiles/${profile.id}`), {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, householdId: hh.id }),
        });
        profile.name = name; profile.householdId = hh.id;
        localStorage.setItem("goodsort_profile", JSON.stringify(profile));
      }
      router.push("/");
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
      await fetch(apiUrl("/api/waitlist/unit-complex"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildingName, address, lat: la, lng: ln }),
      });
      setStep("unit_waitlist");
    } finally { setLoading(false); }
  }

  // ── Step 1: Name ──
  if (step === "name") return (
    <Shell icon={User} title="What's your name?">
      <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sarah"
        className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500 mb-4" autoFocus />
      <Continue onClick={() => name.trim() && setStep("type")} disabled={!name.trim()} />
    </Shell>
  );

  // ── Step 2: Pick type ──
  if (step === "type") return (
    <Shell icon={Home} title="Where do you live?" sub="Two options — pick the one that sounds like you.">
      <TypeButton
        icon={Home} title="House with a yellow bin"
        body="I have my own council yellow (recycling) wheelie bin on the kerb each week."
        selected={type === "residential"} onClick={() => { setType("residential"); }}
      />
      <TypeButton
        icon={Building2} title="Unit / apartment"
        body="I live in a unit complex with a shared skip bin or rubbish chute."
        selected={type === "unit_complex"} onClick={() => { setType("unit_complex"); }}
      />
      <Continue onClick={() => setStep("address")} />
      <BackLink onClick={() => setStep("name")} />
    </Shell>
  );

  // ── Step 3: Address ──
  if (step === "address") return (
    <Shell icon={Home} title={type === "residential" ? "Your address" : "Your building"}
      sub={type === "residential" ? "So we know which kerbside bin to come for." : "We're rolling out to unit complexes in phase 2 — join the waitlist."}>
      <div className="space-y-3 mb-6">
        {type === "unit_complex" && (
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Building name</label>
            <input type="text" value={buildingName} onChange={e => setBuildingName(e.target.value)} placeholder="e.g. Kurilpa Apartments"
              className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500" />
          </div>
        )}
        <div>
          <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Address</label>
          <input ref={addressInput} type="text" defaultValue={address}
            onChange={e => {
              const val = e.target.value;
              setAddress(val);
              if (hasSelectedPlace.current) {
                hasSelectedPlace.current = false;
                setLat(null); setLng(null); setCollectionDay(null); setDayAuto(false);
              }
            }}
            placeholder="Start typing your address..." autoFocus
            className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500" />
        </div>
        {type === "residential" && (
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Household name</label>
            <input type="text" value={householdName} onChange={e => setHouseholdName(e.target.value)} placeholder={name ? `${name}'s Place` : "e.g. The Smiths"}
              className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500" />
          </div>
        )}
      </div>
      {error && <p className="text-red-500 text-[13px] mb-3">{error}</p>}
      <Continue
        onClick={async () => {
          const addr = address || addressInput.current?.value || "";
          if (!addr.trim()) { setError("Enter your address."); return; }
          if (!address) setAddress(addr);
          if (lat == null || lng == null) {
            setLoading(true); setError("");
            const geo = await geocodeAddress(addr);
            setLoading(false);
            if (!geo) { setError("Couldn't find that address. Try selecting from the dropdown."); return; }
            setLat(geo.lat); setLng(geo.lng);
            // Fire bin-day lookup for geocoded address
            fetch(apiUrl("/api/households/lookup-bin-day"), {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lat: geo.lat, lng: geo.lng, address: addr }),
            }).then(r => r.json()).then(d => {
              if (d.found) { setCollectionDay(d.dayOfWeek); setCouncilArea(d.councilArea); setDayAuto(true); }
            }).catch(() => {});
            if (type === "unit_complex") handleUnitWaitlist(geo.lat, geo.lng);
            else setStep("bin_day");
            return;
          }
          setError("");
          if (type === "unit_complex") handleUnitWaitlist();
          else setStep("bin_day");
        }}
        disabled={loading || !address.trim()}
        label={loading ? "Looking up..." : type === "unit_complex" ? "Join waitlist" : "Continue"}
      />
      <BackLink onClick={() => setStep("type")} />
    </Shell>
  );

  // ── Step 4: Bin day (residential only) ──
  if (step === "bin_day") return (
    <Shell icon={Recycle} title="When's your yellow bin day?" sub={dayAuto ? "We found it — confirm or change below." : "Pick the day your council empties your yellow (recycling) bin."}>
      <div className="grid grid-cols-4 gap-2 mb-6">
        {DAYS.map((d, i) => (
          <button key={d} onClick={() => { setCollectionDay(i); setDayAuto(false); }} type="button"
            className={`py-2.5 rounded-lg text-[12px] font-semibold border transition-colors ${collectionDay === i ? "bg-green-600 text-white border-green-600" : "bg-white text-slate-700 border-slate-200 hover:border-green-400"}`}>
            {d.slice(0, 3)}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-xl mb-3 cursor-pointer">
        <input type="checkbox" checked={usesDivider} onChange={e => setUsesDivider(e.target.checked)} className="w-4 h-4 accent-green-600" />
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-slate-900">Send me a cardboard divider</p>
          <p className="text-[11px] text-slate-400">Keeps your cans & bottles on one side of the bin so our runner can grab them fast.</p>
        </div>
      </label>

      <label className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-xl mb-6 cursor-pointer">
        <input type="checkbox" checked={accessConsent} onChange={e => setAccessConsent(e.target.checked)} className="w-4 h-4 accent-green-600 mt-0.5" />
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-slate-900">I authorise The Good Sort to access my yellow bin</p>
          <p className="text-[11px] text-slate-500">
            On the day before my council collection, a GoodSort runner may open my yellow recycling bin (on the kerb or property) and remove eligible CDS containers. Anything else is left for the council truck. See our <a href="/terms" target="_blank" className="underline text-green-600">Terms</a> and <a href="/privacy" target="_blank" className="underline text-green-600">Privacy Policy</a>.
          </p>
        </div>
      </label>

      {error && <p className="text-red-500 text-[13px] mb-3">{error}</p>}
      <Continue onClick={handleResidentialSubmit} disabled={loading || collectionDay == null}
        label={loading ? "Setting up..." : "Start Sorting"} />
      <BackLink onClick={() => setStep("address")} />
    </Shell>
  );

  // ── Waitlist success ──
  if (step === "unit_waitlist") return (
    <Shell icon={Check} title="You're on the list" sub="We'll email you when we launch unit-complex pickups in your area.">
      <p className="text-[13px] text-slate-500 mb-6">Unit pickups need bin drop-offs in common areas, which we're rolling out through body corporates. Expect an update soon.</p>
      <button onClick={() => router.push("/")}
        className="w-full bg-slate-100 hover:bg-slate-200 text-slate-900 font-semibold py-3.5 rounded-xl text-[15px] min-h-[48px]">Done</button>
    </Shell>
  );

  return null;
}

// ── Shared UI helpers ──

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

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full text-center text-[13px] text-slate-400 hover:text-slate-600 font-medium py-3 mt-2 transition-colors">Back</button>
  );
}

function TypeButton({ icon: Icon, title, body, selected, onClick }: { icon: React.ElementType; title: string; body: string; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} type="button"
      className={`w-full text-left border rounded-xl p-4 mb-3 transition-colors ${selected ? "border-green-500 bg-green-50/60" : "border-slate-200 bg-white hover:border-green-300"}`}>
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${selected ? "bg-green-600 text-white" : "bg-slate-100 text-slate-600"}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-[14px] font-semibold text-slate-900">{title}</p>
          <p className="text-[12px] text-slate-500 mt-0.5">{body}</p>
        </div>
      </div>
    </button>
  );
}
