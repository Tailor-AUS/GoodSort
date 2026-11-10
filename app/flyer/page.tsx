"use client";

import Link from "next/link";
import { Printer, ArrowLeft } from "lucide-react";

export default function FlyerPage() {
  function printFlyer() {
    if (typeof window !== "undefined") {
      window.print();
    }
  }

  return (
    <div className="min-h-dvh bg-slate-100 py-8 px-4 print:bg-white print:p-0">
      <div className="max-w-2xl mx-auto mb-4 flex items-center justify-between print:hidden">
        <Link
          href="/sort"
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
        <button
          type="button"
          onClick={printFlyer}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
        >
          <Printer className="w-4 h-4" />
          Print Yellow-Bin Decal &amp; Street Flyer
        </button>
      </div>

      <div className="max-w-2xl mx-auto space-y-6 print:space-y-4">
        {/* CUT-OUT YELLOW-BIN LID DECAL */}
        <div className="bg-amber-400 rounded-3xl border-4 border-dashed border-slate-950 p-6 md:p-8 text-slate-950 shadow-sm print:shadow-none">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="inline-block rounded-full bg-slate-950 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-amber-300">
              Yellow-Bin Lid Decal · Tape or Stick to Your Bin Lid
            </span>
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-900">
              10¢ / Can First 20
            </span>
          </div>
          <h2 className="text-2xl md:text-3xl font-display font-extrabold leading-tight mb-2">
            DON&apos;T THROW 10¢ CANS IN THE COUNCIL BIN.
          </h2>
          <p className="text-sm md:text-base font-bold text-slate-900 mb-4">
            This house gets paid to sort cans &amp; bottles at home with The Good Sort. Join our street&apos;s 1,000-container pickup run — and earn $1/house + 1¢/can when you build your own Container Mafia:
          </p>
          <div className="rounded-2xl bg-slate-950 text-white px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                Open on your phone camera or browser
              </p>
              <p className="text-2xl font-display font-extrabold tracking-tight text-white">
                thegoodsort.org/scan
              </p>
            </div>
            <div className="rounded-xl bg-emerald-500 text-slate-950 font-extrabold px-3.5 py-2 text-xs uppercase tracking-wider">
              +10¢ / Can Bonus
            </div>
          </div>
        </div>

        {/* LETTERBOX / APARTMENT BIN-ROOM FLYER */}
        <div className="bg-white rounded-3xl border-2 border-slate-900 p-8 md:p-10 shadow-sm print:shadow-none">
          <div className="inline-block rounded-full bg-emerald-100 px-3.5 py-1 text-xs font-extrabold uppercase tracking-wider text-emerald-900 mb-4">
            The Good Sort · Brisbane Container Mafia
          </div>

          <h1 className="text-3xl md:text-4xl font-display font-extrabold text-slate-900 leading-tight mb-4">
            Skip the Saturday depot queue. Get paid to sort cans &amp; bottles at home.
          </h1>

          <p className="text-base text-slate-700 leading-relaxed mb-6">
            Don&apos;t load sticky bags into your car or lose 3¢/can to home-pickup fees. Scan eligible drink cans and bottles on your phone, sort them into four streams at home, and unlock a local driver run for our street.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
              <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-700 mb-1">1. Scan at home</p>
              <p className="text-lg font-extrabold text-slate-900 mb-1">10¢ per can</p>
              <p className="text-xs text-slate-600">
                Double credit (10¢ each) on your first 20 eligible containers, then 5¢ sorting credit each.
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
              <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-700 mb-1">2. Suburb volume run</p>
              <p className="text-lg font-extrabold text-slate-900 mb-1">1,000 cans</p>
              <p className="text-xs text-slate-600">
                When our suburb hits 1,000 scanned containers, a local driver collects the sorted bags from the kerb.
              </p>
            </div>
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
              <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-800 mb-1">3. Container Mafia</p>
              <p className="text-lg font-extrabold text-emerald-950 mb-1">$1 + 1¢/can</p>
              <p className="text-xs text-emerald-900">
                Recruit neighbours on your street: earn $1 when they join plus a 1¢ cut on every container they sort.
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-slate-900 text-white p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-1">
                No app store download · takes 15 seconds
              </p>
              <p className="text-2xl font-display font-extrabold tracking-tight">
                thegoodsort.org/scan
              </p>
              <p className="text-xs text-slate-300 mt-1">
                Open in Safari or Chrome on your phone, point at any eligible 150mL–3L drink container, and add your street.
              </p>
            </div>
            <div className="rounded-xl bg-emerald-500 text-slate-950 font-extrabold px-4 py-2.5 text-sm shrink-0">
              Start Your Street Network
            </div>
          </div>

          <p className="text-[11px] text-slate-500 mt-6 leading-normal">
            Sorting credits (5¢ standard, 10¢ first-20 launch bonus, plus 1¢/container Container Mafia referrer commission) are a private reward paid by The Good Sort after physical collection and depot verification. Operated by Tailor Intelligence Pty Ltd (ABN 13 688 827 572) t/a The Good Sort · thegoodsort.org
          </p>
        </div>
      </div>
    </div>
  );
}
