"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { lookupContainer, createUnknownContainer } from "@/lib/containers";
import {
  addScan, getUser, formatCents, SORTER_PAYOUT_CENTS,
  getBinForBuilding, getFillBgColor, BIN_CAPACITY_CONTAINERS,
  type Bin,
} from "@/lib/store";

type ScanState = "idle" | "scanning" | "success" | "error";

interface ScanResult {
  name: string;
  brand: string;
  material: string;
  refundCents: number;
  pendingBalance: number;
  totalContainers: number;
}

export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string>("");
  const [manualBarcode, setManualBarcode] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [cameraAvailable, setCameraAvailable] = useState(true);
  const [bin, setBin] = useState<Bin | null>(null);

  const processBarcode = useCallback((barcode: string) => {
    const container = lookupContainer(barcode) || createUnknownContainer(barcode);
    const user = addScan(barcode, container.name, container.material);

    setResult({
      name: container.name,
      brand: container.brand,
      material: container.material,
      refundCents: SORTER_PAYOUT_CENTS,
      pendingBalance: user.pendingCents,
      totalContainers: user.totalContainers,
    });
    setScanState("success");
    // Refresh bin status
    const u = getUser();
    if (u) setBin(getBinForBuilding(u.buildingId));
  }, []);

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    setScanState("scanning");
    setResult(null);
    setError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Use BarcodeDetector API if available (Chrome/Edge on Android, Safari 17.2+)
      if ("BarcodeDetector" in window) {
        const detector = new (window as unknown as { BarcodeDetector: new (opts: { formats: string[] }) => { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
        });

        scanIntervalRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState !== 4) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              stopCamera();
              processBarcode(barcodes[0].rawValue);
            }
          } catch {
            // Detection frame failed, continue scanning
          }
        }, 250);
      } else {
        // Fallback: show manual entry for browsers without BarcodeDetector
        setCameraAvailable(true);
        setShowManual(true);
      }
    } catch {
      setCameraAvailable(false);
      setShowManual(true);
      setScanState("idle");
    }
  }, [processBarcode, stopCamera]);

  useEffect(() => {
    const u = getUser();
    if (u) setBin(getBinForBuilding(u.buildingId));
    return () => stopCamera();
  }, [stopCamera]);

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualBarcode.trim()) return;
    stopCamera();
    processBarcode(manualBarcode.trim());
    setManualBarcode("");
  }

  function handleScanAgain() {
    setResult(null);
    setScanState("idle");
    setShowManual(false);
  }

  return (
    <div className="max-w-md mx-auto px-4 pt-6">
      <h1 className="text-xl font-bold text-gray-800 mb-4">Scan Container</h1>

      {/* Success State */}
      {scanState === "success" && result && (
        <div className="animate-slide-up">
          <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-6 text-center mb-4">
            <div className="text-4xl mb-2 animate-ka-ching">+{result.refundCents}c pending</div>
            <p className="text-amber-800 font-semibold text-lg">{result.name}</p>
            <p className="text-amber-600 text-sm">{result.brand} &middot; {result.material}</p>
            <p className="text-amber-500 text-xs mt-2">Clears when bin is collected and verified</p>
            <div className="mt-4 pt-4 border-t border-amber-200 flex justify-around">
              <div>
                <p className="text-xs text-amber-600">Pending</p>
                <p className="text-lg font-bold text-amber-800">{formatCents(result.pendingBalance)}</p>
              </div>
              <div>
                <p className="text-xs text-amber-600">Total Containers</p>
                <p className="text-lg font-bold text-amber-800">{result.totalContainers}</p>
              </div>
            </div>
          </div>
          <button
            onClick={handleScanAgain}
            className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            Scan Another
          </button>
        </div>
      )}

      {/* Scanning / Idle State */}
      {scanState !== "success" && (
        <>
          {/* Camera View */}
          {cameraAvailable && (
            <div className="relative bg-black rounded-2xl overflow-hidden mb-4 aspect-[4/3]">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
              />
              <canvas ref={canvasRef} className="hidden" />
              {scanState === "scanning" && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-48 h-48 border-2 border-white/50 rounded-lg">
                    <div className="w-full h-0.5 bg-green-400 animate-pulse mt-24" />
                  </div>
                </div>
              )}
              {scanState === "idle" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <button
                    onClick={startCamera}
                    className="bg-green-600 hover:bg-green-700 text-white font-semibold px-8 py-3 rounded-xl transition-colors"
                  >
                    Start Camera
                  </button>
                </div>
              )}
            </div>
          )}

          {!cameraAvailable && (
            <div className="bg-gray-100 rounded-2xl p-8 text-center mb-4">
              <p className="text-gray-500 text-sm mb-2">Camera not available</p>
              <p className="text-gray-400 text-xs">Use manual entry below</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          {/* Manual Barcode Entry */}
          <div className="mt-2">
            {!showManual && (
              <button
                onClick={() => setShowManual(true)}
                className="text-sm text-gray-500 underline"
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
                  placeholder="Enter barcode number..."
                  className="flex-1 border border-gray-300 rounded-lg px-4 py-3 text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500"
                  autoFocus
                />
                <button
                  type="submit"
                  className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
                >
                  Add
                </button>
              </form>
            )}
          </div>

          {/* Your Building's Bin Status */}
          {bin && (
            <div className="mt-6 bg-white rounded-xl p-4 border border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Your Bin — {bin.buildingName}</h3>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>{bin.containerCount.toLocaleString()} / {BIN_CAPACITY_CONTAINERS.toLocaleString()} containers</span>
                <span className={getFillBgColor(bin.fillPercent).replace("bg-", "text-")}>{bin.fillPercent}% full</span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-2">
                <div
                  className={`h-full rounded-full transition-all ${getFillBgColor(bin.fillPercent)}`}
                  style={{ width: `${bin.fillPercent}%` }}
                />
              </div>
              {/* Material composition bar */}
              {bin.materials && bin.containerCount > 0 && (
                <div>
                  <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 mb-1">
                    {bin.materials.aluminium > 0 && <div className="bg-blue-500 h-full" style={{ width: `${(bin.materials.aluminium / bin.containerCount) * 100}%` }} />}
                    {bin.materials.pet > 0 && <div className="bg-cyan-400 h-full" style={{ width: `${(bin.materials.pet / bin.containerCount) * 100}%` }} />}
                    {bin.materials.glass > 0 && <div className="bg-amber-400 h-full" style={{ width: `${(bin.materials.glass / bin.containerCount) * 100}%` }} />}
                    {bin.materials.hdpe > 0 && <div className="bg-purple-400 h-full" style={{ width: `${(bin.materials.hdpe / bin.containerCount) * 100}%` }} />}
                    {bin.materials.liquid_paperboard > 0 && <div className="bg-orange-400 h-full" style={{ width: `${(bin.materials.liquid_paperboard / bin.containerCount) * 100}%` }} />}
                  </div>
                  <div className="flex gap-2 flex-wrap text-xs text-gray-400">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />AL {bin.materials.aluminium}</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" />PET {bin.materials.pet}</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Glass {bin.materials.glass}</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400 inline-block" />HDPE {bin.materials.hdpe}</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />Carton {bin.materials.liquid_paperboard}</span>
                  </div>
                </div>
              )}
              <p className="text-xs text-gray-400 mt-2">~{bin.estimatedWeightKg}kg</p>
            </div>
          )}

          {/* Instructions */}
          <div className="mt-4 bg-white rounded-xl p-4 border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Tips</h3>
            <ul className="text-xs text-gray-500 space-y-1">
              <li>Hold the barcode steady in the camera frame</li>
              <li>Eligible containers are 150ml to 3L</li>
              <li>Cans, bottles, cartons, and poppers all count</li>
              <li>Don't crush — depots need intact barcodes</li>
              <li>Each scan earns 5c pending — clears on collection</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
