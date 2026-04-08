"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Camera, ArrowLeft, MapPin, RotateCcw, Check } from "lucide-react";
import { apiUrl } from "@/lib/config";
import { BAGS, getBagForMaterial, mapToMaterialType, type BagInfo } from "@/lib/store";

interface BinInfo {
  id: string;
  code: string;
  name: string;
  address: string;
  hostedBy: string | null;
}

interface IdentifiedItem {
  name: string;
  material: string;
  count: number;
  eligible: boolean;
}

function ScanPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const binCode = searchParams.get("bin");
  const [bin, setBin] = useState<BinInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Camera
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState<IdentifiedItem[] | null>(null);
  const [done, setDone] = useState(false);
  const [totalItems, setTotalItems] = useState(0);

  // Load bin info
  useEffect(() => {
    if (!binCode) { setLoading(false); return; }
    fetch(apiUrl(`/api/bins/code/${binCode}`))
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { setBin(d); setLoading(false); })
      .catch(() => { setError("Bin not found"); setLoading(false); });
  }, [binCode]);

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setCameraReady(true);
    } catch { setCameraReady(false); }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
  }, []);

  useEffect(() => {
    if (bin && !results && !done) startCamera();
    return () => stopCamera();
  }, [bin, results, done, startCamera, stopCamera]);

  // Capture + analyze
  async function captureAndAnalyze() {
    if (!videoRef.current || !canvasRef.current) return;
    setAnalyzing(true);

    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    const base64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
    stopCamera();

    try {
      const res = await fetch(apiUrl("/api/scan/photo"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, binCode }),
      });
      if (!res.ok) { setResults([]); setAnalyzing(false); return; }
      const data = await res.json();
      setResults(data.containers || []);
    } catch {
      setResults([]);
    }
    setAnalyzing(false);
  }

  // Confirm — just logs to API, no user payout
  async function confirmSort() {
    if (!results) return;
    const eligible = results.filter((r) => r.eligible);
    setTotalItems(eligible.reduce((s, r) => s + r.count, 0));

    // Log to API (updates bin container count)
    try {
      await fetch(apiUrl("/api/scan/photo/confirm"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "00000000-0000-0000-0000-000000000000",
          items: eligible,
          binCode,
        }),
      });
    } catch { /* best effort */ }

    setDone(true);
    setResults(null);
  }

  function retake() {
    setResults(null);
    startCamera();
  }

  // ── Loading ──
  if (loading) return <Screen><p className="text-slate-400 text-sm">Loading...</p></Screen>;

  // ── No bin code ──
  if (!binCode) {
    return (
      <Screen>
        <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Camera className="w-8 h-8 text-green-600" />
        </div>
        <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-2">Scan a Bin QR Code</h1>
        <p className="text-slate-400 text-[13px] mb-6">Find a Good Sort bin and scan the QR code to start sorting</p>
        <button onClick={() => router.push("/")} className="text-green-600 font-medium text-[13px]">Find bins on the map</button>
      </Screen>
    );
  }

  // ── Bin not found ──
  if (error) {
    return (
      <Screen>
        <h1 className="text-xl font-display font-extrabold text-slate-900 mb-2">Bin Not Found</h1>
        <p className="text-slate-400 text-[13px] mb-4">Code &quot;{binCode}&quot; not recognised</p>
        <button onClick={() => router.push("/")} className="text-green-600 font-medium text-[13px]">Go to map</button>
      </Screen>
    );
  }

  // ── Done — thank you ──
  if (done) {
    return (
      <Screen>
        <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <Check className="w-8 h-8 text-green-600" />
        </div>
        <p className="text-3xl font-display font-extrabold text-green-600 mb-2 animate-ka-ching">
          +{totalItems * 5}c
        </p>
        <h1 className="text-xl font-display font-extrabold text-slate-900 mb-1">Sorting credit earned!</h1>
        <p className="text-slate-500 text-[13px]">{totalItems} container{totalItems !== 1 ? "s" : ""} sorted at {bin?.name}</p>
        <p className="text-slate-400 text-[12px] mt-2">Pending until collected and verified</p>
        <div className="mt-8 space-y-2 w-full max-w-sm">
          <button onClick={() => { setDone(false); setTotalItems(0); }}
            className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20">
            Sort More
          </button>
        </div>
      </Screen>
    );
  }

  // ── Results — sorting guide ──
  if (results !== null) {
    const eligible = results.filter((r) => r.eligible);
    const total = eligible.reduce((s, r) => s + r.count, 0);

    return (
      <div className="h-dvh bg-white flex flex-col" style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="px-5 py-3 border-b border-slate-100">
          <p className="text-[11px] text-green-600 font-bold">{bin?.code}</p>
          <h2 className="text-[17px] font-display font-extrabold text-slate-900">
            {total > 0 ? `Sort ${total} container${total !== 1 ? "s" : ""}` : "No containers found"}
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {results.length === 0 ? (
            <div className="text-center py-12">
              <Camera className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-400 text-[13px]">No containers detected. Try better lighting.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {eligible.map((item, i) => {
                const bag = getBagForMaterial(mapToMaterialType(item.material));
                return (
                  <div key={i} className="flex items-center gap-3 p-3.5 rounded-2xl border border-slate-200 bg-white">
                    <div className={`w-10 h-10 ${bag.color} rounded-xl flex items-center justify-center flex-shrink-0`}>
                      <span className="text-lg">{bag.emoji}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] text-slate-900 font-semibold">{item.name}</p>
                      <p className="text-[12px] text-slate-500 mt-0.5">
                        Put in <span className="font-bold">{bag.label}</span> slot &middot; 5c each
                      </p>
                    </div>
                    <span className="text-[15px] font-display font-extrabold text-slate-900">×{item.count}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Bag legend */}
          {eligible.length > 0 && (
            <div className="mt-5 p-4 bg-slate-50 rounded-2xl border border-slate-200">
              <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider mb-3">Bin Slots</p>
              <div className="grid grid-cols-4 gap-2">
                {BAGS.map((bag) => (
                  <div key={bag.id} className="text-center">
                    <div className={`w-8 h-8 ${bag.color} rounded-lg mx-auto mb-1`} />
                    <p className="text-[10px] text-slate-500 font-medium">{bag.label.split(" ")[0]}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100">
          <div className="flex gap-2">
            <button onClick={retake}
              className="flex-1 py-3.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-[13px] flex items-center justify-center gap-2 min-h-[48px]">
              <RotateCcw className="w-4 h-4" /> Retake
            </button>
            {total > 0 && (
              <button onClick={confirmSort}
                className="flex-[2] bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 flex items-center justify-center gap-2 min-h-[48px]">
                <Check className="w-5 h-5" /> Done &middot; +{total * 5}c credit
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Camera — main view ──
  return (
    <div className="h-dvh bg-black flex flex-col" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div className="px-5 pb-3 bg-black/80" style={{ paddingTop: "calc(env(safe-area-inset-top, 16px) + 0.25rem)" }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-600/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <MapPin className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <p className="text-[11px] text-green-400 font-bold">{bin?.code}</p>
            <p className="text-[15px] text-white font-display font-bold">{bin?.name}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 relative">
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
        <canvas ref={canvasRef} className="hidden" />

        {cameraReady && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-[80%] h-[60%] border-2 border-white/20 rounded-3xl">
              <p className="text-white/40 text-[12px] text-center mt-4 font-medium">
                Place containers in frame
              </p>
            </div>
          </div>
        )}

        {analyzing && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
            <div className="text-center">
              <Camera className="w-10 h-10 text-green-400 animate-pulse mx-auto mb-3" />
              <p className="text-white text-lg font-display font-bold">Identifying...</p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-black/80 px-5 py-5">
        <div className="flex flex-col items-center gap-3">
          <button onClick={captureAndAnalyze} disabled={!cameraReady || analyzing}
            className="w-16 h-16 rounded-full bg-white border-4 border-white/30 shadow-lg active:scale-90 transition-transform disabled:opacity-30" />
          <p className="text-white/30 text-[11px] text-center">
            Photograph your containers — we&apos;ll tell you which slot
          </p>
        </div>
      </div>
    </div>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-dvh bg-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">{children}</div>
    </div>
  );
}

export default function ScanPage() {
  return (
    <Suspense fallback={<Screen><p className="text-slate-400 text-sm">Loading...</p></Screen>}>
      <ScanPageContent />
    </Suspense>
  );
}
