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
          href="/admin"
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </Link>
        <button
          type="button"
          onClick={printFlyer}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
        >
          <Printer className="w-4 h-4" />
          Print letterbox / bin-room flyer
        </button>
      </div>

      <div className="max-w-2xl mx-auto bg-white rounded-3xl border-2 border-slate-900 p-8 md:p-10 shadow-sm print:shadow-none print:rounded-none print:border-2">
        <div className="inline-block rounded-full bg-emerald-100 px-3.5 py-1 text-xs font-extrabold uppercase tracking-wider text-emerald-900 mb-4">
          The Good Sort · Brisbane Suburb Network
        </div>

        <h1 className="text-3xl md:text-4xl font-display font-extrabold text-slate-900 leading-tight mb-4">
          Skip the Saturday depot queue. Get paid to sort cans &amp; bottles at home.
        </h1>

        <p className="text-base text-slate-700 leading-relaxed mb-6">
          Don&apos;t load sticky bags into your car or wait at a refund machine. Scan eligible 10¢ drink cans and bottles on your phone, sort them into bags at home, and unlock a local driver run for our street.
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
            <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-800 mb-1">3. Invite neighbours</p>
            <p className="text-lg font-extrabold text-emerald-950 mb-1">$1 + 1¢/can</p>
            <p className="text-xs text-emerald-900">
              Earn $1 when a neighbour joins plus a 1¢ commission on every container they sort.
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
            First 20 cans = 10¢ each
          </div>
        </div>

        <p className="text-[11px] text-slate-500 mt-6 leading-normal">
          Sorting credits (5¢ standard, 10¢ first-20 launch bonus, plus 1¢/container referrer commission) are a private reward paid by The Good Sort after physical collection and depot verification, funded from the 10¢ QLD Container Refund Scheme refund. Operated by Tailor Intelligence Pty Ltd (ABN 13 688 827 572) t/a The Good Sort · thegoodsort.org
        </p>
      </div>
    </div>
  );
}
