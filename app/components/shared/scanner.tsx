"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { X, Camera, ScanBarcode, Plus, Minus, Check, RotateCcw } from "lucide-react";
import { lookupContainer, lookupContainerAsync } from "@/lib/containers";
import { apiUrl } from "@/lib/config";
import { addScan, getBagForMaterial, mapToMaterialType, SORTER_PAYOUT_CENTS, BAGS, type BagInfo } from "@/lib/store";
import { addScanApi } from "@/lib/store-api";

function getStoredUserId(): string {
  try { return JSON.parse(localStorage.getItem("goodsort_profile") || "{}").id || ""; } catch { return ""; }
}

interface ScannerProps {
  onClose: () => void;
  onScanComplete: (containerName: string, cents: number, bag: BagInfo) => void;
  onBatchComplete?: (totalItems: number, totalCents: number) => void;
}

type ScanMode = "photo" | "barcode";

interface IdentifiedItem {
  name: string;
  material: string;
  count: number;
  eligible: boolean;
}

export function Scanner({ onClose, onScanComplete, onBatchComplete }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processedRef = useRef(false);
  const [mode, setMode] = useState<ScanMode>("photo");
  const [scanning, setScanning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [results, setResults] = useState<IdentifiedItem[] | null>(null);
  const [resultSummary, setResultSummary] = useState("");
  const [confirming, setConfirming] = useState(false);

  // Barcode mode state
  const [manualBarcode, setManualBarcode] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [scanResult, setScanResult] = useState<{ name: string; bag: BagInfo | null } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
  }, []);

  const startCamera = useCallback(async () => {
    setScanning(true);
    setCameraFailed(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await new Promise<void>((resolve) => {
          if (videoRef.current!.readyState >= 1) resolve();
          else videoRef.current!.addEventListener("loadedmetadata", () => resolve(), { once: true });
        });
        await videoRef.current.play();
      }

      // In barcode mode, start detection
      if (mode === "barcode") {
        if ("BarcodeDetector" in window) {
          // Native BarcodeDetector (Chrome Android, Safari 17.2+)
          const detector = new (window as unknown as {
            BarcodeDetector: new (opts: { formats: string[] }) => { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
          }).BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });

          scanIntervalRef.current = setInterval(async () => {
            if (!videoRef.current || videoRef.current.readyState !== 4 || processedRef.current) return;
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes.length > 0) processBarcodeResult(barcodes[0].rawValue);
            } catch { /* continue */ }
          }, 250);
        } else {
          // ZXing fallback for iOS Safari and older browsers
          try {
            const { BrowserMultiFormatReader } = await import("@zxing/browser");
            const reader = new BrowserMultiFormatReader();
            reader.decodeFromVideoElement(videoRef.current!, (result) => {
              if (result && !processedRef.current) {
                processBarcodeResult(result.getText());
              }
            });
          } catch {
            // ZXing failed — show manual entry
            setShowManual(true);
          }
        }
      }
    } catch {
      setCameraFailed(true);
      setScanning(false);
    }
  }, [mode]);

  useEffect(() => {
    startCamera();
    return () => { stopCamera(); if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [startCamera, stopCamera]);

  // ── Photo capture ──
  async function capturePhoto() {
    if (!videoRef.current || !canvasRef.current) return;
    setAnalyzing(true);

    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0);
    const base64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];

    stopCamera();

    try {
      const res = await fetch(apiUrl("/api/scan/photo"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64 }),
      });

      if (!res.ok) {
        setAnalyzing(false);
        setResults([]);
        setResultSummary("Failed to analyze photo");
        return;
      }

      const data = await res.json();
      setResults(data.containers || []);
      setResultSummary(data.summary || "No containers found");
    } catch {
      setResults([]);
      setResultSummary("Failed to connect to server");
    }
    setAnalyzing(false);
  }

  // ── Confirm batch ──
  async function confirmBatch() {
    if (!results || results.length === 0) return;
    setConfirming(true);

    // Use localStorage addScan for each item (works offline too)
    const eligible = results.filter((r) => r.eligible);
    let totalItems = 0;
    let totalCents = 0;

    for (const item of eligible) {
      for (let i = 0; i < item.count; i++) {
        addScanApi("PHOTO", item.name, item.material);
        totalItems++;
        totalCents += SORTER_PAYOUT_CENTS;
      }
    }

    // Also try to confirm via API
    try {
      await fetch(apiUrl("/api/scan/photo/confirm"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: getStoredUserId(),
          items: eligible,
        }),
      });
    } catch { /* localStorage already handled it */ }

    setConfirming(false);
    if (onBatchComplete) {
      onBatchComplete(totalItems, totalCents);
    }
    onClose();
  }

  // ── Update item count ──
  function updateCount(index: number, delta: number) {
    if (!results) return;
    const updated = [...results];
    updated[index] = { ...updated[index], count: Math.max(0, updated[index].count + delta) };
    setResults(updated);
  }

  // ── Barcode processing ──
  async function processBarcodeResult(barcode: string) {
    if (processedRef.current) return;
    const cleaned = barcode.trim().replace(/\D/g, "");
    if (cleaned.length < 8 || cleaned.length > 13) return;
    processedRef.current = true;
    stopCamera();

    let container = lookupContainer(cleaned);
    if (!container) {
      setScanResult({ name: "Looking up...", bag: null });
      container = await lookupContainerAsync(cleaned);
    }

    const materialType = mapToMaterialType(container.material);
    const bag = getBagForMaterial(materialType);
    addScanApi(cleaned, container.name, container.material);

    setScanResult({ name: container.name, bag });
    timeoutRef.current = setTimeout(() => {
      setScanResult(null);
      onScanComplete(container!.name, SORTER_PAYOUT_CENTS, bag);
    }, 2000);
  }

  function handleClose() { stopCamera(); onClose(); }

  function retake() {
    setResults(null);
    setResultSummary("");
    processedRef.current = false;
    startCamera();
  }

  // ── Results Screen ──
  if (results !== null) {
    const eligible = results.filter((r) => r.eligible);
    const totalItems = eligible.reduce((s, r) => s + r.count, 0);
    const totalCents = totalItems * SORTER_PAYOUT_CENTS;

    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col" style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="flex justify-between items-center px-5 py-3">
          <h2 className="text-[17px] font-display font-extrabold text-slate-900">
            {totalItems > 0 ? `${totalItems} container${totalItems !== 1 ? "s" : ""} found` : "No containers found"}
          </h2>
          <button onClick={handleClose} className="p-2.5 text-slate-400 hover:text-slate-600 min-w-[44px] min-h-[44px] flex items-center justify-center">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5">
          {results.length === 0 ? (
            <div className="text-center py-12">
              <Camera className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-400 text-[13px]">No containers detected. Try again with better lighting.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {results.map((item, i) => {
                const bagMat = mapToMaterialType(item.material);
                const bag = getBagForMaterial(bagMat);
                return (
                  <div key={i} className={`flex items-center gap-3 p-3 rounded-2xl border ${item.eligible ? "bg-white border-slate-200" : "bg-slate-50 border-slate-100 opacity-50"}`}>
                    <div className={`w-8 h-8 ${bag.color} rounded-lg flex-shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-slate-900 font-medium truncate">{item.name}</p>
                      <p className="text-[11px] text-slate-400">{bag.label} &middot; {item.eligible ? "5c credit" : "Not eligible"}</p>
                    </div>
                    {item.eligible && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => updateCount(i, -1)} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center min-w-[32px]">
                          <Minus className="w-3.5 h-3.5 text-slate-500" />
                        </button>
                        <span className="text-[15px] font-bold text-slate-900 w-6 text-center">{item.count}</span>
                        <button onClick={() => updateCount(i, 1)} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center min-w-[32px]">
                          <Plus className="w-3.5 h-3.5 text-slate-500" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bottom actions */}
        <div className="px-5 py-4 border-t border-slate-100">
          {totalItems > 0 && (
            <div className="flex justify-between items-center mb-3">
              <span className="text-[13px] text-slate-500">{totalItems} items</span>
              <span className="text-[17px] font-display font-extrabold text-green-600">+${(totalCents / 100).toFixed(2)} pending</span>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={retake}
              className="flex-1 py-3.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-[13px] flex items-center justify-center gap-2 min-h-[48px]">
              <RotateCcw className="w-4 h-4" /> Retake
            </button>
            {totalItems > 0 && (
              <button onClick={confirmBatch} disabled={confirming}
                className="flex-[2] bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 flex items-center justify-center gap-2 min-h-[48px]">
                <Check className="w-5 h-5" /> {confirming ? "Saving..." : "Confirm"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Barcode scan result overlay ──
  if (scanResult) {
    const { name, bag } = scanResult;
    if (!bag) {
      return (
        <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center">
          <div className="text-center px-8">
            <div className="w-24 h-24 bg-slate-700 rounded-3xl flex items-center justify-center mx-auto mb-6 animate-pulse">
              <ScanBarcode className="w-10 h-10 text-slate-400" />
            </div>
            <p className="text-white/50 text-lg font-medium">Looking up container...</p>
          </div>
        </div>
      );
    }
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center">
        <div className="animate-slide-up text-center px-8">
          <div className={`w-24 h-24 ${bag.color} rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl`}>
            <span className="text-4xl">{bag.emoji}</span>
          </div>
          <p className="text-white/50 text-sm mb-2">{name}</p>
          <p className="text-white text-2xl font-display font-extrabold mb-2">Put in the {bag.label}</p>
          <p className="text-green-400 text-lg font-bold">+{SORTER_PAYOUT_CENTS}c pending</p>
          <div className={`mt-8 mx-auto w-48 h-2 ${bag.color} rounded-full opacity-60`} />
        </div>
      </div>
    );
  }

  // ── Analyzing overlay ──
  if (analyzing) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center">
        <div className="text-center px-8">
          <div className="w-24 h-24 bg-green-600/20 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <Camera className="w-10 h-10 text-green-400 animate-pulse" />
          </div>
          <p className="text-white text-xl font-display font-extrabold mb-2">Analyzing...</p>
          <p className="text-white/40 text-[13px]">Identifying containers in your photo</p>
        </div>
      </div>
    );
  }

  // ── Camera View ──
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      {/* Header */}
      <div className="flex justify-between items-center px-5 pb-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 16px) + 0.25rem)" }}>
        <div className="flex items-center gap-2.5">
          <Camera className="w-5 h-5 text-green-400" />
          <h2 className="text-[15px] font-display font-bold text-white">
            {mode === "photo" ? "Photo Scan" : "Barcode Scan"}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <button onClick={() => { stopCamera(); processedRef.current = false; setMode(mode === "photo" ? "barcode" : "photo"); }}
            className="px-3 py-1.5 rounded-full bg-white/10 text-white/70 text-[11px] font-bold">
            {mode === "photo" ? "Barcode" : "Photo"}
          </button>
          <button onClick={handleClose} className="p-2.5 hover:bg-white/5 rounded-full min-w-[44px] min-h-[44px] flex items-center justify-center">
            <X className="w-5 h-5 text-neutral-400" />
          </button>
        </div>
      </div>

      {/* Camera feed */}
      <div className="flex-1 relative">
        {!cameraFailed && <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />}
        <canvas ref={canvasRef} className="hidden" />

        {cameraFailed && (
          <div className="flex items-center justify-center h-full">
            <p className="text-neutral-600 text-[13px]">Camera not available</p>
          </div>
        )}

        {/* Photo mode: frame guide */}
        {mode === "photo" && scanning && !cameraFailed && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-[80%] h-[60%] border-2 border-white/20 rounded-3xl">
              <p className="text-white/40 text-[11px] text-center mt-4">Place containers in frame</p>
            </div>
          </div>
        )}

        {/* Barcode mode: scan line */}
        {mode === "barcode" && scanning && !cameraFailed && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-56 h-56 rounded-2xl border-2 border-green-400/30 relative">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-green-400 rounded-tl-2xl" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-green-400 rounded-tr-2xl" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-green-400 rounded-bl-2xl" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-green-400 rounded-br-2xl" />
              <div className="absolute inset-x-4 top-1/2 h-0.5 bg-green-400/60 animate-pulse" />
            </div>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="bg-black/80 px-5 py-4">
        {mode === "photo" ? (
          <div className="flex flex-col items-center gap-3">
            <button onClick={capturePhoto} disabled={!scanning || cameraFailed}
              className="w-16 h-16 rounded-full bg-white border-4 border-white/30 shadow-lg active:scale-90 transition-transform disabled:opacity-30" />
            <p className="text-white/30 text-[11px] text-center">
              Lay containers on a surface and take a photo
            </p>
          </div>
        ) : (
          <div>
            {!showManual && (
              <button onClick={() => setShowManual(true)} className="text-neutral-500 text-[13px] font-medium w-full text-center">
                Enter barcode manually
              </button>
            )}
            {showManual && (
              <form onSubmit={(e) => { e.preventDefault(); if (manualBarcode.trim()) processBarcodeResult(manualBarcode.trim()); }} className="flex gap-2">
                <input type="text" inputMode="numeric" value={manualBarcode} onChange={(e) => setManualBarcode(e.target.value)}
                  placeholder="Enter barcode..." autoFocus
                  className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white text-base placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-green-500/30" />
                <button type="submit" className="bg-green-600 text-white font-bold px-5 py-3 rounded-xl shadow-lg shadow-green-600/25">Add</button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
