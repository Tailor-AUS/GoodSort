"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Camera, MapPin, RotateCcw, Check, Mail, ShieldCheck } from "lucide-react";
import { apiUrl } from "@/lib/config";
import { BAGS, getBagForMaterial, mapToMaterialType } from "@/lib/store";

interface BinInfo {
  id: string; code: string; name: string; address: string; hostedBy: string | null;
}
interface IdentifiedItem {
  name: string; material: string; count: number; eligible: boolean;
}

type Step = "loading" | "no-bin" | "error" | "auth" | "verify" | "camera" | "analyzing" | "results" | "done";

function ScanPageContent() {
  const searchParams = useSearchParams();
  const binCode = searchParams.get("bin");

  const [step, setStep] = useState<Step>("loading");
  const [bin, setBin] = useState<BinInfo | null>(null);

  // Auth
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Camera
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Results
  const [results, setResults] = useState<IdentifiedItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);

  // ── Load bin + check auth ──
  useEffect(() => {
    const token = localStorage.getItem("goodsort_token");

    if (!binCode) {
      // No bin code — if logged in, go straight to camera (scan containers directly)
      if (token) {
        setStep("camera");
      } else {
        setStep("auth");
      }
      return;
    }

    // Has bin code — look it up
    fetch(apiUrl(`/api/bins/code/${binCode}`))
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => {
        setBin(d);
        setStep(token ? "camera" : "auth");
      })
      .catch(() => setStep("error"));
  }, [binCode]);

  // ── Auth: send OTP ──
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

  // ── Auth: verify OTP ──
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
  const [cameraReady, setCameraReady] = useState(false);

  const startCamera = useCallback(async () => {
    setCameraReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch (err) {
      console.error("Camera failed:", err);
      setCameraReady(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
  }, []);

  useEffect(() => {
    if (step === "camera") startCamera();
    return () => stopCamera();
  }, [step, startCamera, stopCamera]);

  // ── Capture + AI ──
  async function capture() {
    if (!videoRef.current || !canvasRef.current) return;
    setStep("analyzing");

    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    const base64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
    stopCamera();

    try {
      const res = await fetch(apiUrl("/api/scan/photo"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, binCode }),
      });
      if (!res.ok) { setResults([]); setStep("results"); return; }
      const data = await res.json();
      setResults(data.containers || []);
    } catch { setResults([]); }
    setStep("results");
  }

  // ── Confirm sort ──
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

  function retake() { setResults([]); setStep("camera"); }
  function sortMore() { setTotalItems(0); setResults([]); setStep("camera"); }

  // ════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════

  // Loading
  if (step === "loading") return <Center><p className="text-slate-400">Loading...</p></Center>;

  // No bin
  if (step === "no-bin") return (
    <Center>
      <IconCircle><Camera className="w-8 h-8 text-green-600" /></IconCircle>
      <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-2">Scan a Bin QR Code</h1>
      <p className="text-slate-400 text-[13px]">Find a Good Sort bin and scan the QR code to start</p>
    </Center>
  );

  // Error
  if (step === "error") return (
    <Center>
      <h1 className="text-xl font-display font-extrabold text-slate-900 mb-2">Bin Not Found</h1>
      <p className="text-slate-400 text-[13px]">Code &quot;{binCode}&quot; not recognised</p>
    </Center>
  );

  // Auth — email entry
  if (step === "auth") return (
    <div className="h-dvh bg-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <BinBadge bin={bin} />
        <div className="text-center mb-8">
          <IconCircle><Mail className="w-7 h-7 text-green-600" /></IconCircle>
          <h1 className="text-xl font-display font-extrabold text-slate-900 mb-1">Enter your email</h1>
          <p className="text-slate-400 text-[13px]">To earn 5c per container sorted</p>
        </div>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
          className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500 mb-3" autoFocus />
        {authError && <p className="text-red-500 text-[12px] mb-2">{authError}</p>}
        <button onClick={sendOtp} disabled={authLoading || !email.includes("@")}
          className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 min-h-[48px]">
          {authLoading ? "Sending..." : "Continue"}
        </button>
      </div>
    </div>
  );

  // Verify OTP
  if (step === "verify") return (
    <div className="h-dvh bg-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <BinBadge bin={bin} />
        <div className="text-center mb-8">
          <IconCircle><ShieldCheck className="w-7 h-7 text-green-600" /></IconCircle>
          <h1 className="text-xl font-display font-extrabold text-slate-900 mb-1">Check your email</h1>
          <p className="text-slate-400 text-[13px]">Code sent to {email}</p>
        </div>
        <input type="text" inputMode="numeric" maxLength={6} value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="000000"
          className="w-full text-center text-3xl font-display font-extrabold tracking-[0.3em] border border-slate-200 rounded-xl px-4 py-4 text-slate-900 placeholder-slate-200 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500 mb-3" autoFocus />
        {authError && <p className="text-red-500 text-[12px] mb-2 text-center">{authError}</p>}
        <button onClick={verifyOtp} disabled={authLoading || otp.length < 6}
          className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 min-h-[48px]">
          {authLoading ? "Verifying..." : "Verify"}
        </button>
        <button onClick={() => { setStep("auth"); setOtp(""); }}
          className="w-full text-slate-400 text-[13px] font-medium py-2 mt-2">Different email</button>
      </div>
    </div>
  );

  // Done
  if (step === "done") return (
    <Center>
      <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
        <Check className="w-8 h-8 text-green-600" />
      </div>
      <p className="text-3xl font-display font-extrabold text-green-600 mb-2 animate-ka-ching">+{totalItems * 5}c</p>
      <h1 className="text-xl font-display font-extrabold text-slate-900 mb-1">Sorting credit earned!</h1>
      <p className="text-slate-500 text-[13px]">{totalItems} container{totalItems !== 1 ? "s" : ""} sorted{bin ? ` at ${bin.name}` : ""}</p>
      <p className="text-slate-400 text-[12px] mt-1">Pending until collected</p>
      <button onClick={sortMore}
        className="mt-6 w-full max-w-sm bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20">
        Sort More
      </button>
    </Center>
  );

  // Analyzing
  if (step === "analyzing") return (
    <div className="h-dvh bg-black flex items-center justify-center">
      <div className="text-center">
        <Camera className="w-10 h-10 text-green-400 animate-pulse mx-auto mb-3" />
        <p className="text-white text-lg font-display font-bold">Identifying...</p>
        <p className="text-white/40 text-[12px] mt-1">Finding containers in your photo</p>
      </div>
    </div>
  );

  // Results — sorting guide
  if (step === "results") {
    const eligible = results.filter((r) => r.eligible);
    const total = eligible.reduce((s, r) => s + r.count, 0);

    return (
      <div className="h-dvh bg-white flex flex-col" style={{ paddingTop: "env(safe-area-inset-top,0)", paddingBottom: "env(safe-area-inset-bottom,0)" }}>
        <div className="px-5 py-3 border-b border-slate-100">
          {bin && <p className="text-[12px] text-green-600 font-bold">{bin.code}</p>}
          <h2 className="text-[17px] font-display font-extrabold text-slate-900">
            {total > 0 ? `Sort ${total} container${total !== 1 ? "s" : ""}` : "No containers found"}
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {eligible.length === 0 ? (
            <div className="text-center py-12">
              <Camera className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-400 text-[13px]">No containers detected. Try better lighting.</p>
            </div>
          ) : (
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
            </div>
          )}

          {eligible.length > 0 && (
            <div className="mt-5 p-4 bg-slate-50 rounded-2xl border border-slate-200">
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
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100">
          <div className="flex gap-2">
            <button onClick={retake}
              className="flex-1 py-3.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-[13px] flex items-center justify-center gap-2 min-h-[48px]">
              <RotateCcw className="w-4 h-4" /> Retake
            </button>
            {total > 0 && (
              <button onClick={confirm}
                className="flex-[2] bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 flex items-center justify-center gap-2 min-h-[48px]">
                <Check className="w-5 h-5" /> Done &middot; +{total * 5}c
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Camera view
  return (
    <div className="h-dvh bg-black flex flex-col" style={{ paddingBottom: "env(safe-area-inset-bottom,0)" }}>
      <div className="px-5 pb-3 bg-black/80" style={{ paddingTop: "calc(env(safe-area-inset-top,16px) + 0.25rem)" }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-600/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <Camera className="w-5 h-5 text-green-400" />
          </div>
          <div>
            {bin ? (
              <>
                <p className="text-[12px] text-green-400 font-bold">{bin.code}</p>
                <p className="text-[15px] text-white font-display font-bold">{bin.name}</p>
              </>
            ) : (
              <p className="text-[15px] text-white font-display font-bold">Scan Your Containers</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 relative">
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted autoPlay />
        <canvas ref={canvasRef} className="hidden" />

        {cameraReady && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-[80%] h-[60%] border-2 border-white/20 rounded-3xl">
              <p className="text-white/40 text-[12px] text-center mt-4 font-medium">Place containers in frame</p>
            </div>
          </div>
        )}

        {!cameraReady && (
          <div className="absolute inset-0 bg-black flex items-center justify-center">
            <div className="text-center">
              <Camera className="w-10 h-10 text-white/30 mx-auto mb-2 animate-pulse" />
              <p className="text-white/40 text-[13px]">Starting camera...</p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-black/80 px-5 pt-4" style={{ paddingBottom: "max(1.5rem, calc(env(safe-area-inset-bottom, 0px) + 1rem))" }}>
        <div className="flex flex-col items-center gap-2">
          <button onClick={capture} disabled={!cameraReady}
            className="w-18 h-18 rounded-full bg-white border-4 border-white/30 shadow-lg active:scale-90 transition-transform disabled:opacity-30"
            style={{ width: "72px", height: "72px" }} />
          <p className="text-white/30 text-[12px] text-center">
            {cameraReady ? "Tap to photograph" : "Waiting for camera..."}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Shared components ──

function Center({ children }: { children: React.ReactNode }) {
  return <div className="h-dvh bg-white flex flex-col items-center justify-center px-6"><div className="w-full max-w-sm text-center">{children}</div></div>;
}

function IconCircle({ children }: { children: React.ReactNode }) {
  return <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">{children}</div>;
}

function BinBadge({ bin }: { bin: BinInfo | null }) {
  if (!bin) return null;
  return (
    <div className="flex items-center gap-2 justify-center mb-6">
      <MapPin className="w-3.5 h-3.5 text-green-600" />
      <span className="text-[12px] text-green-600 font-bold">{bin.code}</span>
      <span className="text-[12px] text-slate-400">{bin.name}</span>
    </div>
  );
}

export default function ScanPage() {
  return (
    <Suspense fallback={<Center><p className="text-slate-400">Loading...</p></Center>}>
      <ScanPageContent />
    </Suspense>
  );
}
