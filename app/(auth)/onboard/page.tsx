"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, Mail, Recycle, Check, ShieldCheck } from "lucide-react";
import { apiUrl, authHeaders, hasValidToken, clearAuth, persistWaitlistFromUrl, readDayHint, readPlaceHint, readReferrerId, readStoredProfile, readStoredProfileId, writePlaceHint } from "@/lib/config";
import { track } from "@/lib/analytics";
import { canonicalSuburb, inviteMessage, streetInviteUrl, residentialNeedsStreet } from "@/lib/brisbane";
import { AddressAutocomplete, geocodeAddress } from "@/app/components/shared/address-autocomplete";
import { InviteActions } from "@/app/components/shared/invite-actions";
import { PayoutFields, validateClientPayout, type PayIdTypeChoice, type PayoutMethodChoice } from "@/app/components/shared/post-scan-setup";

type Step = "place" | "auth" | "verify" | "unit_waitlist";
type PendingPlaceSubmit = {
  address: string;
  lat: number;
  lng: number;
  suburb: string | null;
  day: number;
  area: string | null;
};

export default function OnboardPage() {
  const onboardFieldId = useId();
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
  // Set when the member already has a household and is here to finish it,
  // rather than joining from scratch.
  const [resuming, setResuming] = useState(false);
  const [defaultEmail, setDefaultEmail] = useState("");
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethodChoice>("payid");
  const [payIdType, setPayIdType] = useState<PayIdTypeChoice>("email");
  const [payIdValue, setPayIdValue] = useState("");
  const [bsb, setBsb] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNameTouched, setAccountNameTouched] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [devCode, setDevCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [pendingSubmit, setPendingSubmit] = useState<PendingPlaceSubmit | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    persistWaitlistFromUrl();
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
      const p = readStoredProfile();
      const emailStr = typeof p.email === "string" ? p.email : "";
      setDefaultEmail(emailStr);
      let initialName = "";
      if (typeof p.name === "string" && p.name && p.name !== "New User" && p.name !== "You") initialName = p.name;
      else if (emailStr.includes("@")) initialName = emailStr.split("@")[0];
      if (initialName) {
        setName(initialName);
        setAccountName(initialName);
      }
      if (emailStr) {
        setPayIdValue(emailStr);
        setAuthEmail(emailStr);
      }

      const applyExistingHousehold = (hhId: string) => {
        fetch(apiUrl(`/api/households/${hhId}`), { headers: authHeaders() })
          .then((r) => (r.ok ? r.json() : null))
          .then((hh) => {
            if (!hh) return;
            setResuming(true);
            if (hh.address) setAddress(hh.address);
            if (typeof hh.lat === "number" && hh.lat !== 0) setLat(hh.lat);
            if (typeof hh.lng === "number" && hh.lng !== 0) setLng(hh.lng);
            if (hh.councilArea) setCouncilArea(hh.councilArea);
            if (hh.councilCollectionDay != null) { setCollectionDay(hh.councilCollectionDay); setDayAuto(true); }
            if (hh.suburb) { setPickedSuburb(hh.suburb); setSuburbHint(hh.suburb); }
            // Do not make someone consent twice to the same thing.
            if (hh.accessConsent === true) setAccessConsent(true);
          })
          .catch(() => { /* fall back to a blank form */ });
      };

      const storedHhId = typeof p.householdId === "string" && p.householdId ? p.householdId : null;

      if (hasValidToken()) {
        fetch(apiUrl("/api/profiles/me/payout"), { headers: authHeaders() })
          .then((r) => (r.ok ? r.json() : null))
          .then((pay) => {
            if (!pay) return;
            if (!storedHhId && typeof pay.householdId === "string" && pay.householdId) {
              p.householdId = pay.householdId;
              if (typeof pay.profileName === "string" && pay.profileName) p.name = pay.profileName;
              try { localStorage.setItem("goodsort_profile", JSON.stringify(p)); } catch { /* ignore */ }
              applyExistingHousehold(pay.householdId);
            }
            if (!pay.hasPayoutDetails) return;
            if (pay.preferredPayoutMethod === "aba") setPayoutMethod("aba");
            if (pay.payIdType) setPayIdType(pay.payIdType as PayIdTypeChoice);
            if (pay.payIdValue) setPayIdValue(pay.payIdValue);
            if (pay.bankBsb) setBsb(pay.bankBsb);
            if (pay.bankAccountNumber) setAccountNumber(pay.bankAccountNumber);
            if (pay.bankAccountName) {
              setAccountName(pay.bankAccountName);
              setAccountNameTouched(true);
            }
          })
          .catch(() => {});
      }

      // A member who already has a household is here to FINISH it, not to
      // start again. Opening a blank form gives them no sign we already hold
      // their details and makes them retype an address we stored — and legacy
      // rows land here precisely because something is missing.
      if (storedHhId) {
        applyExistingHousehold(storedHhId);
      }
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

  async function lookupBinDayOnce(la: number, ln: number, addr: string): Promise<{ day: number; area: string | null }> {
    if (collectionDay != null) return { day: collectionDay, area: councilArea };
    try {
      const r = await fetch(apiUrl("/api/households/lookup-bin-day"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: la, lng: ln, address: addr }),
      });
      if (r.ok) {
        const d = await r.json();
        if (d?.found && typeof d.dayOfWeek === "number") {
          setCollectionDay(d.dayOfWeek);
          const resolvedArea = d.councilArea ?? councilArea;
          setCouncilArea(resolvedArea);
          setDayAuto(true);
          return { day: d.dayOfWeek, area: resolvedArea };
        }
      }
    } catch {
      /* fall through to default day */
    }
    return { day: 0, area: councilArea };
  }

  async function handleResidentialSubmit(override?: { address?: string; lat?: number; lng?: number; suburb?: string | null; day?: number; area?: string | null; tokenOverride?: string }) {
    const addr = override?.address ?? address;
    const la = override?.lat ?? lat;
    const ln = override?.lng ?? lng;
    const suburb = canonicalSuburb(override?.suburb) ?? canonicalSuburb(pickedSuburb) ?? canonicalSuburb(suburbHint);
    const effectiveDay = override?.day ?? collectionDay ?? 0;
    const effectiveArea = override?.area !== undefined ? override.area : councilArea;
    const requestHeaders = override?.tokenOverride
      ? { "Content-Type": "application/json", Authorization: `Bearer ${override.tokenOverride}` }
      : authHeaders();
    if (!addr || la == null || ln == null) { setError("Pick your address."); return; }
    if (!accessConsent) { setError("Tick the box so we can tell you when to bag out."); return; }
    const hasEnteredPayout = payoutMethod === "payid" ? Boolean(payIdValue.trim()) : Boolean(bsb.trim() || accountNumber.trim());
    if (hasEnteredPayout) {
      const payoutErr = validateClientPayout({
        method: payoutMethod,
        payIdType,
        payIdValue,
        bsb,
        accountNumber,
        accountName: accountName.trim() || name.trim(),
      });
      if (payoutErr) { setError(payoutErr); return; }
    }
    if (!override?.tokenOverride && !hasValidToken()) {
      writePlaceHint({ address: addr, lat: la, lng: ln, suburb, councilArea: effectiveArea });
      setPendingSubmit({ address: addr, lat: la, lng: ln, suburb, day: effectiveDay, area: effectiveArea });
      if (!authEmail && payoutMethod === "payid" && payIdType === "email" && payIdValue.includes("@")) {
        setAuthEmail(payIdValue.trim());
      }
      setError("");
      setStep("auth");
      return;
    }
    setLoading(true); setError("");

    try {
      const profile = readStoredProfile();
      const existingId = typeof profile.householdId === "string" && profile.householdId ? profile.householdId : null;
      const hhRes = await fetch(apiUrl(existingId ? `/api/households/${existingId}/street` : "/api/households"), {
        method: existingId ? "PATCH" : "POST", headers: requestHeaders,
        body: JSON.stringify(existingId ? {
          address: addr, lat: la, lng: ln,
          suburb,
          councilCollectionDay: effectiveDay,
          councilArea: effectiveArea,
          accessConsent: true,
        } : {
          name: `${name}'s Place`,
          address: addr, lat: la, lng: ln,
          type: "residential",
          councilCollectionDay: effectiveDay,
          councilArea: effectiveArea,
          suburb,
          usesDivider: true,
          accessConsent: true,
          accessConsentAt: new Date().toISOString(),
        }),
      });
      if (hhRes.status === 401) {
        writePlaceHint({ address: addr, lat: la, lng: ln, suburb, councilArea: effectiveArea });
        clearAuth();
        setError("Your session expired — please sign in again.");
        router.push("/login");
        return;
      }
      if (!hhRes.ok) {
        const data = await hhRes.json().catch(() => ({} as { error?: string }));
        setError(typeof data.error === "string" && data.error ? data.error : "Couldn't save your street");
        setLoading(false);
        return;
      }
      const hh = await hhRes.json();
      if (typeof hh?.id === "string" && hh.id) {
        profile.householdId = hh.id;
        localStorage.setItem("goodsort_profile", JSON.stringify(profile));
      }

      // A 2xx is not the same as "done". If the household came back still
      // missing a suburb, pushing to /sort just bounces the member
      // straight back here — and firing household_joined would record the
      // failure as a success. Stop, and say what is missing.
      if (residentialNeedsStreet(hh)) {
        setError("We saved what we could, but still need a Brisbane suburb address before you count toward a run.");
        setLoading(false);
        return;
      }

      if (typeof profile.id === "string" && profile.id) {
        await fetch(apiUrl(`/api/profiles/${profile.id}`), {
          method: "PATCH", headers: requestHeaders,
          body: JSON.stringify({ name, householdId: hh.id }),
        });
      }
      profile.name = name;
      profile.householdId = hh.id;
      localStorage.setItem("goodsort_profile", JSON.stringify(profile));
      if (hasEnteredPayout) {
        const holder = accountName.trim() || name.trim();
        const payRes = await fetch(apiUrl("/api/profiles/me/payout"), {
          method: "PUT",
          headers: requestHeaders,
          body: JSON.stringify({
            method: payoutMethod,
            payIdType: payoutMethod === "payid" ? payIdType : null,
            payIdValue: payoutMethod === "payid" ? payIdValue.trim() : null,
            bsb: payoutMethod === "aba" ? bsb : null,
            accountNumber: payoutMethod === "aba" ? accountNumber : null,
            accountName: holder,
            memberName: name.trim() || holder,
          }),
        });
        if (payRes.status === 401) {
          clearAuth();
          setError("Your session expired — please sign in again.");
          setLoading(false);
          router.push("/login");
          return;
        }
        if (!payRes.ok) {
          const payErr = await payRes.json().catch(() => ({} as { error?: string }));
          setError(payErr.error || "Couldn't save your payout details.");
          setLoading(false);
          return;
        }
        const savedPay = await payRes.json();
        profile.preferredPayoutMethod = savedPay.preferredPayoutMethod;
        profile.payIdType = savedPay.payIdType;
        profile.payIdValue = savedPay.payIdValue;
        profile.bankBsb = savedPay.bankBsb;
        profile.bankAccountNumber = savedPay.bankAccountNumber;
        profile.bankAccountName = savedPay.bankAccountName;
        localStorage.setItem("goodsort_profile", JSON.stringify(profile));
        track("payout_details_saved", { suburb });
      }
      track("household_joined", { suburb });
      router.push("/sort");
    } catch {
      setError("Something went wrong"); setLoading(false);
    }
  }

  async function handleUnitWaitlist(overrideLat?: number, overrideLng?: number, tokenOverride?: string) {
    const la = overrideLat ?? lat;
    const ln = overrideLng ?? lng;
    if (!address || la == null || ln == null || !buildingName) { setError("Enter your building name and address."); return; }
    if (!tokenOverride && !hasValidToken()) {
      const suburb = canonicalSuburb(pickedSuburb) ?? canonicalSuburb(suburbHint);
      writePlaceHint({ address, lat: la, lng: ln, suburb, councilArea });
      setPendingSubmit({ address, lat: la, lng: ln, suburb, day: collectionDay ?? 0, area: councilArea });
      setError("");
      setStep("auth");
      return;
    }
    const requestHeaders = tokenOverride
      ? { "Content-Type": "application/json", Authorization: `Bearer ${tokenOverride}` }
      : authHeaders();
    setLoading(true); setError("");
    try {
      const res = await fetch(apiUrl("/api/waitlist/unit-complex"), {
        method: "POST", headers: requestHeaders,
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
      const profile = readStoredProfile();
      if (data.id) {
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
    }
    setError("");
    if (type === "unit_complex") {
      if (!accessConsent) { setError("Tick the box so we can contact you about this building."); return; }
      await handleUnitWaitlist(la, ln);
      return;
    }
    const { day: resolvedDay, area: resolvedArea } = await lookupBinDayOnce(la, ln, resolved);
    await handleResidentialSubmit({ address: resolved, lat: la, lng: ln, suburb, day: resolvedDay, area: resolvedArea });
  }

  async function sendOtp(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!authEmail.trim().includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/api/auth/send-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail.trim() }),
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
        body: JSON.stringify({ email: authEmail.trim(), code: otp, referrerId }),
      });
      const data = await res.json().catch(() => ({} as { error?: string; token?: string; profile?: Record<string, unknown> }));
      if (!res.ok || !data.token || !data.profile) {
        setError(typeof data.error === "string" && data.error ? data.error : "Verification failed. Please try again.");
        setLoading(false);
        return;
      }
      localStorage.setItem("goodsort_token", data.token);
      localStorage.setItem("goodsort_profile", JSON.stringify(data.profile));
      document.cookie = `goodsort_token=${data.token}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Lax; Secure`;
      track("otp_verified");
      if (type === "unit_complex") {
        await handleUnitWaitlist(pendingSubmit?.lat, pendingSubmit?.lng, data.token);
      } else {
        await handleResidentialSubmit({
          address: pendingSubmit?.address,
          lat: pendingSubmit?.lat,
          lng: pendingSubmit?.lng,
          suburb: pendingSubmit?.suburb,
          day: pendingSubmit?.day,
          area: pendingSubmit?.area,
          tokenOverride: data.token,
        });
      }
    } catch {
      setError("Verification failed");
      setLoading(false);
    }
  }

  if (step === "auth") {
    return (
      <Shell
        icon={Mail}
        title="Verify your email"
        sub="We'll send a 6-digit code to link your household pickup address and sorting credits."
      >
        <form onSubmit={sendOtp} className="space-y-4">
          <div>
            <label htmlFor={`${onboardFieldId}-auth-email`} className="block text-[13px] font-semibold text-slate-700 mb-1.5">
              Email address
            </label>
            <input
              id={`${onboardFieldId}-auth-email`}
              type="email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus
              required
              className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
            />
          </div>
          {error && <p className="text-red-500 text-[13px]">{error}</p>}
          <button
            type="submit"
            disabled={loading || !authEmail.includes("@")}
            className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 min-h-[48px]"
          >
            {loading ? "Sending code..." : "Send verification code"}
          </button>
          <button
            type="button"
            onClick={() => { setError(""); setStep("place"); }}
            className="w-full inline-flex items-center justify-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-700 font-medium py-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to address details
          </button>
        </form>
      </Shell>
    );
  }

  if (step === "verify") {
    return (
      <Shell
        icon={ShieldCheck}
        title="Check your email"
        sub={`Enter the 6-digit code sent to ${authEmail}`}
      >
        <form onSubmit={verifyOtp} className="space-y-4">
          {devCode && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
              <p className="text-amber-700 text-[11px] font-medium mb-1">Dev mode — code auto-filled</p>
              <p className="text-amber-900 font-mono font-bold text-lg tracking-widest">{devCode}</p>
            </div>
          )}
          <div>
            <label htmlFor={`${onboardFieldId}-otp`} className="sr-only">
              6-digit verification code
            </label>
            <input
              id={`${onboardFieldId}-otp`}
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              autoFocus
              className="w-full border border-slate-200 rounded-xl px-4 py-4 text-center text-2xl font-mono font-bold tracking-[0.3em] text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
            />
          </div>
          {error && <p className="text-red-500 text-[13px] text-center">{error}</p>}
          <button
            type="submit"
            disabled={loading || otp.length < 6}
            className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 min-h-[48px]"
          >
            {loading ? "Saving your street..." : "Verify & Start Scanning"}
          </button>
          <div className="flex items-center justify-between text-[13px]">
            <button
              type="button"
              onClick={() => { setStep("auth"); setOtp(""); setError(""); }}
              className="text-slate-500 hover:text-slate-700 py-1"
            >
              Change email
            </button>
            <button
              type="button"
              onClick={() => void sendOtp()}
              disabled={resendIn > 0 || loading}
              className="text-green-600 font-semibold disabled:text-slate-300 py-1"
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
            </button>
          </div>
        </form>
      </Shell>
    );
  }

  if (step === "place") return (
    <Shell
      icon={type === "unit_complex" ? Building2 : Recycle}
      title={type === "unit_complex" ? "Your building" : resuming ? "Finish your street" : "Your street"}
      sub={type === "unit_complex"
        ? "High-rise common-area pickups are phase 2. If you put bags on the street, join as a house so your scans count toward suburb volume."
        : resuming
          // Landing here with a household already means something is missing.
          // Saying so beats a blank form that looks like starting over.
          ? "You are already signed up — we just need your suburb before your scans count toward a run."
          : suburbHint
            ? `Start scanning in ${suburbHint}. Address & payout, done — then scan for 10¢.`
            : "Address & payout, then scan. Earn 10¢ each. Suburb volume unlocks a driver trip."}
    >
      <div className="space-y-3 mb-4">
        {type === "residential" && (
          <div>
            <label htmlFor={`${onboardFieldId}-name`} className="block text-[13px] font-semibold text-slate-700 mb-1.5">Your name</label>
            <input id={`${onboardFieldId}-name`} type="text" value={name} onChange={e => {
              const v = e.target.value;
              setName(v);
              if (!accountNameTouched) setAccountName(v);
            }} placeholder="e.g. Sarah"
              className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500" />
          </div>
        )}
        {type === "unit_complex" && (
          <div>
            <label htmlFor={`${onboardFieldId}-building`} className="block text-[13px] font-semibold text-slate-700 mb-1.5">Building name</label>
            <input id={`${onboardFieldId}-building`} type="text" value={buildingName} onChange={e => setBuildingName(e.target.value)} placeholder="e.g. Kurilpa Apartments"
              className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500" />
          </div>
        )}
        <div>
          <label htmlFor={`${onboardFieldId}-address`} className="block text-[13px] font-semibold text-slate-700 mb-1.5">Address</label>
          <AddressAutocomplete
            id={`${onboardFieldId}-address`}
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
            <p className="text-[11px] text-slate-500 mt-1.5">Address confirmed. Change it if this is the wrong house.</p>
          )}
        </div>
      </div>

      {type === "residential" && (
        <>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl mb-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[13px] font-display font-extrabold text-slate-900">How should we pay you?</p>
              <span className="text-[11px] font-medium text-slate-400">From $20 cleared</span>
            </div>
            <PayoutFields
              method={payoutMethod}
              onMethodChange={setPayoutMethod}
              payIdType={payIdType}
              onPayIdTypeChange={setPayIdType}
              payIdValue={payIdValue}
              onPayIdValueChange={setPayIdValue}
              bsb={bsb}
              onBsbChange={setBsb}
              accountNumber={accountNumber}
              onAccountNumberChange={setAccountNumber}
              accountName={accountName}
              onAccountNameChange={(v) => {
                setAccountName(v);
                setAccountNameTouched(true);
              }}
              defaultEmail={defaultEmail}
            />
          </div>
          <label className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-xl mb-4 cursor-pointer">
            <input type="checkbox" checked={accessConsent} onChange={e => setAccessConsent(e.target.checked)} className="w-4 h-4 accent-green-600 mt-0.5" />
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-slate-900">Start scanning today. Tell me when to bag out.</p>
              <p className="text-[11px] text-slate-500">
                I will scan and sort eligible containers at home. Contact me when suburb volume unlocks a pickup. When you collect, I authorise The Good Sort to take my bagged containers from the kerb. See our <a href="/terms" target="_blank" className="underline text-green-600">Terms</a> and <a href="/privacy" target="_blank" className="underline text-green-600">Privacy Policy</a>.
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
              Contact me about common-area pickups. I can invite houses on my street to scan — their volume unlocks a run first. See our <a href="/terms" target="_blank" className="underline text-green-600">Terms</a> and <a href="/privacy" target="_blank" className="underline text-green-600">Privacy Policy</a>.
            </p>
          </div>
        </label>
      )}

      {error && <p className="text-red-500 text-[13px] mb-3">{error}</p>}
      <Continue
        onClick={continueFromPlace}
        disabled={loading || !address.trim() || !accessConsent || (type === "unit_complex" ? !buildingName.trim() : !name.trim())}
        label={loading ? "Saving..." : "Start scanning"}
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
    <Shell icon={Check} title="You're on the building list" sub="We'll email you when we launch common-area pickups. Invite houses on your street to scan — their volume unlocks a run first.">
      <p className="text-[13px] text-slate-500 mb-4">Body-corporate bins are phase 2. A neighbour scanning in a house still builds suburb volume toward a driver trip.</p>
      <div className="mb-4">
        <InviteActions url={inviteUrl} message={inviteMessage(inviteUrl, place)} />
      </div>
      <button type="button" onClick={() => router.push("/sort")}
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
    <button type="button" onClick={onClick} disabled={disabled}
      className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 transition-all min-h-[48px]">
      {label}
    </button>
  );
}

