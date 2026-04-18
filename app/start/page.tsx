"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Mail, ShieldCheck, Package, Tags, Camera, Check, ChevronRight } from "lucide-react";
import { apiUrl } from "@/lib/config";
import { Logo } from "@/app/components/shared/logo";
// BAGS import removed — 4-bag steps are dead code (flow goes to /onboard after verify)

type Step = "email" | "verify" | "bins" | "labels" | "firstsort" | "analyzing" | "sortresult" | "done";

interface IdentifiedItem {
  name: string; material: string; count: number; eligible: boolean;
}

export default function StartPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");

  // Auth
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  // First sort
  const [results, setResults] = useState<IdentifiedItem[]>([]);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  // Progress
  const stepNum = { email: 0, verify: 0, bins: 1, labels: 2, firstsort: 3, analyzing: 3, sortresult: 3, done: 4 }[step];

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
      const referrerId = (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("r") : null) || undefined;
      const res = await fetch(apiUrl("/api/auth/verify-otp"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: otp, referrerId }),
      });
      if (!res.ok) { setAuthError("Invalid code"); setAuthLoading(false); return; }
      const data = await res.json();
      localStorage.setItem("goodsort_token", data.token);
      localStorage.setItem("goodsort_profile", JSON.stringify(data.profile));
      document.cookie = `goodsort_token=${data.token}; path=/; max-age=${30*24*60*60}; SameSite=Lax; Secure`;
      // If they already have a household with council day, skip onboarding
      if (data.profile.householdId) {
        router.push("/");
      } else {
        router.push("/onboard");
      }
    } catch { setAuthError("Verification failed"); }
    setAuthLoading(false);
  }

  // ── First sort camera ──
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await new Promise<void>((resolve) => {
          videoRef.current!.addEventListener("loadedmetadata", () => resolve(), { once: true });
        });
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch {
      setCameraReady(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  // Start camera when entering firstsort step
  useEffect(() => {
    if (step === "firstsort") startCamera();
    return () => { if (step === "firstsort") stopCamera(); };
  }, [step, startCamera, stopCamera]);

  async function captureFirstSort() {
    if (!videoRef.current || !canvasRef.current) return;
    setStep("analyzing");

    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    stopCamera();

    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    setCapturedImage(dataUrl);
    const base64 = dataUrl.split(",")[1];

    try {
      const res = await fetch(apiUrl("/api/scan/photo"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64 }),
      });
      if (res.ok) {
        const data = await res.json();
        setResults(data.containers || []);
      }
    } catch { setResults([]); }
    setStep("sortresult");
  }

  return (
    <div className="min-h-dvh bg-white flex flex-col overflow-y-auto overscroll-none" style={{ paddingTop: "env(safe-area-inset-top,0)", paddingBottom: "max(env(safe-area-inset-bottom,0px), 1rem)" }}>
      {/* Progress bar */}
      {stepNum > 0 && (
        <div className="px-6 pt-4">
          <div className="flex gap-1.5">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${s <= stepNum ? "bg-green-500" : "bg-slate-200"}`} />
            ))}
          </div>
          <p className="text-[12px] text-slate-400 mt-2 text-center">Step {stepNum} of 4</p>
        </div>
      )}

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-sm">

          {/* ═══ EMAIL ═══ */}
          {step === "email" && (
            <>
              <div className="text-center mb-8">
                <div className="flex justify-center mb-5">
                  <Logo size="lg" />
                </div>
                <p className="text-slate-400 text-[14px]">We pick up cans & bottles straight from your yellow bin.</p>
                <p className="text-slate-400 text-[12px] mt-1">10¢ per container · right to your bank · you do nothing different</p>
              </div>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email"
                onFocus={(e) => setTimeout(() => e.target.scrollIntoView({ behavior: "smooth", block: "center" }), 300)}
                className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500 mb-3" autoFocus />
              {authError && <p className="text-red-500 text-[12px] mb-2">{authError}</p>}
              <GreenButton onClick={sendOtp} disabled={authLoading || !email.includes("@")}>
                {authLoading ? "Sending code..." : "Get Started"}
              </GreenButton>
              <p className="text-center text-[12px] text-slate-400 mt-4">We'll send a verification code to your email</p>
            </>
          )}

          {/* ═══ VERIFY ═══ */}
          {step === "verify" && (
            <>
              <div className="text-center mb-8">
                <IconBubble><ShieldCheck className="w-8 h-8 text-green-600" /></IconBubble>
                <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-1">Check your email</h1>
                <p className="text-slate-400 text-[13px]">Code sent to {email}</p>
              </div>
              <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="000000"
                className="w-full text-center text-3xl font-display font-extrabold tracking-[0.3em] border border-slate-200 rounded-xl px-4 py-4 text-slate-900 placeholder-slate-200 focus:outline-none focus:ring-2 focus:ring-green-500/30 mb-3" autoFocus />
              {authError && <p className="text-red-500 text-[12px] mb-2 text-center">{authError}</p>}
              <GreenButton onClick={verifyOtp} disabled={authLoading || otp.length < 6}>
                {authLoading ? "Verifying..." : "Verify"}
              </GreenButton>
            </>
          )}

          {/* Old steps (bins/labels/firstsort/analyzing/sortresult/done) removed —
               flow now goes verify → /onboard (yellow-bin + 8-stream model) */}

          {/* ═══ DONE (fallback — shouldn't reach here but just in case) ═══ */}
          {(step !== "email" && step !== "verify") && (
            <>
              <div className="text-center mb-6">
                <div className="flex justify-center mb-5">
                  <Logo size="lg" />
                </div>
                <h1 className="text-3xl font-display font-extrabold text-slate-900 mb-2">You're all set!</h1>
                <p className="text-slate-500 text-[14px] mb-1">Your GoodSort bin does the sorting — we do the rest</p>
                <p className="text-slate-400 text-[13px]">We'll email you <span className="font-semibold text-green-600">24 hours before collection</span></p>
              </div>

              <div className="bg-green-50 rounded-2xl p-5 border border-green-200 mb-6">
                <h3 className="text-[13px] font-bold text-green-800 mb-2">What happens next:</h3>
                <div className="space-y-2.5">
                  <div className="flex gap-2.5">
                    <span className="text-green-600 text-[13px]">♻️</span>
                    <p className="text-[12px] text-green-700">Sort your containers as you use them</p>
                  </div>
                  <div className="flex gap-2.5">
                    <span className="text-green-600 text-[13px]">📸</span>
                    <p className="text-[12px] text-green-700">Not sure which bin? Open the app and photo it</p>
                  </div>
                  <div className="flex gap-2.5">
                    <span className="text-green-600 text-[13px]">📧</span>
                    <p className="text-[12px] text-green-700">We'll email you 24hrs before we collect</p>
                  </div>
                  <div className="flex gap-2.5">
                    <span className="text-green-600 text-[13px]">💰</span>
                    <p className="text-[12px] text-green-700">Earn 5c per container, cash out at $20</p>
                  </div>
                </div>
              </div>

              <GreenButton onClick={() => router.push("/scan")}>
                Start Sorting <ChevronRight className="w-5 h-5 inline" />
              </GreenButton>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

function GreenButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20 disabled:opacity-50 transition-all min-h-[48px] flex items-center justify-center">
      {children}
    </button>
  );
}

function IconBubble({ children }: { children: React.ReactNode }) {
  return <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">{children}</div>;
}
