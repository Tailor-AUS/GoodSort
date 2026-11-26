"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { Printer, ArrowLeft, MapPin } from "lucide-react";
import { hasValidToken, readStoredProfileId } from "@/lib/config";
import { findSuburb } from "@/lib/brisbane";
import { track } from "@/lib/analytics";
import { GlassBackdrop } from "@/app/components/shared/glass-backdrop";

const LAUNCH_SUBURBS = [
  { slug: "", label: "All Brisbane", postcode: "" },
  { slug: "moorooka", label: "Moorooka", postcode: "4105" },
  { slug: "annerley", label: "Annerley", postcode: "4103" },
  { slug: "tarragindi", label: "Tarragindi", postcode: "4121" },
] as const;

export default function FlyerPage() {
  const [signedIn, setSignedIn] = useState(false);
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    setSignedIn(hasValidToken());
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const r = params.get("r")?.trim() || undefined;
      setProfileId(r || readStoredProfileId());
      const q = params.get("suburb");
      if (q) {
        const match = findSuburb(q);
        if (match) setSelectedSlug(match.slug);
      }
    } else {
      setProfileId(readStoredProfileId());
    }
  }, []);

  const matchedSuburb = selectedSlug ? findSuburb(selectedSlug) : null;
  const suburbLabel = matchedSuburb?.name ?? null;
  const displayPath = matchedSuburb
    ? `thegoodsort.org/brisbane/${matchedSuburb.slug}`
    : "thegoodsort.org/scan";
  const fullTargetUrl = (() => {
    const base = matchedSuburb
      ? `https://thegoodsort.org/brisbane/${matchedSuburb.slug}`
      : "https://thegoodsort.org/scan";
    return profileId ? `${base}?r=${encodeURIComponent(profileId)}` : base;
  })();

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(fullTargetUrl, {
      width: 220,
      margin: 1,
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fullTargetUrl]);

  function printFlyer() {
    track("flyer_printed", { suburb: suburbLabel });
    if (typeof window !== "undefined") {
      window.print();
    }
  }

  return (
    <div className="relative min-h-dvh overflow-x-clip py-8 px-4 print:bg-white print:p-0">
      <GlassBackdrop printHidden />
      <div className="relative z-10 max-w-2xl mx-auto mb-5 flex flex-col gap-3 print:hidden">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={signedIn ? "/sort" : "/"}
            className="inline-flex items-center gap-2 min-h-[44px] rounded-full liquid-glass-pill px-4 py-2 text-sm font-semibold text-white hover:bg-white/25 shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          <button
            type="button"
            onClick={printFlyer}
            className="inline-flex items-center justify-center gap-2 min-h-[44px] rounded-full bg-gradient-to-b from-emerald-500 to-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-950/25 hover:from-emerald-400 hover:to-emerald-500 shrink-0 whitespace-nowrap"
          >
            <Printer className="w-4 h-4 shrink-0" />
            <span className="sm:hidden">Print Flyer</span>
            <span className="hidden sm:inline">Print Home Sorting Guide &amp; Street Flyer</span>
          </button>
        </div>

        <div className="rounded-[22px] liquid-glass px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-white">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-white/90">
            <MapPin className="w-3.5 h-3.5 text-emerald-200" />
            Target suburb flyer &amp; QR link:
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {LAUNCH_SUBURBS.map((s) => {
              const active = selectedSlug === s.slug;
              return (
                <button
                  key={s.slug || "all"}
                  type="button"
                  onClick={() => setSelectedSlug(s.slug)}
                  className={`min-h-[40px] px-3.5 py-2 rounded-full text-xs font-bold transition-colors ${
                    active
                      ? "bg-white text-slate-950 shadow-sm"
                      : "bg-white/15 hover:bg-white/25 text-white border border-white/30"
                  }`}
                >
                  {s.label}{s.postcode ? ` ${s.postcode}` : ""}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="relative z-10 max-w-2xl mx-auto space-y-6 print:space-y-4">
        {/* CUT-OUT HOME SORTING REMINDER */}
        <div className="bg-amber-400 rounded-3xl border-4 border-dashed border-slate-950 p-6 md:p-8 text-slate-950 shadow-sm print:shadow-none">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="inline-block rounded-full bg-slate-950 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-amber-300">
              Home Fridge / Bag Reminder · Stick Above Your 4 Home Bags
            </span>
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-900">
              8¢ / Can at Home
            </span>
          </div>
          <h2 className="text-2xl md:text-3xl font-display font-extrabold leading-tight mb-2">
            DON&apos;T THROW 10¢ CANS IN THE RUBBISH.
          </h2>
          <p className="text-sm md:text-base font-bold text-slate-900 mb-4">
            This house gets paid to sort cans &amp; bottles at home with The Good Sort. Join our street&apos;s 1,000-container pickup run — and earn bonus Good Sort Points when neighbours join:
          </p>
          <div className="rounded-2xl bg-slate-950 text-white px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                Open on your phone camera or browser
              </p>
              <p className="text-xl sm:text-2xl font-display font-extrabold tracking-tight text-white">
                {displayPath}
              </p>
            </div>
            <div className="rounded-xl bg-emerald-500 text-slate-950 font-extrabold px-3.5 py-2 text-xs uppercase tracking-wider shrink-0">
              Earn 8¢ / Can
            </div>
          </div>
        </div>

        {/* LETTERBOX / APARTMENT BIN-ROOM FLYER */}
        <div className="bg-white rounded-3xl border-2 border-slate-900 p-8 md:p-10 shadow-sm print:shadow-none">
          <div className="inline-block rounded-full bg-emerald-100 px-3.5 py-1 text-xs font-extrabold uppercase tracking-wider text-emerald-900 mb-4">
            The Good Sort · {suburbLabel ? `${suburbLabel} Street Network` : "Brisbane Street Network"}
          </div>

          <h1 className="text-3xl md:text-4xl font-display font-extrabold text-slate-900 leading-tight mb-4">
            {suburbLabel
              ? `${suburbLabel}: skip the Saturday depot queue. Get paid to sort cans & bottles at home.`
              : "Skip the Saturday depot queue. Get paid to sort cans & bottles at home."}
          </h1>

          <p className="text-base text-slate-700 leading-relaxed mb-6">
            Don&apos;t load sticky bags into your car or lose 3¢/can to home-pickup fees. Scan eligible drink cans and bottles on your phone, sort them into four streams at home, and unlock a local driver run for {suburbLabel ? `${suburbLabel}` : "our street"}.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
              <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-700 mb-1">1. Scan at home</p>
              <p className="text-lg font-extrabold text-slate-900 mb-1">8¢ per can</p>
              <p className="text-xs text-slate-600">
                Earn an 8¢ sorting credit on every eligible container you scan and sort into four streams at home.
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
              <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-700 mb-1">2. Suburb volume run</p>
              <p className="text-lg font-extrabold text-slate-900 mb-1">1,000 cans</p>
              <p className="text-xs text-slate-600">
                When {suburbLabel ? suburbLabel : "our suburb"} hits 1,000 scanned containers, a local driver collects the sorted bags from the kerb.
              </p>
            </div>
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
              <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-800 mb-1">3. Neighbour Network</p>
              <p className="text-lg font-extrabold text-emerald-950 mb-1">+100 PTS &amp; 1 PT/can</p>
              <p className="text-xs text-emerald-900">
                Invite neighbours on your street: earn 100 Good Sort Points when they join plus 1 bonus point on every container they sort.
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-slate-900 text-white p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-1">
                Scan QR code or open in Safari / Chrome · takes 15 seconds
              </p>
              <p className="text-xl sm:text-2xl font-display font-extrabold tracking-tight break-words">
                {displayPath}
              </p>
              <p className="text-xs text-slate-300 mt-1">
                No app store download. Point at any eligible 150mL–3L drink container and add your street.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt={`QR code for ${displayPath}`}
                  className="w-20 h-20 rounded-xl bg-white p-1 shrink-0"
                />
              )}
              <div className="rounded-xl bg-emerald-500 text-slate-950 font-extrabold px-4 py-2.5 text-sm shrink-0">
                Start Your Street Network
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 mt-6 leading-normal">
            Sorting credits (8¢ per eligible container) are a private reward paid by The Good Sort after physical collection and depot verification. Neighbour referrals earn non-cash Good Sort Points only. Operated by Tailor Intelligence Pty Ltd (ABN 13 688 827 572) t/a The Good Sort · thegoodsort.org
          </p>
        </div>
      </div>
    </div>
  );
}
