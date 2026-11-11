"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import {
  CheckCircle,
  SkipForward,
  Truck,
  Navigation,
  QrCode,
  Camera,
  AlertTriangle,
  X,
} from "lucide-react";
import { formatCents } from "@/lib/store";
import {
  BAG_STREAMS,
  DISCREPANCY_OPTIONS,
  type RunDetail,
  type RunStopDetail,
  type SortedBagDto,
  type DiscrepancyCode,
} from "@/lib/marketplace";
import { getStopManifest, scanBagAtStop } from "@/lib/marketplace-api";

interface RunActiveProps {
  run: RunDetail;
  onStart: () => void;
  onArrive: (stopId: string) => void;
  onPickup: (
    stopId: string,
    count: number,
    photoUrl?: string,
    discrepancy?: {
      contaminationFlag?: boolean;
      discrepancyCode?: DiscrepancyCode;
      discrepancyNote?: string;
    }
  ) => void;
  onSkip: (stopId: string) => void;
  onDeliver: () => void;
  onComplete: (depotVerifiedContainers?: number, coexDocketRef?: string) => void;
}

export function RunActive({
  run,
  onStart,
  onArrive,
  onPickup,
  onSkip,
  onDeliver,
  onComplete,
}: RunActiveProps) {
  const [pickupCount, setPickupCount] = useState<Record<string, number>>({});
  const [manifestBags, setManifestBags] = useState<SortedBagDto[]>([]);
  const [manualBagCode, setManualBagCode] = useState("");
  const [bagScanStatus, setBagScanStatus] = useState<string | null>(null);
  const [scanningCamera, setScanningCamera] = useState(false);
  const [discrepancyCode, setDiscrepancyCode] = useState<DiscrepancyCode>("none");
  const [contaminationFlag, setContaminationFlag] = useState(false);
  const [discrepancyNote, setDiscrepancyNote] = useState("");
  const [depotVerifiedInput, setDepotVerifiedInput] = useState<string>("");
  const [coexDocketRef, setCoexDocketRef] = useState<string>("");
  const [submittingComplete, setSubmittingComplete] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);

  const currentStop = run.stops.find((s) => s.status === "pending" || s.status === "arrived");
  const currentStopId = currentStop?.id ?? null;
  const completedStops = run.stops.filter((s) => s.status === "picked_up").length;
  const totalStops = run.stops.length;
  const allDone = run.stops.every((s) => s.status === "picked_up" || s.status === "skipped");

  const loadManifest = useCallback(async (stopId: string) => {
    const res = await getStopManifest(run.id, stopId);
    if (res) {
      setManifestBags(res.bags);
    }
  }, [run.id]);

  useEffect(() => {
    setDiscrepancyCode("none");
    setContaminationFlag(false);
    setDiscrepancyNote("");
    setBagScanStatus(null);
    setManualBagCode("");
    if (run.status === "in_progress" && currentStopId) {
      loadManifest(currentStopId);
    } else {
      setManifestBags([]);
    }
  }, [run.status, currentStopId, loadManifest]);

  const handleVerifyBagCode = useCallback(
    async (rawCode: string, declaredOverride?: number) => {
      if (!currentStopId) return;
      const cleaned = rawCode.trim().toUpperCase();
      if (!cleaned) return;
      const res = await scanBagAtStop(run.id, currentStopId, {
        bagCode: cleaned,
        verifiedContainers: declaredOverride,
        contaminationFlag,
        discrepancyCode,
        discrepancyNote: discrepancyNote.trim() || undefined,
      });
      if (!res) {
        setBagScanStatus(`Could not verify ${cleaned}. Check bag tag belongs to this stop.`);
        return;
      }
      setBagScanStatus(`Verified ${res.bag.code} (${res.bag.verifiedContainers ?? res.bag.declaredContainers} cans)`);
      setManualBagCode("");
      setPickupCount((prev) => ({
        ...prev,
        [currentStopId]: res.stopVerifiedTotal > 0 ? res.stopVerifiedTotal : (prev[currentStopId] ?? 0),
      }));
      await loadManifest(currentStopId);
    },
    [currentStopId, run.id, contaminationFlag, discrepancyCode, discrepancyNote, loadManifest]
  );

  useEffect(() => {
    if (!scanningCamera || !videoRef.current) {
      controlsRef.current?.stop();
      controlsRef.current = null;
      return;
    }

    let active = true;
    const reader = new BrowserMultiFormatReader();
    reader
      .decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (!active || !result) return;
        const text = result.getText().trim().toUpperCase();
        if (text.startsWith("GSB-")) {
          setScanningCamera(false);
          handleVerifyBagCode(text);
        }
      })
      .then((ctrls) => {
        if (active) controlsRef.current = ctrls;
        else ctrls.stop();
      })
      .catch(() => {
        if (active) {
          setBagScanStatus("Camera unavailable — enter the GSB-... code or tap Verify below.");
          setScanningCamera(false);
        }
      });

    return () => {
      active = false;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [scanningCamera, handleVerifyBagCode]);

  function openNavigation(stop: RunStopDetail) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving`;
    window.open(url, "_blank");
  }

  // ═══════ CLAIMED — Ready to start ═══════
  if (run.status === "claimed") {
    return (
      <>
        <div className="mb-5">
          <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Run claimed</p>
          <p className="text-xl font-display font-extrabold text-slate-900 mt-1">
            {run.stops.length} stops · {formatCents(run.estimatedPayoutCents)}
          </p>
          <p className="text-[13px] text-slate-400 mt-0.5">
            4-stream QR sorted bags on the kerb. ~{run.estimatedDurationMin} min · {run.perContainerCents}¢/container
          </p>
        </div>

        <div className="space-y-1.5 mb-5">
          {run.stops.map((stop, i) => (
            <div key={stop.id} className="flex items-center gap-3 py-2.5 px-3 glass rounded-xl border border-white/40">
              <span className="w-6 h-6 rounded-full bg-slate-200 text-[11px] font-bold text-slate-500 flex items-center justify-center flex-shrink-0">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-slate-700 font-medium truncate">
                  {stop.pickupInstruction || `Stop ${i + 1}`}
                </p>
                <p className="text-[11px] text-slate-400">~{stop.estimatedContainers} containers</p>
              </div>
              <button
                type="button"
                aria-label={`Navigate to stop ${i + 1}`}
                onClick={() => openNavigation(stop)}
                className="p-2 rounded-lg bg-blue-50 text-blue-600"
              >
                <Navigation className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onStart}
          className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-4 rounded-2xl text-[15px] shadow-lg shadow-green-600/20 min-h-[48px] active:scale-[0.98] transition-transform"
        >
          Start Collection
        </button>
      </>
    );
  }

  // ═══════ IN PROGRESS — Stop by stop with QR Bag Scan & Manifest ═══════
  if (run.status === "in_progress" && currentStop) {
    const count = pickupCount[currentStop.id] ?? currentStop.estimatedContainers;

    return (
      <>
        {/* Progress bar */}
        <div className="flex items-center gap-2 mb-4">
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-400 to-green-600 rounded-full transition-all duration-500"
              style={{ width: `${totalStops > 0 ? (completedStops / totalStops) * 100 : 0}%` }}
            />
          </div>
          <span className="text-[12px] text-slate-400 font-bold">{completedStops}/{totalStops}</span>
        </div>

        <div className="mb-3">
          <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">
            {currentStop.status === "arrived" ? "At kerbside stop" : "Next pickup"}
          </p>
          <p className="text-xl font-display font-extrabold text-slate-900 mt-0.5">
            {currentStop.pickupInstruction || `Stop ${currentStop.sequence + 1}`}
          </p>
          <p className="text-[12px] text-slate-500 mt-1">
            Expected ~{currentStop.estimatedContainers} pre-sorted containers. Scan QR bag tags or verify count below.
          </p>
        </div>

        {/* Navigate / Arrive */}
        {currentStop.status === "pending" && (
          <div className="flex gap-2 mb-4">
            <button
              type="button"
              onClick={() => openNavigation(currentStop)}
              className="flex-1 py-2.5 glass border border-blue-200 text-blue-600 font-bold rounded-xl text-[13px] flex items-center justify-center gap-2 min-h-[44px]"
            >
              <Navigation className="w-4 h-4" /> Navigate
            </button>
            <button
              type="button"
              onClick={() => onArrive(currentStop.id)}
              className="flex-1 py-2.5 bg-blue-500 text-white font-bold rounded-xl text-[13px] flex items-center justify-center gap-2 min-h-[44px]"
            >
              I&apos;ve Arrived
            </button>
          </div>
        )}

        {/* Kerbside QR Bag Manifest (available both before & after arrival) */}
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3.5 mb-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
              <QrCode className="w-3.5 h-3.5 text-emerald-600" />
              Kerbside QR Bag Manifest ({manifestBags.length})
            </span>
            <button
              type="button"
              onClick={() => setScanningCamera((v) => !v)}
              className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-[11px] font-bold flex items-center gap-1"
            >
              {scanningCamera ? <X className="w-3 h-3" /> : <Camera className="w-3 h-3" />}
              {scanningCamera ? "Close Camera" : "Scan QR Tag"}
            </button>
          </div>

          {scanningCamera && (
            <div className="rounded-xl overflow-hidden bg-black relative">
              <video ref={videoRef} className="w-full h-40 object-cover" muted playsInline />
              <p className="text-[11px] text-white/90 text-center py-1 bg-slate-900">
                Point camera at GSB-... QR label on bag
              </p>
            </div>
          )}

          {manifestBags.length > 0 && (
            <div className="space-y-1.5">
              {manifestBags.map((bag) => {
                const sInfo = BAG_STREAMS[bag.stream] ?? BAG_STREAMS.aluminium;
                const picked = bag.status === "picked_up";
                return (
                  <div
                    key={bag.id}
                    className="flex items-center justify-between gap-2 bg-white rounded-xl px-3 py-2 border border-slate-200"
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded ${sInfo.badgeBg} ${sInfo.badgeText}`}>
                          {sInfo.shortLabel}
                        </span>
                        <span className="font-mono font-bold text-xs text-slate-900">{bag.code}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Declared: {bag.declaredContainers} cans
                      </p>
                    </div>
                    {picked ? (
                      <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5" /> Scanned
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleVerifyBagCode(bag.code, bag.declaredContainers)}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold text-[11px]"
                      >
                        Verify Bag
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex gap-1.5">
            <input
              type="text"
              value={manualBagCode}
              onChange={(e) => setManualBagCode(e.target.value.toUpperCase())}
              placeholder="Or type Sharpie code e.g. GSB-ALU-..."
              className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-mono text-slate-900"
            />
            <button
              type="button"
              onClick={() => handleVerifyBagCode(manualBagCode)}
              disabled={!manualBagCode.trim()}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 disabled:opacity-40 text-white text-xs font-bold"
            >
              Verify
            </button>
          </div>

          {bagScanStatus && (
            <p className="text-[11px] font-semibold text-emerald-700">{bagScanStatus}</p>
          )}
        </div>

        {/* Pickup controls (shown after arriving) */}
        {currentStop.status === "arrived" && (
          <>
            {/* Container count adjuster */}
            <div className="glass rounded-xl p-3 border border-white/40 mb-3">
              <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-[0.08em] mb-2">
                Verified container count
              </p>
              <div className="flex items-center gap-3 justify-center">
                <button
                  type="button"
                  aria-label="Decrease container count by 5"
                  onClick={() => setPickupCount({ ...pickupCount, [currentStop.id]: Math.max(0, count - 5) })}
                  className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 font-bold text-lg flex items-center justify-center"
                >
                  −
                </button>
                <input
                  type="number"
                  aria-label="Verified containers at stop"
                  min={0}
                  max={200}
                  value={count}
                  onChange={(e) =>
                    setPickupCount({
                      ...pickupCount,
                      [currentStop.id]: Math.max(0, Math.min(200, Number(e.target.value) || 0)),
                    })
                  }
                  className="w-20 text-2xl font-display font-extrabold text-slate-900 text-center bg-transparent border-b border-slate-200 focus:outline-none"
                />
                <button
                  type="button"
                  aria-label="Increase container count by 5"
                  onClick={() => setPickupCount({ ...pickupCount, [currentStop.id]: count + 5 })}
                  className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 font-bold text-lg flex items-center justify-center"
                >
                  +
                </button>
              </div>
            </div>

            {/* Discrepancy & Contamination Manifest */}
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 mb-3 space-y-2">
              <label className="block text-[11px] font-bold text-slate-600">
                Stream Quality / Discrepancy Check
              </label>
              <select
                aria-label="Discrepancy status"
                value={discrepancyCode}
                onChange={(e) => {
                  const val = e.target.value as DiscrepancyCode;
                  setDiscrepancyCode(val);
                  if (val === "mixed_streams" || val === "crushed_or_ineligible") {
                    setContaminationFlag(true);
                  }
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 font-medium"
              >
                {DISCREPANCY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={contaminationFlag}
                  onChange={(e) => setContaminationFlag(e.target.checked)}
                  className="accent-amber-600"
                />
                <span className="flex items-center gap-1 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  Flag stream contamination / mixed glass-plastic
                </span>
              </label>

              {(discrepancyCode !== "none" || contaminationFlag) && (
                <input
                  type="text"
                  value={discrepancyNote}
                  onChange={(e) => setDiscrepancyNote(e.target.value)}
                  placeholder="Short note (optional)"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                />
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  onPickup(currentStop.id, count, undefined, {
                    contaminationFlag,
                    discrepancyCode,
                    discrepancyNote: discrepancyNote.trim() || undefined,
                  })
                }
                className="flex-1 bg-gradient-to-b from-green-500 to-green-600 text-white font-bold py-3.5 rounded-xl text-[13px] flex items-center justify-center gap-2 shadow-lg shadow-green-600/20 min-h-[44px] active:scale-[0.98] transition-transform"
              >
                <CheckCircle className="w-4 h-4" /> Confirm Pickup
              </button>
              <button
                type="button"
                onClick={() => onSkip(currentStop.id)}
                className="px-4 py-3.5 glass border border-white/40 text-slate-500 font-bold rounded-xl text-[13px] flex items-center gap-1.5 min-h-[44px]"
              >
                <SkipForward className="w-4 h-4" /> Skip
              </button>
            </div>
          </>
        )}
      </>
    );
  }

  // ═══════ ALL STOPS DONE — Head to drop point ═══════
  if (run.status === "in_progress" && allDone) {
    return (
      <div className="text-center py-4">
        <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">All stops complete</p>
        <p className="text-xl font-display font-extrabold text-slate-900 mt-2">Head to Drop Point</p>
        {run.dropPoint && (
          <p className="text-[13px] text-slate-400 mt-1">{run.dropPoint.name}</p>
        )}
        <div className="flex gap-2 mt-4">
          {run.dropPoint && (
            <button
              type="button"
              onClick={() => {
                const url = `https://www.google.com/maps/dir/?api=1&destination=${run.dropPoint!.lat},${run.dropPoint!.lng}&travelmode=driving`;
                window.open(url, "_blank");
              }}
              className="flex-1 py-3 glass border border-blue-200 text-blue-600 font-bold rounded-xl text-[13px] flex items-center justify-center gap-2 min-h-[44px]"
            >
              <Navigation className="w-4 h-4" /> Navigate
            </button>
          )}
          <button
            type="button"
            onClick={onDeliver}
            className="flex-1 bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3 rounded-xl text-[13px] shadow-lg shadow-green-600/20 min-h-[44px] active:scale-[0.98] transition-transform"
          >
            <Truck className="w-4 h-4 inline mr-1" /> Mark Delivering
          </button>
        </div>
      </div>
    );
  }

  // ═══════ DELIVERING OR COMPLETED — Confirm CRP Docket & Settle ═══════
  if (run.status === "delivering" || run.status === "completed") {
    const collected = run.stops.filter((s) => s.status === "picked_up");
    const kerbsideContainers = collected.reduce(
      (sum, s) => sum + (s.actualContainers ?? s.estimatedContainers),
      0
    );
    const parsedVerified =
      depotVerifiedInput.trim() === ""
        ? kerbsideContainers
        : Math.max(0, Number(depotVerifiedInput) || 0);

    return (
      <>
        <div className="mb-4">
          <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">
            {run.status === "completed" ? "Ready to settle payout" : "At Depot Drop-off"}
          </p>
          <p className="text-xl font-display font-extrabold text-slate-900 mt-1">
            {run.dropPoint?.name || "Depot Drop Point"}
          </p>
        </div>

        <div className="glass rounded-2xl p-4 border border-white/40 shadow-sm mb-4 space-y-2.5">
          <div className="flex justify-between items-center">
            <span className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Collected Stops</span>
            <span className="text-slate-900 font-bold">{collected.length} of {totalStops} stops</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Kerbside Count</span>
            <span className="text-slate-900 font-bold">{kerbsideContainers}</span>
          </div>
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Depot verified count
              </label>
              <input
                type="number"
                min={0}
                value={depotVerifiedInput === "" ? kerbsideContainers : depotVerifiedInput}
                onChange={(e) => setDepotVerifiedInput(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Depot docket reference (optional)
              </label>
              <input
                type="text"
                value={coexDocketRef}
                onChange={(e) => setCoexDocketRef(e.target.value)}
                placeholder="e.g. DOCKET-1042"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-900"
              />
            </div>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-slate-100">
            <span className="text-[12px] text-slate-400 font-semibold uppercase tracking-[0.12em]">Runner Payout</span>
            <span className="text-green-600 font-display font-extrabold text-xl">
              {formatCents(parsedVerified * run.perContainerCents)}
            </span>
          </div>
        </div>

        <button
          type="button"
          disabled={submittingComplete}
          onClick={async () => {
            setSubmittingComplete(true);
            await onComplete(parsedVerified, coexDocketRef.trim() || undefined);
            setSubmittingComplete(false);
          }}
          className="w-full bg-gradient-to-b from-green-500 to-green-600 disabled:opacity-50 text-white font-extrabold py-4 rounded-2xl text-[15px] shadow-lg shadow-green-600/20 flex items-center justify-center gap-2 min-h-[48px] active:scale-[0.98] transition-transform"
        >
          <Truck className="w-5 h-5" />
          {submittingComplete ? "Settling Run..." : "Confirm Drop-off & Settle Payout"}
        </button>
      </>
    );
  }

  return null;
}
