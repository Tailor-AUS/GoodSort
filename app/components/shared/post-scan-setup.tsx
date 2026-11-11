"use client";

import { useEffect, useId, useState } from "react";
import { Check, MapPin, Wallet } from "lucide-react";
import { apiUrl, authHeaders, clearAuth, hasValidToken, readStoredProfile } from "@/lib/config";
import { canonicalSuburb, residentialNeedsStreet, titleSuburb } from "@/lib/brisbane";
import { track } from "@/lib/analytics";
import { AddressAutocomplete, geocodeAddress } from "@/app/components/shared/address-autocomplete";

export type PayoutMethodChoice = "payid" | "aba";
export type PayIdTypeChoice = "email" | "phone" | "abn";

export interface SavedPayoutSummary {
  hasPayoutDetails: boolean;
  householdId?: string | null;
  profileName?: string | null;
  preferredPayoutMethod?: string | null;
  payIdType?: string | null;
  payIdValue?: string | null;
  bankBsb?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
}

export function formatSavedPayoutLabel(p: SavedPayoutSummary | null | undefined): string | null {
  if (!p?.hasPayoutDetails) return null;
  if (p.preferredPayoutMethod === "payid" && p.payIdValue) {
    return `PayID · ${p.payIdValue}`;
  }
  if (p.preferredPayoutMethod === "aba" && p.bankBsb && p.bankAccountNumber) {
    const digits = p.bankBsb.replace(/\D/g, "");
    const bsbFormatted = digits.length === 6 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : p.bankBsb;
    const tail = p.bankAccountNumber.slice(-4);
    return `Bank · BSB ${bsbFormatted} · ••••${tail}`;
  }
  return null;
}

export function validateClientPayout(opts: {
  method: PayoutMethodChoice;
  payIdType: PayIdTypeChoice;
  payIdValue: string;
  bsb: string;
  accountNumber: string;
  accountName: string;
}): string | null {
  const holder = opts.accountName.trim();
  if (holder.length < 2) return "Enter the account holder name so we can pay you.";

  if (opts.method === "payid") {
    const val = opts.payIdValue.trim();
    if (!val) return "Enter your PayID email, mobile number, or ABN.";
    if (opts.payIdType === "email" && (!val.includes("@") || !val.includes(".") || val.length < 5)) {
      return "Enter a valid PayID email address.";
    }
    if (opts.payIdType === "phone") {
      const digits = val.replace(/\D/g, "");
      if (digits.length < 9 || digits.length > 12) return "Enter a valid Australian mobile number for PayID.";
    }
    if (opts.payIdType === "abn") {
      const digits = val.replace(/\D/g, "");
      if (digits.length !== 11) return "PayID ABN must be 11 digits.";
    }
    return null;
  }

  const cleanBsb = opts.bsb.replace(/\D/g, "");
  const cleanAccount = opts.accountNumber.replace(/\D/g, "");
  if (cleanBsb.length !== 6) return "Enter a 6-digit BSB (for example 064-000).";
  if (cleanAccount.length < 5 || cleanAccount.length > 9) return "Enter a 5 to 9 digit bank account number.";
  return null;
}

function deriveDefaultName(rawName?: string | null, email?: string | null): string {
  const trimmed = (rawName ?? "").trim();
  if (trimmed && trimmed !== "New User" && trimmed !== "You") return trimmed;
  if (email && email.includes("@")) {
    const prefix = email.split("@")[0].replace(/[._-]+/g, " ").trim();
    if (prefix) {
      return prefix.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }
  return "";
}

interface PayoutFieldsProps {
  method: PayoutMethodChoice;
  onMethodChange: (m: PayoutMethodChoice) => void;
  payIdType: PayIdTypeChoice;
  onPayIdTypeChange: (t: PayIdTypeChoice) => void;
  payIdValue: string;
  onPayIdValueChange: (v: string) => void;
  bsb: string;
  onBsbChange: (v: string) => void;
  accountNumber: string;
  onAccountNumberChange: (v: string) => void;
  accountName: string;
  onAccountNameChange: (v: string) => void;
  defaultEmail?: string;
}

export function PayoutFields({
  method,
  onMethodChange,
  payIdType,
  onPayIdTypeChange,
  payIdValue,
  onPayIdValueChange,
  bsb,
  onBsbChange,
  accountNumber,
  onAccountNumberChange,
  accountName,
  onAccountNameChange,
  defaultEmail,
}: PayoutFieldsProps) {
  const fieldPrefix = useId();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl">
        <button
          type="button"
          onClick={() => onMethodChange("payid")}
          className={`py-2 rounded-lg text-[13px] font-bold transition-all ${
            method === "payid" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          PayID
        </button>
        <button
          type="button"
          onClick={() => onMethodChange("aba")}
          className={`py-2 rounded-lg text-[13px] font-bold transition-all ${
            method === "aba" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          Bank account (BSB)
        </button>
      </div>

      {method === "payid" ? (
        <>
          <div>
            <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">PayID type</label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: "email", label: "Email" },
                  { id: "phone", label: "Mobile" },
                  { id: "abn", label: "ABN" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    onPayIdTypeChange(opt.id);
                    if (opt.id === "email" && !payIdValue.trim() && defaultEmail) {
                      onPayIdValueChange(defaultEmail);
                    } else if (opt.id !== "email" && payIdValue.trim() === defaultEmail) {
                      onPayIdValueChange("");
                    }
                  }}
                  className={`py-2 rounded-lg border text-[12px] font-bold transition-colors ${
                    payIdType === opt.id
                      ? "border-green-500 bg-green-50 text-green-800"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor={`${fieldPrefix}-payid`} className="block text-[12px] font-semibold text-slate-600 mb-1">
              {payIdType === "email" ? "PayID email" : payIdType === "phone" ? "PayID mobile number" : "PayID ABN"}
            </label>
            <input
              id={`${fieldPrefix}-payid`}
              type={payIdType === "email" ? "email" : "tel"}
              inputMode={payIdType === "email" ? "email" : "numeric"}
              value={payIdValue}
              onChange={(e) => onPayIdValueChange(e.target.value)}
              placeholder={
                payIdType === "email"
                  ? "you@example.com"
                  : payIdType === "phone"
                  ? "0412 345 678"
                  : "12 345 678 901"
              }
              className="w-full border border-slate-200 bg-white rounded-xl px-3.5 py-3 text-[15px] text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
            />
          </div>
        </>
      ) : (
        <div className="grid grid-cols-5 gap-2">
          <div className="col-span-2">
            <label htmlFor={`${fieldPrefix}-bsb`} className="block text-[12px] font-semibold text-slate-600 mb-1">BSB</label>
            <input
              id={`${fieldPrefix}-bsb`}
              type="text"
              inputMode="numeric"
              maxLength={7}
              value={bsb}
              onChange={(e) => onBsbChange(e.target.value)}
              placeholder="064-000"
              className="w-full border border-slate-200 bg-white rounded-xl px-3.5 py-3 text-[15px] text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
            />
          </div>
          <div className="col-span-3">
            <label htmlFor={`${fieldPrefix}-acct`} className="block text-[12px] font-semibold text-slate-600 mb-1">Account number</label>
            <input
              id={`${fieldPrefix}-acct`}
              type="text"
              inputMode="numeric"
              maxLength={9}
              value={accountNumber}
              onChange={(e) => onAccountNumberChange(e.target.value)}
              placeholder="12345678"
              className="w-full border border-slate-200 bg-white rounded-xl px-3.5 py-3 text-[15px] text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
            />
          </div>
        </div>
      )}

      <div>
        <label htmlFor={`${fieldPrefix}-holder`} className="block text-[12px] font-semibold text-slate-600 mb-1">Account holder name</label>
        <input
          id={`${fieldPrefix}-holder`}
          type="text"
          value={accountName}
          onChange={(e) => onAccountNameChange(e.target.value)}
          placeholder="Full name on bank account"
          className="w-full border border-slate-200 bg-white rounded-xl px-3.5 py-3 text-[15px] text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
        />
      </div>
    </div>
  );
}

interface PostScanSetupProps {
  earnedCents: number;
  totalItems: number;
  binName?: string | null;
  isPublicBinScan?: boolean;
  onScanAnother: () => void;
}

export function PostScanSetup({
  earnedCents,
  totalItems,
  binName,
  isPublicBinScan = false,
  onScanAnother,
}: PostScanSetupProps) {
  const setupFieldPrefix = useId();
  const [checking, setChecking] = useState(true);
  const [hasCompleteAddress, setHasCompleteAddress] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [savedAddressLabel, setSavedAddressLabel] = useState<string | null>(null);
  const [savedSuburb, setSavedSuburb] = useState<string | null>(null);
  const [existingHouseholdId, setExistingHouseholdId] = useState<string | null>(null);

  const [hasSavedPayout, setHasSavedPayout] = useState(false);
  const [editingPayout, setEditingPayout] = useState(false);
  const [savedPayoutSummary, setSavedPayoutSummary] = useState<SavedPayoutSummary | null>(null);

  const [defaultEmail, setDefaultEmail] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [pickedSuburb, setPickedSuburb] = useState<string | null>(null);
  const [collectionDay, setCollectionDay] = useState<number | null>(null);
  const [councilArea, setCouncilArea] = useState("Brisbane City");
  const [accessConsent, setAccessConsent] = useState(true);

  const [payoutMethod, setPayoutMethod] = useState<PayoutMethodChoice>("payid");
  const [payIdType, setPayIdType] = useState<PayIdTypeChoice>("email");
  const [payIdValue, setPayIdValue] = useState("");
  const [bsb, setBsb] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNameTouched, setAccountNameTouched] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const profile = readStoredProfile();
        const emailStr = typeof profile.email === "string" ? profile.email : "";
        const storedName = typeof profile.name === "string" ? profile.name : "";
        const derivedName = deriveDefaultName(storedName, emailStr);
        if (!cancelled) {
          setDefaultEmail(emailStr);
          setName(derivedName);
          setAccountName(typeof profile.bankAccountName === "string" && profile.bankAccountName ? profile.bankAccountName : derivedName);
          setPayIdValue(typeof profile.payIdValue === "string" && profile.payIdValue ? profile.payIdValue : emailStr);
        }

        let hhId = typeof profile.householdId === "string" && profile.householdId ? profile.householdId : null;
        if (!cancelled) setExistingHouseholdId(hhId);

        const [initialHhRes, payoutRes] = await Promise.all([
          hhId && hasValidToken()
            ? fetch(apiUrl(`/api/households/${hhId}`), { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
            : Promise.resolve(null),
          hasValidToken()
            ? fetch(apiUrl("/api/profiles/me/payout"), { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
            : Promise.resolve(null),
        ]);

        let hhRes = initialHhRes;
        if (!hhId && payoutRes && typeof payoutRes.householdId === "string" && payoutRes.householdId && hasValidToken()) {
          hhId = payoutRes.householdId;
          profile.householdId = hhId;
          if (typeof payoutRes.profileName === "string" && payoutRes.profileName) profile.name = payoutRes.profileName;
          try { localStorage.setItem("goodsort_profile", JSON.stringify(profile)); } catch { /* ignore */ }
          if (!cancelled) setExistingHouseholdId(hhId);
          hhRes = await fetch(apiUrl(`/api/households/${hhId}`), { headers: authHeaders() })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);
        }

        if (cancelled) return;

        if (!derivedName && typeof payoutRes?.profileName === "string" && payoutRes.profileName && payoutRes.profileName !== "New User") {
          setName(payoutRes.profileName);
          setAccountName((prev) => prev || payoutRes.profileName);
        }

        if (hhRes && !residentialNeedsStreet(hhRes)) {
          setHasCompleteAddress(true);
          setEditingAddress(false);
          setSavedAddressLabel(hhRes.address || titleSuburb(hhRes.suburb ?? ""));
          setSavedSuburb(hhRes.suburb ?? null);
        } else {
          if (hhRes) {
            if (hhRes.address) setAddress(hhRes.address);
            if (typeof hhRes.lat === "number" && hhRes.lat !== 0) setLat(hhRes.lat);
            if (typeof hhRes.lng === "number" && hhRes.lng !== 0) setLng(hhRes.lng);
            if (hhRes.suburb) setPickedSuburb(hhRes.suburb);
            if (hhRes.councilCollectionDay != null) setCollectionDay(hhRes.councilCollectionDay);
            if (hhRes.accessConsent === true) setAccessConsent(true);
          }
          setHasCompleteAddress(false);
          setEditingAddress(!isPublicBinScan);
        }

        if (payoutRes?.hasPayoutDetails) {
          setHasSavedPayout(true);
          setEditingPayout(false);
          setSavedPayoutSummary(payoutRes);
          if (payoutRes.preferredPayoutMethod === "aba") setPayoutMethod("aba");
          if (payoutRes.payIdType) setPayIdType(payoutRes.payIdType as PayIdTypeChoice);
          if (payoutRes.payIdValue) setPayIdValue(payoutRes.payIdValue);
          if (payoutRes.bankBsb) setBsb(payoutRes.bankBsb);
          if (payoutRes.bankAccountNumber) setAccountNumber(payoutRes.bankAccountNumber);
          if (payoutRes.bankAccountName) {
            setAccountName(payoutRes.bankAccountName);
            setAccountNameTouched(true);
          }
        } else {
          setHasSavedPayout(false);
          setEditingPayout(true);
        }
      } catch {
        if (!cancelled) {
          setEditingAddress(!isPublicBinScan);
          setEditingPayout(true);
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [isPublicBinScan]);

  function lookupBinDay(la: number, ln: number, addr: string) {
    fetch(apiUrl("/api/households/lookup-bin-day"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: la, lng: ln, address: addr }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.found) {
          setCollectionDay(d.dayOfWeek);
          if (d.councilArea) setCouncilArea(d.councilArea);
        }
      })
      .catch(() => {});
  }

  async function lookupBinDayOnce(la: number, ln: number, addr: string): Promise<{ day: number; area: string }> {
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
          const area = d.councilArea || councilArea;
          setCouncilArea(area);
          return { day: d.dayOfWeek, area };
        }
      }
    } catch {
      /* fall through */
    }
    return { day: 0, area: councilArea };
  }

  async function handleSave() {
    if (!hasValidToken()) {
      clearAuth();
      setError("Your session expired — please sign in again.");
      return;
    }

    const wantAddress = editingAddress && !isPublicBinScan;
    const wantPayout = editingPayout;
    const trimmedName = name.trim() || accountName.trim();

    if (wantAddress) {
      if (trimmedName.length < 2) {
        setError("Enter your name so our driver knows whose bags to collect.");
        return;
      }
      if (!address.trim()) {
        setError("Enter your Brisbane home address so we know where to collect your cans.");
        return;
      }
      if (!accessConsent) {
        setError("Tick the pickup consent box so we can collect your bagged containers from the kerb.");
        return;
      }
    }

    if (wantPayout) {
      const payoutErr = validateClientPayout({
        method: payoutMethod,
        payIdType,
        payIdValue,
        bsb,
        accountNumber,
        accountName: accountName.trim() || trimmedName,
      });
      if (payoutErr) {
        setError(payoutErr);
        return;
      }
    }

    setSaving(true);
    setError("");

    try {
      const profile = readStoredProfile();
      let finalHouseholdId = existingHouseholdId;

      if (wantAddress) {
        let la = lat;
        let ln = lng;
        let resolvedAddr = address.trim();
        let rawSuburb = pickedSuburb;

        if (la == null || ln == null) {
          const geo = await geocodeAddress(resolvedAddr);
          if (!geo) {
            setError("Couldn't find that street address — pick your home from the dropdown suggestions.");
            setSaving(false);
            return;
          }
          resolvedAddr = geo.address;
          la = geo.lat;
          ln = geo.lng;
          rawSuburb = geo.suburb ?? rawSuburb;
          setAddress(geo.address);
          setLat(geo.lat);
          setLng(geo.lng);
          setPickedSuburb(geo.suburb ?? null);
        }

        const suburb = canonicalSuburb(rawSuburb);
        const { day: effectiveDay, area: effectiveArea } = await lookupBinDayOnce(la, ln, resolvedAddr);

        const hhRes = await fetch(
          apiUrl(existingHouseholdId ? `/api/households/${existingHouseholdId}/street` : "/api/households"),
          {
            method: existingHouseholdId ? "PATCH" : "POST",
            headers: authHeaders(),
            body: JSON.stringify(
              existingHouseholdId
                ? {
                    address: resolvedAddr,
                    lat: la,
                    lng: ln,
                    suburb,
                    councilCollectionDay: effectiveDay,
                    councilArea: effectiveArea,
                    accessConsent: true,
                  }
                : {
                    name: `${trimmedName}'s Place`,
                    address: resolvedAddr,
                    lat: la,
                    lng: ln,
                    type: "residential",
                    councilCollectionDay: effectiveDay,
                    councilArea: effectiveArea,
                    suburb,
                    usesDivider: true,
                    accessConsent: true,
                  }
            ),
          }
        );

        if (hhRes.status === 401) {
          clearAuth();
          setError("Your session expired — please sign in again.");
          setSaving(false);
          return;
        }

        if (!hhRes.ok) {
          const data = await hhRes.json().catch(() => ({} as { error?: string }));
          setError(data.error || "Couldn't save your home address.");
          setSaving(false);
          return;
        }

        const hh = await hhRes.json();
        if (residentialNeedsStreet(hh)) {
          setError("Pick your full street address including your Brisbane suburb (for example, Moorooka).");
          setSaving(false);
          return;
        }

        finalHouseholdId = hh.id;
        if (typeof profile.id === "string" && profile.id) {
          await fetch(apiUrl(`/api/profiles/${profile.id}`), {
            method: "PATCH",
            headers: authHeaders(),
            body: JSON.stringify({ name: trimmedName, householdId: hh.id }),
          });
        }
        profile.name = trimmedName;
        profile.householdId = hh.id;
        localStorage.setItem("goodsort_profile", JSON.stringify(profile));
        setExistingHouseholdId(hh.id);
        setHasCompleteAddress(true);
        setEditingAddress(false);
        setSavedAddressLabel(hh.address || titleSuburb(hh.suburb ?? ""));
        setSavedSuburb(hh.suburb ?? suburb ?? null);
        track("household_joined", { suburb: hh.suburb ?? suburb });
      }

      if (wantPayout) {
        const holder = accountName.trim() || trimmedName;
        const payoutRes = await fetch(apiUrl("/api/profiles/me/payout"), {
          method: "PUT",
          headers: authHeaders(),
          body: JSON.stringify({
            method: payoutMethod,
            payIdType: payoutMethod === "payid" ? payIdType : null,
            payIdValue: payoutMethod === "payid" ? payIdValue.trim() : null,
            bsb: payoutMethod === "aba" ? bsb : null,
            accountNumber: payoutMethod === "aba" ? accountNumber : null,
            accountName: holder,
            memberName: trimmedName || holder,
          }),
        });

        if (!payoutRes.ok) {
          const data = await payoutRes.json().catch(() => ({} as { error?: string }));
          setError(data.error || "Couldn't save your payout details.");
          setSaving(false);
          return;
        }

        const savedPayout = await payoutRes.json();
        profile.preferredPayoutMethod = savedPayout.preferredPayoutMethod;
        profile.payIdType = savedPayout.payIdType;
        profile.payIdValue = savedPayout.payIdValue;
        profile.bankBsb = savedPayout.bankBsb;
        profile.bankAccountNumber = savedPayout.bankAccountNumber;
        profile.bankAccountName = savedPayout.bankAccountName;
        if (savedPayout.profileName) profile.name = savedPayout.profileName;
        track("payout_details_saved", { suburb: savedSuburb ?? canonicalSuburb(pickedSuburb) });
      }

      if (finalHouseholdId) profile.householdId = finalHouseholdId;
      localStorage.setItem("goodsort_profile", JSON.stringify(profile));
      window.location.href = "/sort";
    } catch {
      setError("Something went wrong — please check your connection and try again.");
      setSaving(false);
    }
  }

  const showSetupForm = (!isPublicBinScan && editingAddress) || editingPayout;
  const payoutSummaryText = formatSavedPayoutLabel(savedPayoutSummary);

  return (
    <div className="min-h-dvh bg-white flex flex-col items-center justify-center px-5 overflow-y-auto">
      <div className="w-full max-w-md py-8">
        <div className="text-center mb-5">
          <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Check className="w-7 h-7 text-green-600" />
          </div>
          {totalItems > 0 && (
            <p className="text-3xl font-display font-extrabold text-green-600 mb-1 animate-ka-ching">
              +{earnedCents}c
            </p>
          )}
          <h1 className="text-xl font-display font-extrabold text-slate-900">
            {checking
              ? totalItems > 0
                ? "Container banked"
                : "Done"
              : showSetupForm
              ? !hasCompleteAddress && !isPublicBinScan && !hasSavedPayout
                ? "Where do we collect & pay you?"
                : !hasCompleteAddress && !isPublicBinScan
                ? "Where should we collect your cans?"
                : "Where should we pay you?"
              : totalItems > 0
              ? "Banked to your suburb"
              : "Done"}
          </h1>
          <p className="text-slate-500 text-[13px] mt-1">
            {totalItems} container{totalItems !== 1 ? "s" : ""} noted{binName ? ` at ${binName}` : ""}.{" "}
            {showSetupForm && !checking
              ? "Add your home pickup & payout details once so we can collect your bags and pay you."
              : "Credits clear once we collect your bags and verify at the depot."}
          </p>
        </div>

        {checking ? (
          <div className="py-6 text-center text-slate-400 text-[13px]">Checking your pickup &amp; payout details…</div>
        ) : showSetupForm ? (
          <div className="space-y-4 text-left">
            {!isPublicBinScan && (
              editingAddress ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-green-100 text-green-700 flex items-center justify-center">
                      <MapPin className="w-3.5 h-3.5" />
                    </div>
                    <p className="text-[14px] font-display font-extrabold text-slate-900">
                      Home pickup address
                    </p>
                  </div>

                  <div>
                    <label htmlFor={`${setupFieldPrefix}-name`} className="block text-[12px] font-semibold text-slate-600 mb-1">Your name</label>
                    <input
                      id={`${setupFieldPrefix}-name`}
                      type="text"
                      value={name}
                      onChange={(e) => {
                        const v = e.target.value;
                        setName(v);
                        if (!accountNameTouched) setAccountName(v);
                      }}
                      placeholder="e.g. Knox Hart"
                      className="w-full border border-slate-200 bg-white rounded-xl px-3.5 py-3 text-[15px] text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
                    />
                  </div>

                  <div>
                    <label htmlFor={`${setupFieldPrefix}-address`} className="block text-[12px] font-semibold text-slate-600 mb-1">Brisbane home address</label>
                    <AddressAutocomplete
                      id={`${setupFieldPrefix}-address`}
                      value={address}
                      onChange={(text) => {
                        setAddress(text);
                        setLat(null);
                        setLng(null);
                        setCollectionDay(null);
                        setPickedSuburb(null);
                      }}
                      onSelect={(sel) => {
                        setAddress(sel.address);
                        setLat(sel.lat);
                        setLng(sel.lng);
                        setPickedSuburb(sel.suburb ?? null);
                        lookupBinDay(sel.lat, sel.lng, sel.address);
                      }}
                      placeholder="Start typing your street address…"
                      className="w-full border border-slate-200 bg-white rounded-xl px-3.5 py-3 text-[15px] text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
                    />
                    {lat != null && lng != null && (
                      <p className="text-[11px] text-green-700 font-medium mt-1">
                        ✓ Street confirmed{pickedSuburb ? ` · ${titleSuburb(pickedSuburb)}` : ""}
                      </p>
                    )}
                  </div>

                  <label className="flex items-start gap-2.5 pt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={accessConsent}
                      onChange={(e) => setAccessConsent(e.target.checked)}
                      className="w-4 h-4 accent-green-600 mt-0.5 flex-shrink-0"
                    />
                    <span className="text-[11px] text-slate-500 leading-relaxed">
                      Tell me when my suburb hits 1,000 containers and collect my bagged cans from the kerb (
                      <a href="/terms" target="_blank" className="underline text-green-700">Terms</a>
                      {" & "}
                      <a href="/privacy" target="_blank" className="underline text-green-700">Privacy</a>
                      ).{" "}
                      <a href="/onboard" className="underline text-slate-600 font-medium">Live in a unit?</a>
                    </span>
                  </label>
                </div>
              ) : (
                <div className="rounded-2xl border border-green-200 bg-green-50/70 px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-green-800">Pickup address saved</p>
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{savedAddressLabel}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingAddress(true)}
                    className="text-[12px] font-bold text-green-700 hover:text-green-900 flex-shrink-0"
                  >
                    Edit
                  </button>
                </div>
              )
            )}

            {editingPayout ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-green-100 text-green-700 flex items-center justify-center">
                      <Wallet className="w-3.5 h-3.5" />
                    </div>
                    <p className="text-[14px] font-display font-extrabold text-slate-900">
                      How we pay you
                    </p>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-400">From $20 cleared</span>
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
            ) : (
              payoutSummaryText && (
                <div className="rounded-2xl border border-green-200 bg-green-50/70 px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-green-800">Payout details saved</p>
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{payoutSummaryText}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingPayout(true)}
                    className="text-[12px] font-bold text-green-700 hover:text-green-900 flex-shrink-0"
                  >
                    Edit
                  </button>
                </div>
              )
            )}

            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-[12px] font-medium text-red-700">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 transition-all min-h-[48px] flex items-center justify-center"
              style={{ touchAction: "manipulation" }}
            >
              {saving
                ? "Saving…"
                : editingAddress && !isPublicBinScan && editingPayout
                ? "Save address & payout details"
                : editingAddress && !isPublicBinScan
                ? "Save home address"
                : "Save payout details"}
            </button>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={onScanAnother}
                className="text-[13px] font-bold text-green-700 hover:text-green-900 py-2 px-1"
              >
                Scan another can first
              </button>
              <button
                type="button"
                onClick={() => {
                  window.location.href = "/sort";
                }}
                className="text-[13px] font-medium text-slate-400 hover:text-slate-600 py-2 px-1"
              >
                Do this later
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-left space-y-2">
              {savedSuburb && (
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-green-800 font-semibold">
                    ✓ Counting toward {titleSuburb(savedSuburb)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingAddress(true)}
                    className="text-[12px] font-bold text-green-700 hover:text-green-900"
                  >
                    Address
                  </button>
                </div>
              )}
              {payoutSummaryText && (
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-green-800 font-semibold truncate pr-2">
                    ✓ {payoutSummaryText}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingPayout(true)}
                    className="text-[12px] font-bold text-green-700 hover:text-green-900 flex-shrink-0"
                  >
                    Change
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onScanAnother}
              className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 transition-all min-h-[48px] flex items-center justify-center"
              style={{ touchAction: "manipulation" }}
            >
              Scan another container
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = "/sort";
              }}
              className="w-full py-3 text-slate-500 font-semibold text-[13px] hover:text-slate-700 transition-colors"
            >
              Back to my suburb
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
