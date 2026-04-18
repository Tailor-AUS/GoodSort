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
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

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
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    setCapturedImage(dataUrl);
    const base64 = dataUrl.split(",")[1];

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

    // Confirm via the photo/confirm API (creates scan records + credits)
    // Do NOT also call addScanApi — that would double-count
    try {
      const res = await fetch(apiUrl("/api/scan/photo/confirm"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: getStoredUserId(),
          items: eligible,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        totalItems = data.totalContainers || eligible.reduce((s, e) => s + e.count, 0);
        totalCents = data.totalCents || totalItems * 10;
      } else {
        // Fallback: count from eligible items
        totalItems = eligible.reduce((s, e) => s + e.count, 0);
        totalCents = totalItems * 10;
      }
    } catch {
      totalItems = eligible.reduce((s, e) => s + e.count, 0);
      totalCents = totalItems * 10;
    }

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
    setCapturedImage(null);
    processedRef.current = false;
    startCamera();
  }

  // ── 8-stream sorting system ──
  // Import would be cleaner but keeping inline to avoid build issues with existing code
  const STREAM_MAP: Record<string, { bg: string; label: string; shortLabel: string; emoji: string; section: number }> = {
    aluminium:        { bg: "bg-blue-500",    label: "Aluminium Cans",  shortLabel: "ALU",      emoji: "🔵", section: 1 },
    pet_clear:        { bg: "bg-sky-400",     label: "PET Clear",       shortLabel: "PET CLR",  emoji: "💧", section: 2 },
    pet_coloured:     { bg: "bg-rose-500",    label: "PET Coloured",    shortLabel: "PET COL",  emoji: "🔴", section: 3 },
    glass_clear:      { bg: "bg-emerald-400", label: "Glass Clear",     shortLabel: "GLS CLR",  emoji: "🟢", section: 4 },
    glass_brown:      { bg: "bg-amber-700",   label: "Glass Brown",     shortLabel: "GLS BRN",  emoji: "🟤", section: 5 },
    glass_green:      { bg: "bg-green-700",   label: "Glass Green",     shortLabel: "GLS GRN",  emoji: "🟩", section: 6 },
    steel:            { bg: "bg-slate-500",   label: "Steel Cans",      shortLabel: "STEEL",    emoji: "⚪", section: 7 },
    hdpe_lpb:         { bg: "bg-orange-400",  label: "HDPE & Cartons",  shortLabel: "HDPE/LPB", emoji: "🟠", section: 8 },
  };
  function getStream(material: string, name: string) {
    const mat = material.toLowerCase();
    const desc = name.toLowerCase();
    if (mat === "aluminium" || mat === "aluminum") return STREAM_MAP.aluminium;
    if (mat === "steel") return STREAM_MAP.steel;
    if (mat === "pet") {
      if (desc.includes("green") || desc.includes("colour") || desc.includes("sprite") ||
          desc.includes("fanta") || desc.includes("brown") || desc.includes("dark") || desc.includes("tinted"))
        return STREAM_MAP.pet_coloured;
      return STREAM_MAP.pet_clear;
    }
    if (mat === "glass") {
      if (desc.includes("brown") || desc.includes("amber") || desc.includes("stubby") ||
          desc.includes("beer") || desc.includes("vb") || desc.includes("xxxx") || desc.includes("carlton"))
        return STREAM_MAP.glass_brown;
      if (desc.includes("green") || desc.includes("heineken"))
        return STREAM_MAP.glass_green;
      return STREAM_MAP.glass_clear;
    }
    if (mat === "hdpe" || mat === "liquid_paperboard") return STREAM_MAP.hdpe_lpb;
    return STREAM_MAP.hdpe_lpb; // fallback
  }

  // ── Results Screen — photo overlay with colour-coded sorting ──
  if (results !== null) {
    const eligible = results.filter((r) => r.eligible);
    const totalItems = eligible.reduce((s, r) => s + r.count, 0);
    const centsPerItem = 10; // CDS refund rate — going direct to recycler
    const totalCents = totalItems * centsPerItem;

    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col" style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>

        {/* Photo backdrop with darkened overlay */}
        <div className="relative flex-1 overflow-hidden">
          {capturedImage && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={capturedImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/60" />
            </>
          )}

          {/* Close button */}
          <button onClick={handleClose} className="absolute top-3 right-3 z-10 p-2.5 text-white/70 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center">
            <X className="w-5 h-5" />
          </button>

          {/* Results overlay on the photo */}
          <div className="relative z-10 flex flex-col h-full justify-end p-4">
            {results.length === 0 ? (
              <div className="text-center py-12">
                <Camera className="w-12 h-12 text-white/30 mx-auto mb-3" />
                <p className="text-white/60 text-[15px] font-semibold mb-1">{resultSummary || "No containers detected"}</p>
                <p className="text-white/40 text-[13px]">Try a clearer photo with better lighting</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {/* Colour-coded item tags — like AR labels */}
                {results.map((item, i) => {
                  const stream = getStream(item.material, item.name);
                  return (
                    <div key={i} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl backdrop-blur-md ${item.eligible ? "bg-white/15 border border-white/20" : "bg-white/5 border border-white/10 opacity-50"}`}>
                      {/* Stream section indicator */}
                      <div className={`w-10 h-10 ${stream.bg} rounded-xl flex flex-col items-center justify-center flex-shrink-0 shadow-lg`}>
                        <span className="text-white text-[9px] font-extrabold leading-none">{stream.shortLabel}</span>
                        <span className="text-white/80 text-[7px] font-bold">#{stream.section}</span>
                      </div>
                      {/* Item info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-white font-semibold truncate">{item.name}</p>
                        <p className="text-[11px] text-white/50">
                          {item.eligible ? `Section ${stream.section} · ${stream.label} · 10¢` : "Not CDS eligible"}
                        </p>
                      </div>
                      {/* Count stepper — also acts as "how many more?" */}
                      {item.eligible && (
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => updateCount(i, -1)} className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center active:bg-white/30">
                            <Minus className="w-3 h-3 text-white" />
                          </button>
                          <span className="text-[16px] font-extrabold text-white w-6 text-center">{item.count}</span>
                          <button onClick={() => updateCount(i, 1)} className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center active:bg-white/30">
                            <Plus className="w-3 h-3 text-white" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* 8-stream bin guide */}
                {eligible.length > 0 && (
                  <div className="mt-2 px-1">
                    {/* Top row — 3 high-volume sections */}
                    <div className="grid grid-cols-3 gap-1 mb-1">
                      {(["aluminium", "pet_clear", "pet_coloured"] as const).map(key => {
                        const st = STREAM_MAP[key];
                        const count = eligible.filter(e => getStream(e.material, e.name).section === st.section).reduce((s, e) => s + e.count, 0);
                        return (
                          <div key={key} className={`rounded-lg py-1 text-center ${count > 0 ? `${st.bg} shadow-lg` : "bg-white/10"}`}>
                            <p className="text-[8px] font-extrabold text-white">{st.shortLabel}</p>
                            {count > 0 && <p className="text-[10px] font-bold text-white/80">×{count}</p>}
                          </div>
                        );
                      })}
                    </div>
                    {/* Bottom row — 5 smaller sections */}
                    <div className="grid grid-cols-5 gap-1">
                      {(["glass_clear", "glass_brown", "glass_green", "steel", "hdpe_lpb"] as const).map(key => {
                        const st = STREAM_MAP[key];
                        const count = eligible.filter(e => getStream(e.material, e.name).section === st.section).reduce((s, e) => s + e.count, 0);
                        return (
                          <div key={key} className={`rounded-lg py-1 text-center ${count > 0 ? `${st.bg} shadow-lg` : "bg-white/10"}`}>
                            <p className="text-[7px] font-extrabold text-white">{st.shortLabel}</p>
                            {count > 0 && <p className="text-[9px] font-bold text-white/80">×{count}</p>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bottom actions — always visible */}
        <div className="bg-black px-5 py-4 border-t border-white/10">
          {totalItems > 0 && (
            <div className="flex justify-between items-center mb-3">
              <span className="text-[13px] text-white/50">{totalItems} item{totalItems !== 1 ? "s" : ""}</span>
              <span className="text-[17px] font-display font-extrabold text-green-400">+${(totalCents / 100).toFixed(2)}</span>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={retake}
              className="flex-1 py-3.5 rounded-xl border border-white/20 text-white/70 font-bold text-[13px] flex items-center justify-center gap-2 min-h-[48px] active:bg-white/10">
              <RotateCcw className="w-4 h-4" /> Retake
            </button>
            {totalItems > 0 && (
              <button onClick={confirmBatch} disabled={confirming}
                className="flex-[2] bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/30 disabled:opacity-50 flex items-center justify-center gap-2 min-h-[48px]">
                <Check className="w-5 h-5" /> {confirming ? "Saving..." : `Confirm +$${(totalCents / 100).toFixed(2)}`}
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
          <p className="text-green-400 text-lg font-bold">+{SORTER_PAYOUT_CENTS}¢ added to your account</p>
          <div className={`mt-8 mx-auto w-48 h-2 ${bag.color} rounded-full opacity-60`} />
        </div>
      </div>
    );
  }

  // ── Analyzing overlay (shows captured photo with scan-line effect) ──
  if (analyzing) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center">
        {capturedImage ? (
          <div className="relative w-[85vw] max-w-sm aspect-[3/4] rounded-2xl overflow-hidden shadow-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={capturedImage} alt="Scanning" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/30" />
            <div className="absolute inset-x-0 h-[3px] bg-gradient-to-r from-transparent via-green-400 to-transparent shadow-[0_0_15px_rgba(74,222,128,0.6)] animate-scan-line" />
            <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-green-400 rounded-tl-lg" />
            <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-green-400 rounded-tr-lg" />
            <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-green-400 rounded-bl-lg" />
            <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-green-400 rounded-br-lg" />
            <div className="absolute bottom-8 inset-x-0 text-center">
              <div className="inline-flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-4 py-2">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <p className="text-white text-[13px] font-semibold">Identifying containers...</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center px-8">
            <div className="w-24 h-24 bg-green-600/20 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <Camera className="w-10 h-10 text-green-400 animate-pulse" />
            </div>
            <p className="text-white text-xl font-display font-extrabold mb-2">Analyzing...</p>
            <p className="text-white/40 text-[13px]">Identifying containers in your photo</p>
          </div>
        )}
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
      <div className="flex-1 relative overflow-hidden min-h-0">
        {!cameraFailed && <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />}
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

      {/* Bottom controls — flex-shrink-0 keeps it visible above browser bar */}
      <div className="flex-shrink-0 bg-black" style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom, 20px))" }}>
        {mode === "photo" ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <button onClick={capturePhoto} disabled={!scanning || cameraFailed}
              className="rounded-full bg-white border-4 border-white/30 shadow-lg active:scale-90 transition-transform disabled:opacity-30"
              style={{ width: "72px", height: "72px", touchAction: "manipulation" }} />
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
