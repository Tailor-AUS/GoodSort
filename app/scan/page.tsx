"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Camera, RotateCcw, Check, Mail, ShieldCheck, ImagePlus, X, Home } from "lucide-react";
import { track } from "@/lib/analytics";
import { apiUrl, authHeaders, persistWaitlistFromUrl, readReferrerId, hasValidToken } from "@/lib/config";

interface BinInfo {
  id: string; code: string; name: string; address: string; hostedBy: string | null;
}
interface IdentifiedItem {
  name: string; material: string; count: number; eligible: boolean;
}

/** Holds a capture across the OTP round-trip (iOS discards backgrounded tabs). */
const PENDING_CAPTURE_KEY = "goodsort_pending_capture";

type Step = "loading" | "auth" | "verify" | "camera" | "analyzing" | "results" | "error" | "done";

function ScanPageContent() {
  const router = useRouter();
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
  const [aiMessage, setAiMessage] = useState("");
  const [totalItems, setTotalItems] = useState(0);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  // Signed token committing to the vision result — /confirm reads the items
  // out of this server-side, so the client can't fabricate eligible counts.
  const [scanToken, setScanToken] = useState<string | null>(null);

  // Scanning is the first thing anyone can do. An address is only needed before
  // we drive to someone's kerb, so it is asked for later — never before the
  // camera. The API credits a scan with a null HouseholdId, and those
  // containers are attached to the household when one is created.
  function openCamera() {
    track("scan_camera_opened");
    setStep("camera");
  }

  // ── Init ──
  useEffect(() => {
    persistWaitlistFromUrl();
    if (binCode) {
      fetch(apiUrl(`/api/bins/code/${binCode}`))
        .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
        .then((d) => setBin(d))
        .catch(() => {});
    }
    // A pending capture survives the trip to the mail app for the OTP code:
    // iOS discards backgrounded tabs, so the photo is held in sessionStorage
    // rather than in React state.
    const pending = sessionStorage.getItem(PENDING_CAPTURE_KEY);
    if (pending && hasValidToken()) {
      setCapturedImage(pending);
      void analyzeImage(pending);
      return;
    }
    openCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot land
  }, [binCode]);

  // ── Auth ──
  async function sendOtp() {
    if (!email.includes("@")) return;
    setAuthLoading(true); setAuthError("");
    try {
      track("otp_sent");
      const res = await fetch(apiUrl("/api/auth/send-otp"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) {
        setAuthError(typeof data.error === "string" && data.error ? data.error : "Failed to send code");
        setAuthLoading(false);
        return;
      }
      setStep("verify");
    } catch { setAuthError("Something went wrong"); }
    setAuthLoading(false);
  }

  async function verifyOtp() {
    if (otp.length < 6) return;
    setAuthLoading(true); setAuthError("");
    try {
      const referrerId = readReferrerId();
      const res = await fetch(apiUrl("/api/auth/verify-otp"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: otp, referrerId }),
      });
      if (!res.ok) { setAuthError("Invalid code"); setAuthLoading(false); return; }
      const data = await res.json();
      track("otp_verified");
      localStorage.setItem("goodsort_token", data.token);
      localStorage.setItem("goodsort_profile", JSON.stringify(data.profile));
      document.cookie = `goodsort_token=${data.token}; path=/; max-age=${30*24*60*60}; SameSite=Lax; Secure`;
      const pending = sessionStorage.getItem(PENDING_CAPTURE_KEY);
      if (pending) {
        setAuthLoading(false);
        await analyzeImage(pending);
        return;
      }
      openCamera();
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

  // Best-effort device location for the deposit geofence. Resolves null if the
  // user denies permission or the browser can't fix a position in time — the
  // server decides whether that's acceptable (it isn't, for a bin-bound scan).
  function getDeviceLocation(): Promise<{ lat: number; lng: number } | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
    });
  }

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

    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    setCapturedImage(dataUrl);
    const base64 = dataUrl.split(",")[1];
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
      const dataUrl = reader.result as string;
      setCapturedImage(dataUrl);
      const base64 = dataUrl.split(",")[1];
      await analyzeImage(base64);
    };
    reader.readAsDataURL(file);
  }

  // ── Send to AI ──
  async function analyzeImage(base64: string) {
    track("scan_captured");
    // Ask who they are only once there is something to keep.
    if (!hasValidToken()) {
      try { sessionStorage.setItem(PENDING_CAPTURE_KEY, base64); } catch { /* quota — retake */ }
      setStep("auth");
      return;
    }
    setStep("analyzing");
    setApiError(false);
    try {
      const res = await fetch(apiUrl("/api/scan/photo"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ image: base64, binCode }),
      });
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      setResults(data.containers || []);
      setAiMessage(data.message || "");
      setScanToken(data.scanToken || null);
      try { sessionStorage.removeItem(PENDING_CAPTURE_KEY); } catch { /* ignore */ }
    } catch {
      setResults([]);
      setApiError(true);
    }
    setStep("results");
  }

  /**
   * Credit landed. `first_scan_credited` is the activation metric — the moment
   * the launch bonus paid for — so it must fire once per member, not per scan.
   */
  function trackScanCredited() {
    track("scan_credited");
    try {
      if (!localStorage.getItem("goodsort_first_scan")) {
        localStorage.setItem("goodsort_first_scan", new Date().toISOString());
        track("first_scan_credited");
      }
    } catch { /* private mode — the per-scan event still counts */ }
  }

  // ── Confirm ──
  async function confirm() {
    const eligible = results.filter((r) => r.eligible);
    const total = eligible.reduce((s, r) => s + r.count, 0);
    setTotalItems(total);

    const userId = (() => { try { return JSON.parse(localStorage.getItem("goodsort_profile") || "{}").id || ""; } catch { return ""; } })();
    // Capture device location so the server can geofence the deposit against the
    // bin (anti-fraud for unattended bins). If the scan is bound to a bin, the
    // server requires this; for non-bin scans it's ignored.
    const loc = await getDeviceLocation();
    try {
      const res = await fetch(apiUrl("/api/scan/photo/confirm"), {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ scanToken, userId, items: eligible, binCode, lat: loc?.lat, lng: loc?.lng }),
      });
      if (!res.ok) {
        // Surface geofence / verification failures instead of silently "done".
        const data = await res.json().catch(() => ({}));
        setApiError(true);
        setAiMessage(data.error || "Couldn't confirm this deposit. Please try again at the bin.");
        setStep("results");
        return;
      }
      trackScanCredited();
    } catch { /* best effort — offline */ }
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
      <h1 className="text-xl font-display font-extrabold text-slate-900 mb-1">Nice — where should we keep it?</h1>
      <p className="text-slate-400 text-[13px] mb-6">
        Your photo is ready. Add an email so your sorting credit is saved to an account.
        No address needed yet — we only ask for that before we collect.
      </p>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
        onFocus={(e) => setTimeout(() => e.target.scrollIntoView({ behavior: "smooth", block: "center" }), 300)}
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
      <p className="text-slate-400 text-[13px] mb-6">Code sent to {email}. The code is in the subject line — check spam too. It expires in 15 minutes, and your photo is held while you fetch it.</p>
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
        {totalItems > 0 ? "Estimate logged" : "Done"}
      </h1>
      <p className="text-slate-500 text-[13px] mb-4">{totalItems} container{totalItems !== 1 ? "s" : ""} noted{bin ? ` at ${bin.name}` : ""}. Pending 5¢ clears after we collect and a refund point verifies.</p>

      {totalItems > 0 && (
        <div className="bg-green-50 rounded-2xl p-4 border border-green-200 mb-4 text-left">
          <p className="text-[12px] font-bold text-green-800 mb-2">How this works:</p>
          <div className="space-y-1.5 text-[12px] text-green-700">
            <p>1. Scan eligible containers — 5¢ pending each</p>
            <p>2. Sort into your bags at home</p>
            <p>3. Suburb volume unlocks a driver trip to the refund point</p>
            <p>4. Bag out when we collect. Bank transfer from $20 once payouts are live</p>
          </div>
        </div>
      )}

      <GreenButton onClick={retake}>Scan another container</GreenButton>
      <button onClick={() => { window.location.href = "/sort"; }}
        className="w-full mt-2 py-3 text-slate-400 font-medium text-[13px] hover:text-slate-600 transition-colors">
        Back to sort
      </button>
    </Center>
  );

  // Analyzing — show captured image with scan effect
  if (step === "analyzing") return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center z-50">
      {capturedImage ? (
        <div className="relative w-[85vw] max-w-sm aspect-[3/4] rounded-2xl overflow-hidden shadow-2xl">
          {/* The photo they took */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={capturedImage} alt="Scanning" className="w-full h-full object-cover" />

          {/* Dark overlay */}
          <div className="absolute inset-0 bg-black/30" />

          {/* Scanning line animation */}
          <div className="absolute inset-x-0 h-[3px] bg-gradient-to-r from-transparent via-green-400 to-transparent shadow-[0_0_15px_rgba(74,222,128,0.6)] animate-scan-line" />

          {/* Corner brackets */}
          <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-green-400 rounded-tl-lg" />
          <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-green-400 rounded-tr-lg" />
          <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-green-400 rounded-bl-lg" />
          <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-green-400 rounded-br-lg" />

          {/* Status text */}
          <div className="absolute bottom-8 inset-x-0 text-center">
            <div className="inline-flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-4 py-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <p className="text-white text-[13px] font-semibold">Identifying containers...</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center">
          <Camera className="w-10 h-10 text-green-400 animate-pulse mx-auto mb-3" />
          <p className="text-white text-lg font-display font-bold">Identifying...</p>
        </div>
      )}
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
          {aiMessage && !apiError && <p className="text-slate-500 text-[13px] mt-1">{aiMessage}</p>}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {eligible.length === 0 && !apiError && (
            <div className="text-center py-12">
              <Camera className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-[15px] font-semibold mb-2">{aiMessage || "No containers detected"}</p>
              {!aiMessage && <p className="text-slate-400 text-[13px]">Try a clearer photo with better lighting</p>}
            </div>
          )}

          {eligible.length > 0 && (
            <div className="space-y-2">
              {eligible.map((item, i) => (
                <div key={i} className="flex items-center gap-3 p-3.5 rounded-2xl border border-slate-200">
                  <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Check className="w-5 h-5 text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-slate-900 font-semibold">{item.name}</p>
                    <p className="text-[12px] text-slate-500">5c each &middot; sort into your own bags today</p>
                  </div>
                  <span className="text-[15px] font-display font-extrabold text-slate-900">&times;{item.count}</span>
                </div>
              ))}

              <div className="mt-4 p-4 bg-green-50 rounded-2xl border border-green-100">
                <p className="text-[12px] text-slate-700 font-medium">
                  Keep it in your sorted bags. When suburb volume unlocks a run, bag out — we take them to a refund point.
                </p>
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
            {total > 0 ? (
              <button onClick={confirm}
                className="flex-[2] bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 flex items-center justify-center gap-2 min-h-[48px]"
                style={{ touchAction: "manipulation" }}>
                <Check className="w-5 h-5" /> Done &middot; +{total * 5}c
              </button>
            ) : (
              <button onClick={() => window.location.href = "/sort"}
                className="flex-1 py-3.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-[13px] flex items-center justify-center gap-2 min-h-[48px]"
                style={{ touchAction: "manipulation" }}>
                <Home className="w-4 h-4" /> Home
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
          {bin ? bin.name : "Scan a container · 5¢"}
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
          {/* File input — always available, primary when camera not ready */}
          <label className={`rounded-full flex items-center justify-center cursor-pointer transition-all ${
            !cameraReady ? "w-[72px] h-[72px] bg-green-500 shadow-lg" : "w-12 h-12 bg-white/10"
          }`} style={{ touchAction: "manipulation" }}>
            <ImagePlus className={`${!cameraReady ? "w-8 h-8 text-white" : "w-5 h-5 text-white/60"}`} />
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileCapture} />
          </label>

          {/* Main capture button — only when camera is live */}
          {cameraReady && (
            <button
              onClick={capture}
              className="rounded-full bg-white active:scale-90 transition-transform"
              style={{ width: "72px", height: "72px", border: "4px solid rgba(255,255,255,0.4)", touchAction: "manipulation" }}
            />
          )}

          {/* Home button */}
          <button onClick={() => window.location.href = "/sort"}
            className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center"
            style={{ touchAction: "manipulation" }}>
            <X className="w-5 h-5 text-white/60" />
          </button>
        </div>

        {/* Status text */}
        <p className="text-white/30 text-[12px] text-center pb-1">
          {cameraDenied
            ? "Camera blocked — tap the green button to use your photo gallery"
            : cameraReady
            ? "Tap the white button to capture, or use the gallery"
            : "Tap the green button to take a photo"}
        </p>
      </div>
    </div>
  );
}

// ── Shared ──

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-white flex flex-col items-center justify-center px-6 overflow-y-auto"><div className="w-full max-w-sm text-center py-8">{children}</div></div>;
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
