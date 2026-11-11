"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import {
  QrCode,
  Printer,
  ArrowLeft,
  CheckCircle2,
  Truck,
  Sparkles,
  Trash2,
  Plus,
  Home,
} from "lucide-react";
import {
  getMyBags,
  createSortedBag,
  updateBagStatus,
} from "@/lib/marketplace-api";
import {
  BAG_STREAMS,
  type BagStream,
  type SortedBagDto,
  type MyBagsResponse,
} from "@/lib/marketplace";

export default function SortedBagsPage() {
  const [data, setData] = useState<MyBagsResponse | null>(null);
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [selectedStream, setSelectedStream] = useState<BagStream>("aluminium");
  const [declaredCount, setDeclaredCount] = useState<number>(150);
  const [putOnKerb, setPutOnKerb] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [creating, setCreating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadBags = useCallback(async () => {
    const res = await getMyBags();
    setData(res);
    setLoading(false);
    if (res) {
      const unbagged = res.unbaggedByStream.aluminium;
      if (unbagged > 0) setDeclaredCount(unbagged);
    }
  }, []);

  useEffect(() => {
    loadBags();
  }, [loadBags]);

  useEffect(() => {
    let cancelled = false;
    async function buildQrs(bags: SortedBagDto[]) {
      const next: Record<string, string> = {};
      for (const b of bags) {
        try {
          next[b.code] = await QRCode.toDataURL(b.code, {
            width: 220,
            margin: 1,
            color: { dark: "#0f172a", light: "#ffffff" },
          });
        } catch {
          // ignore QR render error
        }
      }
      if (!cancelled) setQrMap(next);
    }
    if (data?.bags && data.bags.length > 0) {
      buildQrs(data.bags);
    }
    return () => {
      cancelled = true;
    };
  }, [data?.bags]);

  const handleSelectStream = (s: BagStream) => {
    setSelectedStream(s);
    const unbagged = data?.unbaggedByStream?.[s] ?? 0;
    setDeclaredCount(unbagged > 0 ? unbagged : 150);
  };

  const handleCreateBag = async () => {
    setCreating(true);
    setError(null);
    const created = await createSortedBag(selectedStream, declaredCount, putOnKerb);
    setCreating(false);
    if (!created) {
      setError("Could not create bag tag. Make sure your household street address is saved first.");
      return;
    }
    await loadBags();
  };

  const handleStatusChange = async (bagId: string, status: "sealed" | "on_kerb" | "cancelled") => {
    await updateBagStatus(bagId, status);
    await loadBags();
  };

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 pb-16">
      {/* Screen Header (hidden when printing) */}
      <header className="print:hidden sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Link
              href="/sort"
              aria-label="Back to Sorter home"
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="font-display font-extrabold text-base text-slate-900 leading-tight">
                4-Stream QR Bag Tags
              </h1>
              <p className="text-xs text-slate-500">
                Link scanned cans to physical kerbside bags for COEX Secondary-Sorted Runs
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/marketplace"
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
            >
              Marketplace
            </Link>
            {(data?.bags.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => window.print()}
                className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-1.5"
              >
                <Printer size={14} /> Print Labels
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Household prerequisite check */}
        {!loading && data && !data.hasHousehold && (
          <div className="print:hidden rounded-2xl bg-amber-50 border border-amber-200 p-4 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Home size={20} className="text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm text-amber-900">Add your street address first</p>
                <p className="text-xs text-amber-800 mt-0.5">
                  QR bag tags link directly to your household stop so Runners know whose account to credit on pickup.
                </p>
              </div>
            </div>
            <Link
              href="/household"
              className="px-4 py-2 rounded-xl bg-amber-600 text-white font-bold text-xs whitespace-nowrap"
            >
              Set Address
            </Link>
          </div>
        )}

        {/* Create New 4-Stream Bag Tag (hidden on print) */}
        <section className="print:hidden rounded-3xl bg-white border border-slate-200 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="inline-flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full">
                <Sparkles size={12} /> Secondary-Sorted CRP Ready
              </span>
              <h2 className="font-display font-extrabold text-lg text-slate-900 mt-1">
                Seal a Pre-Sorted Stream Bag
              </h2>
            </div>
            <Link href="/scan" className="text-xs font-bold text-emerald-700 hover:underline">
              + Scan More Cans
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {(Object.keys(BAG_STREAMS) as BagStream[]).map((key) => {
              const info = BAG_STREAMS[key];
              const unbagged = data?.unbaggedByStream?.[key] ?? 0;
              const active = selectedStream === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleSelectStream(key)}
                  className={`text-left p-3.5 rounded-2xl border-2 transition-all ${
                    active
                      ? "border-emerald-600 bg-emerald-50/50 shadow-sm"
                      : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-display font-bold text-sm text-slate-900">
                      {info.label}
                    </span>
                    <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${info.badgeBg} ${info.badgeText}`}>
                      {info.codePrefix}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">{info.rule}</p>
                  <p className="text-[11px] font-bold text-emerald-700 mt-1.5">
                    {unbagged} unbagged {unbagged === 1 ? "scan" : "scans"} ready to attach
                  </p>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label htmlFor="declared-count" className="block text-xs font-bold text-slate-700 mb-1">
                Containers in this bag
              </label>
              <input
                id="declared-count"
                type="number"
                min={1}
                max={500}
                value={declaredCount}
                onChange={(e) => setDeclaredCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-bold text-slate-900"
              />
            </div>

            <div className="flex items-end">
              <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200 w-full cursor-pointer">
                <input
                  type="checkbox"
                  checked={putOnKerb}
                  onChange={(e) => setPutOnKerb(e.target.checked)}
                  className="w-4 h-4 accent-emerald-600 rounded"
                />
                <span className="text-xs font-semibold text-slate-700">
                  Bag is out on kerb ready for Runner pickup
                </span>
              </label>
            </div>
          </div>

          {error && (
            <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={creating || (data !== null && !data.hasHousehold)}
            onClick={handleCreateBag}
            className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-display font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-colors"
          >
            <Plus size={18} />
            {creating ? "Generating Bag Tag..." : `Seal ${BAG_STREAMS[selectedStream].shortLabel} Bag & Generate QR Tag`}
          </button>

          <p className="text-[11px] text-slate-500 text-center">
            No printer? Write the short <strong>GSB-...</strong> code on masking tape with a Sharpie — Runners can verify either the QR or short code at your kerb.
          </p>
        </section>

        {/* Active & Printable QR Bag Labels */}
        <section className="space-y-3">
          <div className="print:hidden flex items-center justify-between">
            <h2 className="font-display font-bold text-base text-slate-900">
              Your Household QR Bag Tags ({data?.bags.length ?? 0})
            </h2>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-slate-400">Loading bag tags...</div>
          ) : (data?.bags.length ?? 0) === 0 ? (
            <div className="print:hidden rounded-2xl bg-white border border-slate-200 p-8 text-center">
              <QrCode size={36} className="text-slate-300 mx-auto mb-2" />
              <p className="font-bold text-sm text-slate-700">No sealed QR bags yet</p>
              <p className="text-xs text-slate-500 mt-1">
                Select one of the 4 streams above to generate your first kerbside QR bag label.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 print:grid-cols-2 print:gap-3">
              {data!.bags.map((bag) => {
                const streamInfo = BAG_STREAMS[bag.stream] ?? BAG_STREAMS.aluminium;
                const qrSrc = qrMap[bag.code];
                return (
                  <div
                    key={bag.id}
                    className="rounded-2xl bg-white border-2 border-slate-900/15 print:border-slate-900 p-4 flex flex-col justify-between gap-3 shadow-sm print:shadow-none break-inside-avoid"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className={`inline-block text-[11px] font-extrabold uppercase px-2.5 py-0.5 rounded-full ${streamInfo.badgeBg} ${streamInfo.badgeText}`}>
                          {streamInfo.label}
                        </span>
                        <p className="font-mono font-black text-base text-slate-900 mt-1.5 tracking-tight">
                          {bag.code}
                        </p>
                        <p className="text-xs text-slate-600 font-semibold mt-0.5">
                          {bag.declaredContainers} containers ({bag.linkedScanCount} scans linked)
                        </p>
                        {bag.verifiedContainers != null && (
                          <p className="text-xs text-emerald-700 font-bold mt-0.5">
                            Runner verified: {bag.verifiedContainers} containers
                          </p>
                        )}
                      </div>

                      {qrSrc && (
                        <img
                          src={qrSrc}
                          alt={`QR tag ${bag.code}`}
                          className="w-24 h-24 rounded-lg border border-slate-200 shrink-0"
                        />
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 print:hidden">
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-600">
                        {bag.status === "on_kerb" && (
                          <>
                            <Truck size={14} className="text-emerald-600" /> On Kerb for Runner
                          </>
                        )}
                        {bag.status === "sealed" && "Sealed Inside"}
                        {bag.status === "picked_up" && (
                          <>
                            <CheckCircle2 size={14} className="text-sky-600" /> Picked Up by Runner
                          </>
                        )}
                        {bag.status === "verified" && (
                          <>
                            <CheckCircle2 size={14} className="text-emerald-600" /> CRP Settled
                          </>
                        )}
                      </span>

                      {(bag.status === "sealed" || bag.status === "on_kerb") && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              handleStatusChange(bag.id, bag.status === "on_kerb" ? "sealed" : "on_kerb")
                            }
                            className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold text-xs"
                          >
                            {bag.status === "on_kerb" ? "Bring Inside" : "Put On Kerb"}
                          </button>
                          <button
                            type="button"
                            aria-label={`Cancel bag ${bag.code}`}
                            onClick={() => handleStatusChange(bag.id, "cancelled")}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="hidden print:block text-[10px] text-slate-600 border-t border-slate-300 pt-1.5">
                      THE GOOD SORT · Keep uncrushed &amp; lids off · Scan at kerb
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
