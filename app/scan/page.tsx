"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Camera, MapPin, RotateCcw, Check, Mail, ShieldCheck, ImagePlus } from "lucide-react";
import { apiUrl } from "@/lib/config";
import { BAGS, getBagForMaterial, mapToMaterialType } from "@/lib/store";

interface BinInfo {
  id: string; code: string; name: string; address: string; hostedBy: string | null;
}
interface IdentifiedItem {
  name: string; material: string; count: number; eligible: boolean;
}

type Step = "loading" | "auth" | "verify" | "camera" | "analyzing" | "results" | "error" | "done";

function ScanPageContent() {
  const searchParams = useSearchParams();
  const binCode = searchParams.get("bin");

  const [step, setStep] = useState<Step>("loading");
  const [bin, setBin] = useState<BinInfo | null>(null);
  const [apiError, setApiError] = useState(false);

  // Auth
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Camera
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraDenied, setCameraDenied] = useState(false);

  // Results
  const [results, setResults] = useState<IdentifiedItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);

  // ── Init ──
  useEffect(() => {
    const token = localStorage.getItem("goodsort_token");

    if (binCode) {
      fetch(apiUrl(`/api/bins/code/${binCode}`))
        .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
        .then((d) => { setBin(d); setStep(token ? "camera" : "auth"); })
        .catch(() => setStep(token ? "camera" : "auth")); // Bin not found — still let them scan
    } else {
      setStep(token ? "camera" : "auth");
    }
  }, [binCode]);

  // ── Auth ──
  async function sendOtp() {
    if (!email.includes("@")) return;
    setAuthLoading(true); setAuthError("");
    try {
      const res = await fetch(apiUrl("/api/auth/send-otp"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) { setAuthError("Failed to send code"); setAuthLoading(false); return; }
      setStep("verify");
    } catch { setAuthError("Something went wrong"); }
    setAuthLoading(false);
  }

  async function verifyOtp() {
    if (otp.length < 6) return;
    setAuthLoading(true); setAuthError("");
    try {
      const res = await fetch(apiUrl("/api/auth/verify-otp"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: otp }),
      });
      if (!res.ok) { setAuthError("Invalid code"); setAuthLoading(false); return; }
      const data = await res.json();
      localStorage.setItem("goodsort_token", data.token);
      localStorage.setItem("goodsort_profile", JSON.stringify(data.profile));
      document.cookie = `goodsort_token=${data.token}; path=/; max-age=${30*24*60*60}; SameSite=Lax; Secure`;
      setStep("camera");
    } catch { setAuthError("Verification failed"); }
    setAuthLoading(false);
  }

  // ── Camera ──
  const startCamera = useCallback(async () => {
    setCameraReady(false);
    setCameraDenied(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Wait for video metadata before playing (iOS fix)
        // Must check readyState first — autoPlay can fire loadedmetadata before listener is attached
        await new Promise<void>((resolve) => {
          if (videoRef.current!.readyState >= 1) {
            resolve();
          } else {
            videoRef.current!.addEventListener("loadedmetadata", () => resolve(), { once: true });
          }
        });
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError") {
        setCameraDenied(true);
      }
      setCameraReady(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    setCameraReady(false);
  }, []);

  useEffect(() => {
    if (step === "camera") startCamera();
    return () => { if (step === "camera") stopCamera(); };
  }, [step, startCamera, stopCamera]);

  // ── Capture from camera ──
  async function capture() {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return; // Not ready

    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    stopCamera();

    const base64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
    await analyzeImage(base64);
  }

  // ── Capture from file input (fallback) ──
  function handleFileCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert("File too large (max 10 MB)"); return; }
    stopCamera();

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      await analyzeImage(base64);
    };
    reader.readAsDataURL(file);
  }

  // ── Send to AI ──
  async function analyzeImage(base64: string) {
    setStep("analyzing");
    setApiError(false);
    try {
      const res = await fetch(apiUrl("/api/scan/photo"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, binCode }),
      });
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      setResults(data.containers || []);
    } catch {
      setResults([]);
      setApiError(true);
    }
    setStep("results");
  }

  // ── Confirm ──
  async function confirm() {
    const eligible = results.filter((r) => r.eligible);
    const total = eligible.reduce((s, r) => s + r.count, 0);
    setTotalItems(total);

    const userId = (() => { try { return JSON.parse(localStorage.getItem("goodsort_profile") || "{}").id || ""; } catch { return ""; } })();
    try {
      await fetch(apiUrl("/api/scan/photo/confirm"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, items: eligible, binCode }),
      });
    } catch { /* best effort */ }
    setStep("done");
  }

  function retake() {
    setResults([]);
    setApiError(false);
    setCameraReady(false);
    setStep("camera");
  }

  // ════════════════════════════════════
  // RENDER
  // ════════════════════════════════════

  if (step === "loading") return <Center><p className="text-slate-400">Loading...</p></Center>;

  // Auth
  if (step === "auth") return (
    <Center>
      <IconBubble><Mail className="w-7 h-7 text-green-600" /></IconBubble>
      <h1 className="text-xl font-display font-extrabold text-slate-900 mb-1">Enter your email</h1>
      <p className="text-slate-400 text-[13px] mb-6">To track your sorting credits</p>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
        className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500 mb-3" autoFocus />
      {authError && <p className="text-red-500 text-[12px] mb-2">{authError}</p>}
      <GreenButton onClick={sendOtp} disabled={authLoading || !email.includes("@")}>
        {authLoading ? "Sending..." : "Continue"}
      </GreenButton>
    </Center>
  );

  if (step === "verify") return (
    <Center>
      <IconBubble><ShieldCheck className="w-7 h-7 text-green-600" /></IconBubble>
      <h1 className="text-xl font-display font-extrabold text-slate-900 mb-1">Check your email</h1>
      <p className="text-slate-400 text-[13px] mb-6">Code sent to {email}</p>
      <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="000000"
        className="w-full text-center text-3xl font-display font-extrabold tracking-[0.3em] border border-slate-200 rounded-xl px-4 py-4 text-slate-900 placeholder-slate-200 focus:outline-none focus:ring-2 focus:ring-green-500/30 mb-3" autoFocus />
      {authError && <p className="text-red-500 text-[12px] mb-2 text-center">{authError}</p>}
      <GreenButton onClick={verifyOtp} disabled={authLoading || otp.length < 6}>
        {authLoading ? "Verifying..." : "Verify"}
      </GreenButton>
    </Center>
  );

  // Done
  if (step === "done") return (
    <Center>
      <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
        <Check className="w-8 h-8 text-green-600" />
      </div>
      {totalItems > 0 && (
        <p className="text-3xl font-display font-extrabold text-green-600 mb-2 animate-ka-ching">+{totalItems * 5}c</p>
      )}
      <h1 className="text-xl font-display font-extrabold text-slate-900 mb-1">
        {totalItems > 0 ? "Sorting credit earned!" : "Done!"}
      </h1>
      <p className="text-slate-500 text-[13px]">{totalItems} container{totalItems !== 1 ? "s" : ""} sorted{bin ? ` at ${bin.name}` : ""}</p>
      <GreenButton onClick={retake}>Sort More</GreenButton>
    </Center>
  );

  // Analyzing
  if (step === "analyzing") return (
    <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
      <div className="text-center">
        <Camera className="w-10 h-10 text-green-400 animate-pulse mx-auto mb-3" />
        <p className="text-white text-lg font-display font-bold">Identifying...</p>
      </div>
    </div>
  );

  // Results
  if (step === "results") {
    const eligible = results.filter((r) => r.eligible);
    const total = eligible.reduce((s, r) => s + r.count, 0);

    return (
      <div className="fixed inset-0 bg-white flex flex-col z-50" style={{ paddingTop: "env(safe-area-inset-top,0)", paddingBottom: "env(safe-area-inset-bottom,0)" }}>
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-[17px] font-display font-extrabold text-slate-900">
            {apiError ? "Connection error" : total > 0 ? `Sort ${total} container${total !== 1 ? "s" : ""}` : "No containers found"}
          </h2>
          {apiError && <p className="text-red-500 text-[12px] mt-1">Could not reach the server. Check your connection and try again.</p>}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {eligible.length === 0 && !apiError && (
            <div className="text-center py-12">
              <Camera className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-400 text-[13px]">No containers detected. Try better lighting.</p>
            </div>
          )}

          {eligible.length > 0 && (
            <div className="space-y-2">
              {eligible.map((item, i) => {
                const bag = getBagForMaterial(mapToMaterialType(item.material));
                return (
                  <div key={i} className="flex items-center gap-3 p-3.5 rounded-2xl border border-slate-200">
                    <div className={`w-10 h-10 ${bag.color} rounded-xl flex items-center justify-center flex-shrink-0`}>
                      <span className="text-lg">{bag.emoji}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] text-slate-900 font-semibold">{item.name}</p>
                      <p className="text-[12px] text-slate-500">Put in <span className="font-bold">{bag.label}</span> slot &middot; 5c each</p>
                    </div>
                    <span className="text-[15px] font-display font-extrabold text-slate-900">&times;{item.count}</span>
                  </div>
                );
              })}

              <div className="mt-4 p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <p className="text-[12px] text-slate-400 font-semibold uppercase tracking-wider mb-3">Bin Slots</p>
                <div className="grid grid-cols-4 gap-2">
                  {BAGS.map((bag) => (
                    <div key={bag.id} className="text-center">
                      <div className={`w-8 h-8 ${bag.color} rounded-lg mx-auto mb-1`} />
                      <p className="text-[10px] text-slate-500 font-medium">{bag.label.split(" ")[0]}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100">
          <div className="flex gap-2">
            <button onClick={retake}
              className="flex-1 py-3.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-[13px] flex items-center justify-center gap-2 min-h-[48px]"
              style={{ touchAction: "manipulation" }}>
              <RotateCcw className="w-4 h-4" /> Retake
            </button>
            {total > 0 && (
              <button onClick={confirm}
                className="flex-[2] bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 flex items-center justify-center gap-2 min-h-[48px]"
                style={{ touchAction: "manipulation" }}>
                <Check className="w-5 h-5" /> Done &middot; +{total * 5}c
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════
  // CAMERA VIEW
  // ════════════════════════════════════
  return (
    <div className="fixed inset-0 bg-black flex flex-col z-50">
      {/* Top bar */}
      <div className="flex-shrink-0 px-5 pb-2 bg-black" style={{ paddingTop: "calc(env(safe-area-inset-top, 16px) + 0.25rem)" }}>
        <p className="text-[15px] text-white font-display font-bold">
          {bin ? bin.name : "Scan Your Containers"}
        </p>
      </div>

      {/* Camera feed */}
      <div className="flex-1 relative overflow-hidden">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          muted
          autoPlay
          style={{ WebkitTransform: "translateZ(0)" }}
        />
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Bottom controls — always visible */}
      <div className="flex-shrink-0 bg-black" style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom, 20px))" }}>
        <div className="flex items-center justify-center gap-6 py-4">
          {/* File input — always available as fallback */}
          <label className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center cursor-pointer"
            style={{ touchAction: "manipulation" }}>
            <ImagePlus className="w-5 h-5 text-white/60" />
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileCapture} />
          </label>

          {/* Main capture button */}
          <button
            onClick={capture}
            disabled={!cameraReady}
            className="rounded-full bg-white active:scale-90 transition-transform disabled:opacity-40"
            style={{ width: "72px", height: "72px", border: "4px solid rgba(255,255,255,0.4)", touchAction: "manipulation" }}
          />

          {/* Spacer for symmetry */}
          <div className="w-12 h-12" />
        </div>

        {/* Status text */}
        <p className="text-white/30 text-[12px] text-center pb-1">
          {cameraDenied
            ? "Camera blocked — tap the gallery icon instead"
            : cameraReady
            ? "Tap the button to capture"
            : "Starting camera..."}
        </p>
      </div>
    </div>
  );
}

// ── Shared ──

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-white flex flex-col items-center justify-center px-6"><div className="w-full max-w-sm text-center">{children}</div></div>;
}

function IconBubble({ children }: { children: React.ReactNode }) {
  return <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">{children}</div>;
}

function GreenButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 transition-all min-h-[48px] flex items-center justify-center mt-3"
      style={{ touchAction: "manipulation" }}>
      {children}
    </button>
  );
}

export default function ScanPage() {
  return (
    <Suspense fallback={<Center><p className="text-slate-400">Loading...</p></Center>}>
      <ScanPageContent />
    </Suspense>
  );
}
