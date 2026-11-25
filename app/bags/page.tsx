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
  Trash2,
  Plus,
  Home,
} from "lucide-react";
import {
  getMyBags,
  createSortedBag,
  updateBagStatus,
} from "@/lib/marketplace-api";
import { hasValidToken } from "@/lib/config";
import { track } from "@/lib/analytics";
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
  const [declaredCount, setDeclaredCount] = useState<number>(0);
  const [putOnKerb, setPutOnKerb] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [signedIn, setSignedIn] = useState<boolean>(true);
  const [creating, setCreating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadBags = useCallback(async (preferredStream?: BagStream) => {
    const authed = hasValidToken();
    setSignedIn(authed);
    if (!authed) {
      setData(null);
      setLoading(false);
      return;
    }
    const res = await getMyBags();
    setData(res);
    setLoading(false);
    if (res) {
      const streams = Object.keys(BAG_STREAMS) as BagStream[];
      const chosen =
        preferredStream && (res.unbaggedByStream[preferredStream] ?? 0) > 0
          ? preferredStream
          : streams.find((s) => (res.unbaggedByStream[s] ?? 0) > 0) ?? preferredStream ?? "aluminium";
      setSelectedStream(chosen);
      setDeclaredCount(Math.min(500, res.unbaggedByStream[chosen] ?? 0));
    }
  }, []);

  useEffect(() => {
    loadBags();
  }, [loadBags]);

  const selectedUnbagged = data?.unbaggedByStream?.[selectedStream] ?? 0;
  const maxBagCount = Math.min(500, selectedUnbagged);
  const effectiveBagCount = selectedUnbagged > 0 ? Math.max(1, Math.min(maxBagCount, declaredCount || selectedUnbagged)) : 0;

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
    setError(null);
    const unbagged = data?.unbaggedByStream?.[s] ?? 0;
    setDeclaredCount(Math.min(500, unbagged));
  };

  const handleCreateBag = async () => {
    if (selectedUnbagged <= 0) {
      setError(`Scan at least 1 ${BAG_STREAMS[selectedStream].shortLabel.toLowerCase()} container before creating this bag tag.`);
      return;
    }
    setCreating(true);
    setError(null);
    const created = await createSortedBag(selectedStream, effectiveBagCount, putOnKerb);
    setCreating(false);
    if (!created) {
      setError("Could not create bag tag. Save your home street address first.");
      return;
    }
    track("bag_tagged");
    await loadBags(selectedStream);
  };

  const handleStatusChange = async (bagId: string, status: "sealed" | "on_kerb" | "cancelled") => {
    setError(null);
    const updated = await updateBagStatus(bagId, status);
    if (!updated) {
      setError("Could not update bag status — a Runner may have already scanned this bag.");
    }
    await loadBags(selectedStream);
  };

  const STREAM_GLASS: Record<BagStream, string> = {
    aluminium: "liquid-glass-blue",
    pet_clear: "liquid-glass-teal",
    pet_coloured: "liquid-glass-amber",
    glass: "liquid-glass-green",
  };

  return (
    <div className="relative min-h-dvh text-white print:bg-white print:text-slate-900 pb-16 overflow-x-clip">
      {/* Full-bleed sunlit Brisbane backdrop for tinted Liquid Glass (hidden when printing QR tags) */}
      <div className="print:hidden fixed inset-0 z-0 pointer-events-none select-none overflow-hidden" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/brisbane-veranda-glass.webp"
          alt=""
          className="h-full w-full object-cover object-center scale-[1.03]"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(6,15,17,0.48) 0%, rgba(8,18,18,0.42) 48%, rgba(6,15,15,0.72) 100%)",
          }}
        />
      </div>

      {/* Screen Header (hidden when printing) */}
      <header className="print:hidden sticky top-0 z-20 px-4 pt-3 pb-2" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <div className="max-w-3xl mx-auto rounded-full liquid-glass px-2.5 py-2 flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <Link
              href="/sort"
              aria-label="Back to home"
              className="w-10 h-10 shrink-0 rounded-full liquid-glass-pill flex items-center justify-center text-white hover:bg-white/25"
            >
              <ArrowLeft size={18} />
            </Link>
            <div className="min-w-0">
              <h1 className="font-display font-extrabold text-base text-white leading-tight truncate glass-text-shadow">
                Home Bag Tags
              </h1>
              <p className="text-xs text-white/80 leading-snug line-clamp-1">
                Tag full bags so your scanned cans clear on kerb pickup
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/scan"
              className="inline-flex items-center justify-center min-h-[40px] px-3.5 py-2 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs whitespace-nowrap shadow-sm"
            >
              + Scan
            </Link>
            {(data?.bags.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-full bg-white/95 hover:bg-white text-slate-950 font-bold text-xs whitespace-nowrap shadow-sm"
              >
                <Printer size={14} /> Print Tags
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-3xl mx-auto px-4 py-5 space-y-6">
        {/* Sign-in / Household prerequisite checks */}
        {!loading && !signedIn && (
          <div className="print:hidden rounded-2xl liquid-glass-amber p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Home size={20} className="text-amber-200 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm text-white">Scan a container or sign in first</p>
                <p className="text-xs text-white/85 mt-0.5">
                  Home bag tags link to your account and street address so we can collect your bags and pay you 10¢ per container.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link
                href="/scan"
                className="px-4 py-2 rounded-full bg-emerald-500 text-slate-950 font-bold text-xs whitespace-nowrap"
              >
                Scan a can
              </Link>
              <Link
                href="/login"
                className="px-4 py-2 rounded-full bg-white/95 text-slate-950 font-bold text-xs whitespace-nowrap"
              >
                Sign in
              </Link>
            </div>
          </div>
        )}

        {!loading && signedIn && data && !data.hasHousehold && (
          <div className="print:hidden rounded-2xl liquid-glass-amber p-4 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Home size={20} className="text-amber-200 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm text-white">Add your home address first</p>
                <p className="text-xs text-white/85 mt-0.5">
                  Bag tags link to your house so the driver knows whose account to credit at the kerb.
                </p>
              </div>
            </div>
            <Link
              href="/onboard"
              className="px-4 py-2 rounded-full bg-white/95 text-slate-950 font-bold text-xs whitespace-nowrap"
            >
              Set Address
            </Link>
          </div>
        )}

        {/* Create New 4-Stream Bag Tag (hidden on print) */}
        <section className="print:hidden rounded-[28px] liquid-glass p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display font-extrabold text-lg text-white glass-text-shadow">
              Tag a full bag at home
            </h2>
            <Link
              href="/scan"
              className="inline-flex items-center min-h-[40px] px-2 -mr-2 text-xs font-bold text-emerald-300 hover:text-emerald-200 whitespace-nowrap shrink-0"
            >
              + Scan a container
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(Object.keys(BAG_STREAMS) as BagStream[]).map((key) => {
              const info = BAG_STREAMS[key];
              const unbagged = data?.unbaggedByStream?.[key] ?? 0;
              const active = selectedStream === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleSelectStream(key)}
                  className={`text-left p-4 rounded-2xl transition-all ${STREAM_GLASS[key]} ${
                    active ? "ring-2 ring-white/90 scale-[1.01]" : "opacity-85 hover:opacity-100"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display font-bold text-[15px] text-white">
                      {info.label}
                    </span>
                    <span className="text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-white/90 text-slate-900">
                      {info.codePrefix}
                    </span>
                  </div>
                  <p className="text-[11px] text-white/85 mt-1 leading-relaxed">{info.rule}</p>
                  <p className={`text-[12px] font-bold mt-2 ${unbagged > 0 || loading ? "text-emerald-200" : "text-white/70"}`}>
                    {loading ? (
                      <span className="inline-block h-3 w-32 rounded-full bg-white/30 animate-pulse align-middle" aria-label="Checking scanned containers" />
                    ) : (
                      `${unbagged} scanned ${unbagged === 1 ? "container" : "containers"} ready to bag`
                    )}
                  </p>
                </button>
              );
            })}
          </div>

          {!loading && selectedUnbagged === 0 ? (
            <div className="rounded-2xl liquid-glass-subtle p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-white">
                  No scanned {BAG_STREAMS[selectedStream].label.toLowerCase()} ready to bag yet
                </p>
                <p className="text-[11px] text-white/75 mt-0.5">
                  Bag tags link directly to your scanned inventory so every container clears cleanly at pickup.
                </p>
              </div>
              <Link
                href="/scan"
                className="inline-flex items-center justify-center rounded-full bg-emerald-500 hover:bg-emerald-400 px-4 py-2.5 text-xs font-bold text-slate-950 whitespace-nowrap"
              >
                + Scan {BAG_STREAMS[selectedStream].shortLabel}
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label htmlFor="declared-count" className="block text-xs font-bold text-white mb-1">
                  Scanned containers to include{" "}
                  <span className="font-semibold text-emerald-300">
                    ({selectedUnbagged} in inventory)
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="declared-count"
                    type="number"
                    min={1}
                    max={Math.max(1, maxBagCount)}
                    value={effectiveBagCount}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setDeclaredCount(
                        Number.isFinite(next)
                          ? Math.max(1, Math.min(Math.max(1, maxBagCount), Math.floor(next)))
                          : Math.max(1, maxBagCount),
                      );
                    }}
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white/95 border border-white text-base font-bold text-slate-900 tabular-nums"
                  />
                  {effectiveBagCount < maxBagCount && (
                    <button
                      type="button"
                      onClick={() => setDeclaredCount(maxBagCount)}
                      className="shrink-0 px-3 py-2.5 rounded-xl liquid-glass-pill text-xs font-bold text-white hover:bg-white/25"
                    >
                      All {maxBagCount}
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-white/80 mt-1">
                  Links {effectiveBagCount} scanned {effectiveBagCount === 1 ? "container" : "containers"} (${(effectiveBagCount * 0.1).toFixed(2)} credit once verified at depot).
                </p>
              </div>

              <div className="flex items-start sm:items-end">
                <label className="flex items-center gap-2.5 p-3 rounded-xl liquid-glass-subtle w-full cursor-pointer">
                  <input
                    type="checkbox"
                    checked={putOnKerb}
                    onChange={(e) => setPutOnKerb(e.target.checked)}
                    className="w-4 h-4 accent-emerald-400 rounded"
                  />
                  <span className="text-xs font-semibold text-white">
                    Bag is out on the kerb ready for pickup
                  </span>
                </label>
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={creating || loading || !signedIn || !data || !data.hasHousehold || selectedUnbagged <= 0}
            onClick={handleCreateBag}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-b from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 disabled:opacity-50 text-white font-display font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-green-600/20 transition-all"
          >
            <Plus size={18} />
            {creating
              ? "Creating tag..."
              : selectedUnbagged > 0
                ? `Create ${BAG_STREAMS[selectedStream].shortLabel} Bag Tag (${effectiveBagCount} scanned)`
                : `Scan ${BAG_STREAMS[selectedStream].shortLabel} containers first`}
          </button>

          <p className="text-[11px] text-white/75 text-center">
            No printer? Write the short <strong className="text-white">GSB-...</strong> code on masking tape with a marker — our driver can scan the QR or enter the code at your kerb.
          </p>
        </section>

        {/* Active & Printable QR Bag Labels */}
        <section className="space-y-3">
          <div className="print:hidden flex items-center justify-between">
            <h2 className="font-display font-bold text-base text-white glass-text-shadow">
              Your Home Bag Tags ({loading ? "…" : (data?.bags.length ?? 0)})
            </h2>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-white/75">Loading bag tags...</div>
          ) : (data?.bags.length ?? 0) === 0 ? (
            <div className="print:hidden rounded-[24px] liquid-glass p-8 text-center">
              <QrCode size={36} className="text-white/50 mx-auto mb-2" />
              <p className="font-bold text-sm text-white">No tagged bags yet</p>
              <p className="text-xs text-white/75 mt-1">
                Pick one of the 4 bags above when a bag at home is full.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 print:grid-cols-2 print:gap-3 text-slate-900">
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
                        <p className="text-xs text-slate-600 mt-0.5">
                          <strong>{bag.declaredContainers}</strong> containers
                          {bag.linkedScanCount > 0 && ` · ${bag.linkedScanCount} scans linked`}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {streamInfo.rule}
                        </p>
                      </div>

                      {qrSrc && (
                        <img
                          src={qrSrc}
                          alt={`QR tag ${bag.code}`}
                          className="w-24 h-24 rounded-lg border border-slate-200 shrink-0"
                        />
                      )}
                    </div>

                    <div className="print:hidden pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-xs font-bold">
                        {bag.status === "verified" ? (
                          <span className="text-emerald-700 flex items-center gap-1">
                            <CheckCircle2 size={14} /> Verified at depot ({bag.verifiedContainers ?? bag.declaredContainers})
                          </span>
                        ) : bag.status === "picked_up" ? (
                          <span className="text-blue-700 flex items-center gap-1">
                            <Truck size={14} /> Collected — in transit ({bag.verifiedContainers ?? bag.declaredContainers})
                          </span>
                        ) : bag.status === "on_kerb" ? (
                          <span className="text-amber-700 flex items-center gap-1">
                            <Truck size={14} /> Out on kerb
                          </span>
                        ) : (
                          <span className="text-slate-600">Ready at home</span>
                        )}
                      </span>

                      {bag.status !== "verified" && bag.status !== "picked_up" && (
                        <div className="flex items-center gap-1.5">
                          {bag.status === "sealed" ? (
                            <button
                              type="button"
                              onClick={() => handleStatusChange(bag.id, "on_kerb")}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold"
                            >
                              Put on Kerb
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleStatusChange(bag.id, "sealed")}
                              className="px-2.5 py-1 rounded-lg bg-slate-200 text-slate-700 text-[11px] font-bold"
                            >
                              Bring Inside
                            </button>
                          )}
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

                    <div className="hidden print:block pt-2 border-t border-dashed border-slate-300 text-[10px] text-slate-600 font-semibold">
                      The Good Sort · Tape to bag neck before kerb pickup · thegoodsort.org
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
