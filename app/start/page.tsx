"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Mail, ShieldCheck, Package, Tags, Camera, Check, ChevronRight } from "lucide-react";
import { apiUrl } from "@/lib/config";
import { Logo } from "@/app/components/shared/logo";
import { BAGS, getBagForMaterial, mapToMaterialType } from "@/lib/store";

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
      setStep("bins");
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
                <p className="text-slate-400 text-[14px]">Turn your empty cans and bottles into cash</p>
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

          {/* ═══ STEP 1: GET YOUR BINS ═══ */}
          {step === "bins" && (
            <>
              <div className="text-center mb-6">
                <IconBubble><Package className="w-8 h-8 text-green-600" /></IconBubble>
                <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-1">Get 4 containers</h1>
                <p className="text-slate-400 text-[13px]">Any containers — buckets, boxes, tubs, bags</p>
              </div>

              <div className="space-y-3 mb-6">
                {BAGS.map((bag) => (
                  <div key={bag.id} className="flex items-center gap-3 p-3.5 rounded-2xl border border-slate-200">
                    <div className={`w-10 h-10 ${bag.color} rounded-xl flex items-center justify-center flex-shrink-0`}>
                      <span className="text-lg">{bag.emoji}</span>
                    </div>
                    <div>
                      <p className="text-[14px] text-slate-900 font-semibold">Container {bag.id}: {bag.label.split(" ")[0]}</p>
                      <p className="text-[12px] text-slate-400">
                        {bag.material === "aluminium" && "Beer cans, soft drink cans, energy drinks"}
                        {bag.material === "pet" && "Water bottles, soft drink bottles, juice bottles"}
                        {bag.material === "glass" && "Beer stubbies, wine bottles, spirit bottles"}
                        {bag.material === "other" && "Cartons, poppers, flavoured milk"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <GreenButton onClick={() => setStep("labels")}>
                I've got my 4 containers <Check className="w-5 h-5 inline ml-1" />
              </GreenButton>
            </>
          )}

          {/* ═══ STEP 2: LABEL THEM ═══ */}
          {step === "labels" && (
            <>
              <div className="text-center mb-6">
                <IconBubble><Tags className="w-8 h-8 text-green-600" /></IconBubble>
                <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-1">Label your containers</h1>
                <p className="text-slate-400 text-[13px]">Write on them, stick a label, or use our printable designs</p>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                {BAGS.map((bag) => (
                  <div key={bag.id} className={`rounded-2xl p-4 text-center border-2 ${bag.borderColor} bg-white`}>
                    <div className={`w-14 h-14 ${bag.color} rounded-2xl mx-auto mb-2 flex items-center justify-center shadow-md`}>
                      <span className="text-2xl">{bag.emoji}</span>
                    </div>
                    <p className="text-[15px] font-display font-extrabold text-slate-900">{bag.id}</p>
                    <p className="text-[12px] text-slate-500 font-semibold uppercase tracking-wider mt-0.5">
                      {bag.material === "aluminium" && "CANS"}
                      {bag.material === "pet" && "PLASTIC"}
                      {bag.material === "glass" && "GLASS"}
                      {bag.material === "other" && "OTHER"}
                    </p>
                  </div>
                ))}
              </div>

              <p className="text-center text-[12px] text-slate-400 mb-4">
                Just write 1, 2, 3, 4 on your bins — or screenshot these labels
              </p>

              <GreenButton onClick={() => setStep("firstsort")}>
                Bins are labeled <Check className="w-5 h-5 inline ml-1" />
              </GreenButton>
            </>
          )}

          {/* ═══ STEP 3: FIRST SORT (full camera view) ═══ */}
          {step === "firstsort" && (
            <div className="fixed inset-0 bg-black flex flex-col z-50" style={{ paddingBottom: "env(safe-area-inset-bottom,0)" }}>
              <div className="px-5 pb-3" style={{ paddingTop: "calc(env(safe-area-inset-top,16px) + 0.25rem)" }}>
                <h2 className="text-[15px] font-display font-bold text-white">Your first sort!</h2>
                <p className="text-white/50 text-[12px]">Point at an empty can or bottle</p>
              </div>

              <div className="flex-1 relative">
                <video ref={videoRef} className="w-full h-full object-cover" playsInline muted autoPlay />
                <canvas ref={canvasRef} className="hidden" />

                {cameraReady && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-[75%] h-[55%] border-2 border-white/20 rounded-3xl">
                      <p className="text-white/40 text-[12px] text-center mt-4 font-medium">Place container in frame</p>
                    </div>
                  </div>
                )}

                {!cameraReady && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <Camera className="w-10 h-10 text-white/30 mx-auto mb-2 animate-pulse" />
                      <p className="text-white/40 text-[13px]">Starting camera...</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-black/80 px-5 py-5">
                <div className="flex flex-col items-center gap-3">
                  <button onClick={captureFirstSort} disabled={!cameraReady}
                    className="w-16 h-16 rounded-full bg-white border-4 border-white/30 shadow-lg active:scale-90 transition-transform disabled:opacity-30" />
                  <p className="text-white/30 text-[12px] text-center">Tap to photograph your container</p>
                </div>
              </div>

              <button onClick={() => { stopCamera(); setStep("done"); }}
                className="absolute top-4 right-4 text-white/50 text-[13px] font-medium p-2"
                style={{ top: "calc(env(safe-area-inset-top,16px) + 0.25rem)" }}>
                Skip
              </button>
            </div>
          )}

          {/* ═══ ANALYZING ═══ */}
          {step === "analyzing" && (
            <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
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
                <div className="text-center">
                  <Camera className="w-10 h-10 text-green-400 animate-pulse mx-auto mb-3" />
                  <p className="text-white text-lg font-display font-bold">Identifying...</p>
                </div>
              )}
            </div>
          )}

          {/* ═══ SORT RESULT ═══ */}
          {step === "sortresult" && (
            <>
              <div className="text-center mb-6">
                <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-1">
                  {results.length > 0 ? "Here's where it goes!" : "No container found"}
                </h1>
              </div>

              {results.filter((r) => r.eligible).map((item, i) => {
                const bag = getBagForMaterial(mapToMaterialType(item.material));
                return (
                  <div key={i} className="flex items-center gap-3 p-4 rounded-2xl border-2 border-green-200 bg-green-50 mb-3">
                    <div className={`w-12 h-12 ${bag.color} rounded-xl flex items-center justify-center flex-shrink-0 shadow-md`}>
                      <span className="text-xl">{bag.emoji}</span>
                    </div>
                    <div>
                      <p className="text-[15px] text-slate-900 font-bold">{item.name}</p>
                      <p className="text-[13px] text-green-700 font-semibold">
                        → Put in Container {bag.id} ({bag.label.split(" ")[0]})
                      </p>
                    </div>
                  </div>
                );
              })}

              {results.length === 0 && (
                <div className="bg-slate-50 rounded-2xl p-6 text-center mb-4">
                  <p className="text-slate-400 text-[13px]">Couldn't identify a container. Try again with better lighting!</p>
                </div>
              )}

              <GreenButton onClick={() => setStep("done")}>
                {results.length > 0 ? "Got it! " : "Skip for now "}
                <ChevronRight className="w-5 h-5 inline" />
              </GreenButton>
            </>
          )}

          {/* ═══ DONE ═══ */}
          {step === "done" && (
            <>
              <div className="text-center mb-6">
                <div className="flex justify-center mb-5">
                  <Logo size="lg" />
                </div>
                <h1 className="text-3xl font-display font-extrabold text-slate-900 mb-2">You're all set!</h1>
                <p className="text-slate-500 text-[14px] mb-1">Start sorting your containers into your 4 bins</p>
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
