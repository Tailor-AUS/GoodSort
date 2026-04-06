"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { X, ScanBarcode } from "lucide-react";
import { lookupContainer, createUnknownContainer } from "@/lib/containers";
import { addScan, getBagForMaterial, mapToMaterialType, SORTER_PAYOUT_CENTS, type BagInfo } from "@/lib/store";

interface ScannerProps {
  onClose: () => void;
  onScanComplete: (containerName: string, cents: number, bag: BagInfo) => void;
}

export function Scanner({ onClose, onScanComplete }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processedRef = useRef(false); // Guard against double-scan race condition
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scanning, setScanning] = useState(false);
  const [manualBarcode, setManualBarcode] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [scanResult, setScanResult] = useState<{ name: string; bag: BagInfo } | null>(null);

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
  }, []);

  const processBarcode = useCallback(
    (barcode: string) => {
      // Prevent double-scan from overlapping detect() calls
      if (processedRef.current) return;
      processedRef.current = true;

      stopCamera();
      const container = lookupContainer(barcode) || createUnknownContainer(barcode);
      const materialType = mapToMaterialType(container.material);
      const bag = getBagForMaterial(materialType);
      addScan(barcode, container.name, container.material);

      // Show bag assignment for 2 seconds before closing
      setScanResult({ name: container.name, bag });
      timeoutRef.current = setTimeout(() => {
        setScanResult(null);
        onScanComplete(container.name, SORTER_PAYOUT_CENTS, bag);
      }, 2000);
    },
    [stopCamera, onScanComplete]
  );

  const startCamera = useCallback(async () => {
    setScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }

      if ("BarcodeDetector" in window) {
        const detector = new (window as unknown as {
          BarcodeDetector: new (opts: { formats: string[] }) => { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
        }).BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });

        scanIntervalRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState !== 4) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) processBarcode(barcodes[0].rawValue);
          } catch { /* continue */ }
        }, 250);
      } else {
        setShowManual(true);
      }
    } catch {
      setCameraFailed(true);
      setShowManual(true);
      setScanning(false);
    }
  }, [processBarcode]);

  useEffect(() => {
    processedRef.current = false;
    startCamera();
    return () => {
      stopCamera();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [startCamera, stopCamera]);

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualBarcode.trim()) return;
    processBarcode(manualBarcode.trim());
  }

  function handleClose() { stopCamera(); onClose(); }

  // ── Bag Assignment Screen ──
  if (scanResult) {
    const { name, bag } = scanResult;
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center">
        <div className="animate-slide-up text-center px-8">
          {/* Big colored bag indicator */}
          <div className={`w-24 h-24 ${bag.color} rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl`}>
            <span className="text-4xl">{bag.emoji}</span>
          </div>

          <p className="text-white/50 text-sm mb-2">{name}</p>

          <p className="text-white text-2xl font-display font-extrabold mb-2">
            Put in the {bag.label}
          </p>

          <p className="text-green-400 text-lg font-bold">+{SORTER_PAYOUT_CENTS}c pending</p>

          {/* Bag color strip */}
          <div className={`mt-8 mx-auto w-48 h-2 ${bag.color} rounded-full opacity-60`} />
        </div>
      </div>
    );
  }

  // ── Camera View ──
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex justify-between items-center px-5 pt-[env(safe-area-inset-top,16px)] pb-3">
        <div className="flex items-center gap-2.5">
          <ScanBarcode className="w-5 h-5 text-green-400" />
          <h2 className="text-[15px] font-display font-bold text-white">Scan Container</h2>
        </div>
        <button onClick={handleClose} className="p-2 hover:bg-white/5 rounded-full transition-colors duration-200">
          <X className="w-5 h-5 text-neutral-400" />
        </button>
      </div>

      <div className="flex-1 relative">
        {!cameraFailed && <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />}
        {cameraFailed && (
          <div className="flex items-center justify-center h-full">
            <p className="text-neutral-600 text-[13px]">Camera not available</p>
          </div>
        )}
        {scanning && !cameraFailed && (
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

      {/* 4-bag legend */}
      <div className="bg-[#141414] border-t border-[#222] px-5 py-3">
        <p className="text-[11px] text-neutral-500 font-semibold uppercase tracking-[0.15em] mb-2">Sort into bags</p>
        <div className="grid grid-cols-4 gap-2">
          <BagLegendItem color="bg-blue-500" label="Cans" />
          <BagLegendItem color="bg-teal-500" label="Plastic" />
          <BagLegendItem color="bg-amber-500" label="Glass" />
          <BagLegendItem color="bg-green-600" label="Other" />
        </div>
      </div>

      <div className="bg-[#141414] px-5 py-3">
        {!showManual && (
          <button onClick={() => setShowManual(true)} className="text-neutral-500 text-[13px] font-medium w-full text-center hover:text-neutral-300 transition-colors duration-200">
            Enter barcode manually
          </button>
        )}
        {showManual && (
          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <input type="text" inputMode="numeric" value={manualBarcode} onChange={(e) => setManualBarcode(e.target.value)}
              placeholder="Enter barcode..." autoFocus
              className="flex-1 bg-[#1e1e1e] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-[14px] placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500/50" />
            <button type="submit" className="bg-green-600 hover:bg-green-500 text-white font-bold px-5 py-3 rounded-xl transition-colors duration-200 shadow-lg shadow-green-600/25">Add</button>
          </form>
        )}
      </div>
    </div>
  );
}

function BagLegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`w-6 h-6 ${color} rounded-lg`} />
      <span className="text-[10px] text-neutral-500">{label}</span>
    </div>
  );
}
