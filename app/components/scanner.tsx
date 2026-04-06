"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { lookupContainer, createUnknownContainer } from "@/lib/containers";
import { addScan, SORTER_PAYOUT_CENTS } from "@/lib/store";

interface ScannerProps {
  onClose: () => void;
  onScanComplete: (containerName: string, cents: number) => void;
}

export function Scanner({ onClose, onScanComplete }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [scanning, setScanning] = useState(false);
  const [manualBarcode, setManualBarcode] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const processBarcode = useCallback(
    (barcode: string) => {
      stopCamera();
      const container = lookupContainer(barcode) || createUnknownContainer(barcode);
      addScan(barcode, container.name, container.material);
      onScanComplete(container.name, SORTER_PAYOUT_CENTS);
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
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      if ("BarcodeDetector" in window) {
        const detector = new (
          window as unknown as {
            BarcodeDetector: new (opts: { formats: string[] }) => {
              detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
            };
          }
        ).BarcodeDetector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
        });

        scanIntervalRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState !== 4) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              processBarcode(barcodes[0].rawValue);
            }
          } catch {
            // continue
          }
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
    startCamera();
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualBarcode.trim()) return;
    processBarcode(manualBarcode.trim());
  }

  function handleClose() {
    stopCamera();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center p-4 text-white">
        <h2 className="text-lg font-semibold">Scan Container</h2>
        <button onClick={handleClose} className="p-2 hover:bg-white/10 rounded-full">
          <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* Camera */}
      <div className="flex-1 relative">
        {!cameraFailed && (
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted
          />
        )}

        {cameraFailed && (
          <div className="flex items-center justify-center h-full">
            <p className="text-white/50 text-sm">Camera not available</p>
          </div>
        )}

        {scanning && !cameraFailed && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-56 h-56 border-2 border-white/40 rounded-lg">
              <div className="w-full h-0.5 bg-green-400 animate-pulse mt-28" />
            </div>
          </div>
        )}
      </div>

      {/* Manual entry */}
      <div className="p-4">
        {!showManual && (
          <button
            onClick={() => setShowManual(true)}
            className="text-white/50 text-sm underline w-full text-center"
          >
            Enter barcode manually
          </button>
        )}
        {showManual && (
          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={manualBarcode}
              onChange={(e) => setManualBarcode(e.target.value)}
              placeholder="Enter barcode..."
              className="flex-1 bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-green-500"
              autoFocus
            />
            <button
              type="submit"
              className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-lg"
            >
              Add
            </button>
          </form>
        )}
      </div>

      {/* Tips */}
      <div className="px-4 pb-6">
        <p className="text-white/30 text-xs text-center">
          Don't crush containers &middot; Depots need intact barcodes &middot; 10c pending per scan
        </p>
      </div>
    </div>
  );
}
