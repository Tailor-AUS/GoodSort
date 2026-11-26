"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { fitWithin, scanErrorMessage, QUALITY_LADDER, TARGET_BASE64_CHARS } from "@/lib/image-budget";
import { useSearchParams, useRouter } from "next/navigation";
import { Camera, RotateCcw, Check, Mail, ShieldCheck, ImagePlus, X, Home, ScanBarcode, Zap, ZapOff, Plus } from "lucide-react";
import { track } from "@/lib/analytics";
import { apiUrl, authHeaders, persistWaitlistFromUrl, readReferrerId, hasValidToken, clearAuth } from "@/lib/config";
import { lookupContainerAsync } from "@/lib/containers";
import { addScanApi, flushUnsyncedScans } from "@/lib/store-api";
import { streamGuideForMaterial } from "@/lib/marketplace";
import { PostScanSetup } from "@/app/components/shared/post-scan-setup";
import { GlassBackdrop } from "@/app/components/shared/glass-backdrop";
import { Logo } from "@/app/components/shared/logo";

interface BinInfo {
  id: string; code: string; name: string; address: string; hostedBy: string | null;
}
interface IdentifiedItem {
  name: string; material: string; count: number; eligible: boolean; barcode?: string;
}

/** Holds a capture or barcode across the OTP round-trip (sessionStorage + localStorage fallback). */
const PENDING_CAPTURE_KEY = "goodsort_pending_capture";
const PENDING_BARCODE_KEY = "goodsort_pending_barcode";
const PENDING_EMAIL_KEY = "goodsort_pending_email";

type Step = "loading" | "auth" | "verify" | "camera" | "analyzing" | "results" | "error" | "done";

function ScanPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const binCode = searchParams.get("bin");

  const [step, setStep] = useState<Step>("loading");
  const [bin, setBin] = useState<BinInfo | null>(null);
  const [apiError, setApiError] = useState(false);
  // The status behind apiError, so the member is told what actually happened.
  // A 413 described as a connection problem sends them to retry a request that
  // fails identically every time.
  const [apiStatus, setApiStatus] = useState<number | null>(null);

  // Auth
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  // Seconds until "Resend code" is available again. Declared here with the
  // other hooks, above every early return — see lib/hook-order.test.ts.
  const [resendIn, setResendIn] = useState(0);
  const [devCode, setDevCode] = useState("");

  // Camera
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraDenied, setCameraDenied] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [shutterFlash, setShutterFlash] = useState(false);

  // Rapid-fire multi-can batch session state (all hooks declared above early returns)
  const [sessionBatch, setSessionBatch] = useState<{
    count: number;
    cents: number;
    lastLabel: string;
    lastBag: string;
  }>({ count: 0, cents: 0, lastLabel: "", lastBag: "" });
  const [batchToast, setBatchToast] = useState<{
    title: string;
    subtitle: string;
    refused?: boolean;
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Results
  const [results, setResults] = useState<IdentifiedItem[]>([]);
  const [aiMessage, setAiMessage] = useState("");
  const [totalItems, setTotalItems] = useState(0);
  const [quotedCents, setQuotedCents] = useState<number | null>(null);
  const [confirmedCents, setConfirmedCents] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [hasHousehold, setHasHousehold] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  // Signed token committing to the vision result — /confirm reads the items
  // out of this server-side, so the client can't fabricate eligible counts.
  const [scanToken, setScanToken] = useState<string | null>(null);

  // Barcode & offline queue mode (all hooks declared above early returns)
  const [scanMode, setScanMode] = useState<"photo" | "barcode">("photo");
  const [manualBarcode, setManualBarcode] = useState("");
  const [barcodeBusy, setBarcodeBusy] = useState(false);
  const [barcodeError, setBarcodeError] = useState("");
  const barcodeLockRef = useRef(false);

  // Parallel pre-auth AI classification: kicks off while the user fetches their 6-digit OTP
  type PreScanPayload = {
    containers: IdentifiedItem[];
    message: string;
    scanToken: string | null;
    totalCents: number | null;
  };
  const preScanPromiseRef = useRef<Promise<PreScanPayload | null> | null>(null);
  const preScanResultRef = useRef<PreScanPayload | null>(null);
  const preScanEmailRef = useRef<string | null>(null);
  const [preScanStatus, setPreScanStatus] = useState<"idle" | "running" | "ready" | "failed">("idle");

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function triggerHaptic(ms = 14) {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      try { navigator.vibrate(ms); } catch { /* unsupported */ }
    }
  }

  function flashBatchToast(toast: { title: string; subtitle: string; refused?: boolean }) {
    setBatchToast(toast);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setBatchToast(null), 2600);
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !torchSupported) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
      triggerHaptic(10);
    } catch {
      setTorchSupported(false);
    }
  }

  function finishBatchSession() {
    stopCamera();
    setResults([]);
    setTotalItems(0);
    setConfirmedCents(0);
    setQuotedCents(0);
    setStep("done");
  }

  function toPreviewDataUrl(rawOrDataUrl: string): string {
    return rawOrDataUrl.startsWith("data:") ? rawOrDataUrl : `data:image/jpeg;base64,${rawOrDataUrl}`;
  }

  function openCamera() {
    track("scan_camera_opened");
    setStep("camera");
  }

  async function processBarcode(rawCode: string) {
    const cleaned = rawCode.replace(/\D/g, "").trim();
    if (cleaned.length < 8 || cleaned.length > 14 || barcodeLockRef.current) {
      if (rawCode.trim()) setBarcodeError("Enter an 8 to 14-digit container barcode (EAN / UPC).");
      return;
    }
    barcodeLockRef.current = true;
    setBarcodeBusy(true);
    setBarcodeError("");
    track("scan_captured");

    if (!hasValidToken()) {
      try { sessionStorage.setItem(PENDING_BARCODE_KEY, cleaned); } catch { /* ignore */ }
      try { localStorage.setItem(PENDING_BARCODE_KEY, cleaned); } catch { /* ignore */ }
      stopCamera();
      setBarcodeBusy(false);
      barcodeLockRef.current = false;
      setStep("auth");
      return;
    }

    // Rapid-fire batch barcode mode for signed-in home sorting (!binCode):
    // credits immediately in the viewfinder without tearing down the camera.
    if (!binCode) {
      try {
        const found = await lookupContainerAsync(cleaned);
        const guide = streamGuideForMaterial(found.material, found.name);
        const saved = await addScanApi(cleaned, found.name, guide.stream);
        try {
          sessionStorage.removeItem(PENDING_BARCODE_KEY);
          localStorage.removeItem(PENDING_BARCODE_KEY);
        } catch { /* ignore */ }
        if (saved.refused) {
          flashBatchToast({
            title: "Daily scan limit reached",
            subtitle: "Try again tomorrow — scan not added.",
            refused: true,
          });
        } else {
          const credited = saved.creditedCents ?? 8;
          triggerHaptic(18);
          trackScanCredited();
          setSessionBatch((prev) => ({
            count: prev.count + 1,
            cents: prev.cents + credited,
            lastLabel: found.name,
            lastBag: guide.bagName,
          }));
          flashBatchToast({
            title: `+${credited}¢ · ${found.name}`,
            subtitle: `Put in ${guide.bagName} (${guide.shortLabel})`,
          });
          setManualBarcode("");
        }
      } catch {
        setBarcodeError("Could not look up that barcode right now. Try again.");
      } finally {
        setBarcodeBusy(false);
        setTimeout(() => { barcodeLockRef.current = false; }, 1500);
      }
      return;
    }

    try {
      stopCamera();
      const found = await lookupContainerAsync(cleaned);
      const guide = streamGuideForMaterial(found.material, found.name);
      setResults([{
        name: `${found.name} (${guide.bagName} · GSB-${guide.codePrefix})`,
        material: guide.stream,
        count: 1,
        eligible: true,
        barcode: cleaned,
      }]);
      setScanToken(null);
      setQuotedCents(8);
      setApiError(false);
      setAiMessage(`Barcode ${cleaned} matched — place into your ${guide.bagName} (${guide.label}).`);
      try {
        sessionStorage.removeItem(PENDING_BARCODE_KEY);
        localStorage.removeItem(PENDING_BARCODE_KEY);
      } catch { /* ignore */ }
      setStep("results");
    } catch {
      setBarcodeError("Could not look up that barcode right now. Try again.");
    } finally {
      setBarcodeBusy(false);
      barcodeLockRef.current = false;
    }
  }

  // ── Init & Offline Scan Flush ──
  useEffect(() => {
    persistWaitlistFromUrl();
    if (hasValidToken()) {
      void flushUnsyncedScans();
    }
    const onOnline = () => {
      if (hasValidToken()) void flushUnsyncedScans();
    };
    window.addEventListener("online", onOnline);
    try {
      const p = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
      setHasHousehold(Boolean(p?.householdId));
    } catch { /* ignore */ }
    if (binCode) {
      fetch(apiUrl(`/api/bins/code/${binCode}`))
        .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
        .then((d) => setBin(d))
        .catch(() => {});
    }
    const pendingBarcode = sessionStorage.getItem(PENDING_BARCODE_KEY) || localStorage.getItem(PENDING_BARCODE_KEY);
    const pending = sessionStorage.getItem(PENDING_CAPTURE_KEY);
    const pendingEmail = sessionStorage.getItem(PENDING_EMAIL_KEY) || localStorage.getItem(PENDING_EMAIL_KEY);
    if (pendingBarcode && hasValidToken()) {
      void processBarcode(pendingBarcode);
      return () => window.removeEventListener("online", onOnline);
    }
    if (pending && hasValidToken()) {
      setCapturedImage(toPreviewDataUrl(pending));
      void analyzeImage(pending);
      return () => window.removeEventListener("online", onOnline);
    }
    if ((pending || pendingBarcode) && pendingEmail && !hasValidToken()) {
      setEmail(pendingEmail);
      if (pending) setCapturedImage(toPreviewDataUrl(pending));
      setStep("verify");
      return () => window.removeEventListener("online", onOnline);
    }
    openCamera();
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot land
  }, [binCode]);

  // Live camera barcode decoding when Barcode mode is selected
  useEffect(() => {
    if (step !== "camera" || scanMode !== "barcode" || !cameraReady || !videoRef.current) return;
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    type NativeBarcodeDetector = {
      detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
    };
    const DetectorCtor = (window as unknown as {
      BarcodeDetector?: new (opts: { formats: string[] }) => NativeBarcodeDetector;
    }).BarcodeDetector;

    if (DetectorCtor) {
      try {
        const detector = new DetectorCtor({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
        timer = setInterval(async () => {
          if (!active || !videoRef.current || barcodeLockRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const raw = codes[0]?.rawValue;
            if (raw && /^\d{8,14}$/.test(raw)) {
              void processBarcode(raw);
            }
          } catch { /* ignore frame */ }
        }, 350);
      } catch { /* fall through */ }
    } else {
      void import("@zxing/browser").then(({ BrowserMultiFormatReader }) => {
        if (!active || !videoRef.current) return;
        const reader = new BrowserMultiFormatReader();
        timer = setInterval(async () => {
          if (!active || !videoRef.current || barcodeLockRef.current) return;
          try {
            const res = await reader.decodeOnceFromVideoElement(videoRef.current);
            const raw = res?.getText();
            if (raw && /^\d{8,14}$/.test(raw)) {
              void processBarcode(raw);
            }
          } catch { /* ignore frame */ }
        }, 700);
      }).catch(() => {});
    }

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bound to live camera mode
  }, [step, scanMode, cameraReady]);

  // ── Auth ──
  // Tick the resend cooldown down to zero.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendOtp() {
    if (!email.includes("@")) return;
    setAuthLoading(true); setAuthError("");
    try {
      track("otp_sent");
      const res = await fetch(apiUrl("/api/auth/send-otp"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({} as { error?: string; devCode?: string; preScanToken?: string }));
      if (!res.ok) {
        setAuthError(typeof data.error === "string" && data.error ? data.error : "Failed to send code");
        setAuthLoading(false);
        return;
      }
      if (typeof data.devCode === "string" && data.devCode) setDevCode(data.devCode);
      const trimmedEmail = email.trim().toLowerCase();
      try { sessionStorage.setItem(PENDING_EMAIL_KEY, trimmedEmail); } catch { /* ignore */ }
      try { localStorage.setItem(PENDING_EMAIL_KEY, trimmedEmail); } catch { /* ignore */ }

      // Kick off AI photo analysis in parallel while the user fetches their 6-digit OTP email.
      const pendingCapture = sessionStorage.getItem(PENDING_CAPTURE_KEY);
      if (pendingCapture && typeof data.preScanToken === "string" && data.preScanToken) {
        preScanResultRef.current = null;
        preScanEmailRef.current = trimmedEmail;
        setPreScanStatus("running");
        const ticket = data.preScanToken;
        preScanPromiseRef.current = fetch(apiUrl("/api/scan/photo/preview"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: pendingCapture, preScanToken: ticket, binCode }),
        })
          .then(async (r) => {
            if (!r.ok) return null;
            const json = await r.json();
            const parsed: PreScanPayload = {
              containers: json.containers || [],
              message: json.message || "",
              scanToken: json.scanToken || null,
              totalCents: typeof json.totalCents === "number" ? json.totalCents : null,
            };
            preScanResultRef.current = parsed;
            setPreScanStatus("ready");
            return parsed;
          })
          .catch(() => {
            setPreScanStatus("failed");
            return null;
          });
      }

      setStep("verify");
      setResendIn(30);
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        setAuthError(
          typeof data.error === "string" && data.error
            ? data.error
            : "That code did not work. Check it, or resend a new one.",
        );
        setAuthLoading(false);
        return;
      }
      const data = await res.json();
      track("otp_verified");
      localStorage.setItem("goodsort_token", data.token);
      localStorage.setItem("goodsort_profile", JSON.stringify(data.profile));
      setHasHousehold(Boolean(data.profile?.householdId));
      void flushUnsyncedScans();
      try {
        sessionStorage.removeItem(PENDING_EMAIL_KEY);
        localStorage.removeItem(PENDING_EMAIL_KEY);
      } catch { /* ignore */ }
      const pendingBarcode = sessionStorage.getItem(PENDING_BARCODE_KEY) || localStorage.getItem(PENDING_BARCODE_KEY);
      if (pendingBarcode) {
        setAuthLoading(false);
        await processBarcode(pendingBarcode);
        return;
      }
      const pending = sessionStorage.getItem(PENDING_CAPTURE_KEY);
      if (pending) {
        setCapturedImage(toPreviewDataUrl(pending));
        setAuthLoading(false);
        const trimmedEmail = email.trim().toLowerCase();
        if (preScanEmailRef.current === trimmedEmail && (preScanResultRef.current || preScanPromiseRef.current)) {
          let preData = preScanResultRef.current;
          if (!preData && preScanPromiseRef.current) {
            setStep("analyzing");
            preData = await preScanPromiseRef.current;
          }
          preScanPromiseRef.current = null;
          preScanResultRef.current = null;
          preScanEmailRef.current = null;
          setPreScanStatus("idle");
          if (preData) {
            setResults(preData.containers);
            setAiMessage(preData.message);
            setScanToken(preData.scanToken);
            setQuotedCents(preData.totalCents);
            setApiError(false);
            setApiStatus(null);
            try {
              sessionStorage.removeItem(PENDING_CAPTURE_KEY);
              sessionStorage.removeItem(PENDING_EMAIL_KEY);
            } catch { /* ignore */ }
            setStep("results");
            return;
          }
        }
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
      const videoTrack = stream.getVideoTracks()[0];
      const caps =
        videoTrack && typeof videoTrack.getCapabilities === "function"
          ? (videoTrack.getCapabilities() as MediaTrackCapabilities & { torch?: boolean })
          : null;
      setTorchSupported(Boolean(caps?.torch));
      setTorchOn(false);
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
    setTorchOn(false);
    setTorchSupported(false);
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

    triggerHaptic(12);
    setShutterFlash(true);
    setTimeout(() => setShutterFlash(false), 220);

    const { width, height } = fitWithin(video.videoWidth, video.videoHeight);
    if (width === 0 || height === 0) return;

    const canvas = canvasRef.current;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);
    stopCamera();

    let dataUrl = canvas.toDataURL("image/jpeg", QUALITY_LADDER[0]);
    for (const quality of QUALITY_LADDER) {
      const candidate = canvas.toDataURL("image/jpeg", quality);
      dataUrl = candidate;
      const body = candidate.split(",")[1] ?? "";
      if (body.length <= TARGET_BASE64_CHARS) break;
    }

    setCapturedImage(dataUrl);
    const base64 = dataUrl.split(",")[1];
    await analyzeImage(base64);
  }

  // ── Capture from file input (fallback) ──
  /**
   * Gallery photos have to be shrunk before they are sent.
   *
   * This used to post the raw file. The client accepted up to 10 MB while the
   * API refuses a base64 body over 2,000,000 characters (~1.5 MB of image), and
   * a photo off any recent phone is 2-5 MB — so every real gallery photo came
   * back 413 and the member was told to check their connection.
   *
   * That is the path the app itself recommends: with the camera denied, the
   * status line reads "tap the green button to use your photo gallery" and the
   * gallery button becomes the big green primary. So the recommended recovery
   * from a denied camera could not work at all.
   *
   * Re-encoding through a canvas is what the camera path already does, which is
   * why that one was fine.
   */
  function handleFileCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert("File too large (max 10 MB)"); return; }
    stopCamera();

    const reader = new FileReader();
    reader.onload = async () => {
      const original = reader.result as string;
      const dataUrl = await shrinkForUpload(original);
      setCapturedImage(dataUrl);
      const base64 = dataUrl.split(",")[1];
      await analyzeImage(base64);
    };
    reader.readAsDataURL(file);
  }

  /**
   * Bound the longest edge, then step down JPEG quality until the base64 body
   * is comfortably under what the API accepts. Returns the original if the
   * image cannot be decoded — better to attempt the upload and surface a real
   * error than to silently drop the member's photo.
   */
  async function shrinkForUpload(dataUrl: string): Promise<string> {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("decode failed"));
        i.src = dataUrl;
      });

      const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight);
      if (width === 0 || height === 0) return dataUrl;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return dataUrl;
      ctx.drawImage(img, 0, 0, width, height);

      for (const quality of QUALITY_LADDER) {
        const out = canvas.toDataURL("image/jpeg", quality);
        const body = out.split(",")[1] ?? "";
        if (body.length <= TARGET_BASE64_CHARS) return out;
      }
      // Still too big at the lowest quality — send it and let the member see a
      // real "too large" message rather than a connection one.
      return canvas.toDataURL("image/jpeg", QUALITY_LADDER[QUALITY_LADDER.length - 1]);
    } catch {
      return dataUrl;
    }
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
    setApiStatus(null);
    try {
      const res = await fetch(apiUrl("/api/scan/photo"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ image: base64, binCode }),
      });
      if (res.status === 401) {
        clearAuth();
        try { sessionStorage.setItem(PENDING_CAPTURE_KEY, base64); } catch { /* ignore */ }
        setStep("auth");
        return;
      }
      if (!res.ok) { setApiStatus(res.status); throw new Error("API error"); }
      const data = await res.json();
      setResults(data.containers || []);
      setAiMessage(data.message || "");
      setScanToken(data.scanToken || null);
      setQuotedCents(typeof data.totalCents === "number" ? data.totalCents : null);
      try {
        sessionStorage.removeItem(PENDING_CAPTURE_KEY);
        sessionStorage.removeItem(PENDING_EMAIL_KEY);
      } catch { /* ignore */ }
    } catch {
      setResults([]);
      setQuotedCents(null);
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

  async function confirmBarcodeItem(first: IdentifiedItem) {
    try {
      const saved = await addScanApi(first.barcode!, first.name, first.material);
      if (saved.refused) {
        setApiError(true);
        setAiMessage("Daily scan limit reached — try again tomorrow.");
        setStep("results");
        return;
      }
      setConfirmedCents(saved.creditedCents ?? quotedCents ?? 8);
      trackScanCredited();
      setStep("done");
    } catch {
      setConfirmedCents(8);
      trackScanCredited();
      setStep("done");
    } finally {
      setConfirming(false);
    }
  }

  // ── Confirm ──
  async function confirm() {
    if (confirming) return;
    setConfirming(true);
    const eligible = results
      .filter((r) => r.eligible)
      .map((r) => ({ ...r, count: Math.max(0, Math.min(100, r.count)) }));
    const total = eligible.reduce((s, r) => s + r.count, 0);
    setTotalItems(total);

    if (!scanToken && eligible.length > 0 && eligible[0].barcode && !binCode) {
      await confirmBarcodeItem(eligible[0]);
      return;
    }

    const userId = (() => { try { return JSON.parse(localStorage.getItem("goodsort_profile") || "{}").id || ""; } catch { return ""; } })();
    // Capture device location so the server can geofence the deposit against the
    // bin (anti-fraud for unattended bins). If the scan is bound to a bin, the
    // server requires this; for non-bin scans it's ignored, so do not block
    // at-home scans on a geolocation prompt/timeout.
    const loc = binCode ? await getDeviceLocation() : null;
    try {
      const res = await fetch(apiUrl("/api/scan/photo/confirm"), {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ scanToken, userId, items: eligible, binCode, lat: loc?.lat, lng: loc?.lng }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          clearAuth();
          setStep("auth");
          return;
        }
        // Surface geofence / verification failures instead of silently "done".
        const data = await res.json().catch(() => ({}));
        setApiError(true);
        setAiMessage(data.error || "Couldn't confirm this deposit. Please try again at the bin.");
        setStep("results");
        return;
      }
      const data = await res.json().catch(() => ({} as { totalCents?: number; totalContainers?: number }));
      if (typeof data.totalContainers === "number") {
        setTotalItems(data.totalContainers);
      }
      setConfirmedCents(typeof data.totalCents === "number" ? data.totalCents : quotedCents);
      triggerHaptic(18);
      trackScanCredited();
      setStep("done");
    } catch {
      setApiError(true);
      setAiMessage("Network connection dropped before confirmation could complete. Please tap Done to try again.");
      setStep("results");
    } finally {
      setConfirming(false);
    }
  }

  /** Bank confirmed photo items into the live batch session and immediately re-open the camera. */
  async function confirmAndScanNext() {
    if (confirming || binCode) return;
    setConfirming(true);
    const eligible = results
      .filter((r) => r.eligible)
      .map((r) => ({ ...r, count: Math.max(0, Math.min(100, r.count)) }));
    const total = eligible.reduce((s, r) => s + r.count, 0);
    if (total <= 0) {
      setConfirming(false);
      retake();
      return;
    }

    const userId = (() => { try { return JSON.parse(localStorage.getItem("goodsort_profile") || "{}").id || ""; } catch { return ""; } })();
    try {
      const res = await fetch(apiUrl("/api/scan/photo/confirm"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ scanToken, userId, items: eligible, binCode: null, lat: null, lng: null }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          clearAuth();
          setStep("auth");
          return;
        }
        const data = await res.json().catch(() => ({}));
        setApiError(true);
        setAiMessage(data.error || "Couldn't confirm this scan. Please tap Done or try again.");
        setStep("results");
        return;
      }
      const data = await res.json().catch(() => ({} as { totalCents?: number; totalContainers?: number }));
      const addedCount = typeof data.totalContainers === "number" ? data.totalContainers : total;
      const addedCents = typeof data.totalCents === "number" ? data.totalCents : (quotedCents ?? addedCount * 8);
      const firstGuide = streamGuideForMaterial(eligible[0].material, eligible[0].name);
      triggerHaptic(18);
      trackScanCredited();
      setSessionBatch((prev) => ({
        count: prev.count + addedCount,
        cents: prev.cents + addedCents,
        lastLabel: eligible[0].name,
        lastBag: firstGuide.bagName,
      }));
      flashBatchToast({
        title: `Banked +${addedCount} ${addedCount === 1 ? "can" : "cans"} (+${addedCents}¢)`,
        subtitle: `Put in ${firstGuide.bagName} · ready for next scan`,
      });
      setResults([]);
      setAiMessage("");
      setTotalItems(0);
      setScanToken(null);
      setQuotedCents(null);
      setConfirmedCents(null);
      setCapturedImage(null);
      setApiError(false);
      setCameraReady(false);
      setStep("camera");
    } catch {
      setApiError(true);
      setAiMessage("Network connection dropped before confirmation could complete. Please try again.");
      setStep("results");
    } finally {
      setConfirming(false);
    }
  }

  function retake() {
    setResults([]);
    setAiMessage("");
    setTotalItems(0);
    setScanToken(null);
    setQuotedCents(null);
    setConfirmedCents(null);
    setApiError(false);
    setCameraReady(false);
    setStep("camera");
  }

  // ════════════════════════════════════
  // RENDER
  // ════════════════════════════════════

  if (step === "loading") return <Center><p className="text-white/85 font-medium">Loading...</p></Center>;

  // Auth
  if (step === "auth") return (
    <Center>
      <IconBubble><Mail className="w-7 h-7 text-emerald-100" /></IconBubble>
      <h1 className="text-xl font-display font-extrabold text-white glass-text-shadow mb-1">Nice — where should we keep it?</h1>
      <p className="text-white/80 text-[13px] mb-6 leading-relaxed">
        Your photo is ready. Enter your email to save your 8¢ sorting credit — next we&apos;ll ask where to collect and pay you.
      </p>
      <input type="email" aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
        onFocus={(e) => setTimeout(() => e.target.scrollIntoView({ behavior: "smooth", block: "center" }), 300)}
        className="w-full bg-white/95 border border-white/70 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 focus:border-emerald-400 mb-3" autoFocus />
      {authError && <p className="rounded-xl bg-red-500/20 border border-red-200/40 px-3 py-2 text-red-100 text-[12px] mb-2">{authError}</p>}
      <GreenButton onClick={sendOtp} disabled={authLoading || !email.includes("@")}>
        {authLoading ? "Sending..." : "Continue"}
      </GreenButton>
    </Center>
  );

  if (step === "verify") return (
    <Center>
      <IconBubble><ShieldCheck className="w-7 h-7 text-emerald-100" /></IconBubble>
      <h1 className="text-xl font-display font-extrabold text-white glass-text-shadow mb-1">Check your email</h1>
      <p className="text-white/80 text-[13px] mb-4 leading-relaxed">Code sent to {email}. The code is in the subject line — check spam too. It expires in 15 minutes.</p>
      {preScanStatus === "running" && (
        <div className="liquid-glass-emerald rounded-xl px-3.5 py-2 text-[12px] font-medium text-white mb-4 text-center flex items-center justify-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
          Identifying your container in the background while you grab your code…
        </div>
      )}
      {preScanStatus === "ready" && (
        <div className="liquid-glass-emerald rounded-xl px-3.5 py-2 text-[12px] font-bold text-white mb-4 text-center flex items-center justify-center gap-1.5">
          <Check className="w-3.5 h-3.5 text-emerald-200" />
          Container identified — enter your code to reveal &amp; claim instantly.
        </div>
      )}
      {devCode && (
        <p className="bg-amber-500/25 border border-amber-200/40 rounded-lg px-3 py-2 text-xs font-mono text-amber-100 mb-3 text-center">
          Dev code: <strong>{devCode}</strong>
        </p>
      )}
      <input type="text" aria-label="6-digit verification code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="000000"
        className="w-full text-center text-3xl font-display font-extrabold tracking-[0.3em] bg-white/95 border border-white/70 rounded-xl px-4 py-4 text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 mb-3" autoFocus />
      {authError && <p className="rounded-xl bg-red-500/20 border border-red-200/40 px-3 py-2 text-red-100 text-[12px] mb-2 text-center">{authError}</p>}
      <GreenButton onClick={verifyOtp} disabled={authLoading || otp.length < 6}>
        {authLoading ? "Verifying..." : "Verify"}
      </GreenButton>

      {/*
        Without these the screen is a dead end. A mistyped address, a code that
        lapsed past its fifteen minutes, or one sitting in spam left the member
        with a six-digit box, no resend and no way back — on the primary funnel,
        since both landing-page CTAs route here.
      */}
      <div className="flex items-center justify-center gap-4 mt-4 text-[13px]">
        <button
          onClick={() => { setOtp(""); setAuthError(""); sendOtp(); }}
          disabled={authLoading || resendIn > 0}
          className="text-emerald-200 hover:text-white font-semibold disabled:text-white/40 min-h-[44px] px-2"
        >
          {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
        </button>
        <span className="text-white/35">·</span>
        <button
          onClick={() => {
            setOtp("");
            setAuthError("");
            setDevCode("");
            setResendIn(0);
            preScanPromiseRef.current = null;
            preScanResultRef.current = null;
            preScanEmailRef.current = null;
            setPreScanStatus("idle");
            try { sessionStorage.removeItem(PENDING_EMAIL_KEY); } catch { /* ignore */ }
            setStep("auth");
          }}
          className="text-white/80 hover:text-white font-semibold min-h-[44px] px-2"
        >
          Use a different email
        </button>
      </div>
    </Center>
  );

  // Done
  if (step === "done") {
    const currentEarned = confirmedCents ?? quotedCents ?? totalItems * 8;
    const earnedCents = sessionBatch.cents + currentEarned;
    const combinedItems = sessionBatch.count + totalItems;
    void hasHousehold;
    return (
      <PostScanSetup
        earnedCents={earnedCents}
        totalItems={combinedItems}
        binName={bin?.name ?? null}
        isPublicBinScan={Boolean(binCode)}
        onScanAnother={() => {
          setSessionBatch({ count: 0, cents: 0, lastLabel: "", lastBag: "" });
          retake();
        }}
      />
    );
  }

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

  // Results — Apple Liquid Glass sheet over sunlit veranda backdrop
  if (step === "results") {
    const eligible = results.filter((r) => r.eligible);
    const total = eligible.reduce((s, r) => s + r.count, 0);
    const displayCents = quotedCents ?? total * 8;
    const isBonusRate = total > 0 && displayCents > total * 8;

    return (
      <div className="fixed inset-0 flex flex-col z-50 text-white overflow-hidden" style={{ paddingTop: "env(safe-area-inset-top,0)", paddingBottom: "env(safe-area-inset-bottom,0)" }}>
        <GlassBackdrop />
        <div className="relative z-10 flex flex-col h-full max-w-md w-full mx-auto px-4 py-4">
          <div className="rounded-[24px] liquid-glass px-5 py-4 mb-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[19px] font-display font-extrabold text-white glass-text-shadow">
                {apiError ? "Connection error" : total > 0 ? `Sort ${total} container${total !== 1 ? "s" : ""}` : "No containers found"}
              </h2>
              {sessionBatch.count > 0 && (
                <span className="rounded-full bg-emerald-400/25 border border-emerald-200/45 px-2.5 py-0.5 text-[11px] font-bold text-emerald-100 tabular-nums shrink-0">
                  +{sessionBatch.count} banked
                </span>
              )}
            </div>
            {apiError && (
              <div className="mt-2">
                <p className="text-red-200 text-[12px] font-medium">{scanErrorMessage(apiStatus)}</p>
                {!bin && (
                  <button
                    type="button"
                    onClick={() => { setApiError(false); setScanMode("barcode"); setStep("camera"); }}
                    className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-950 bg-white/95 rounded-full px-3.5 py-2 shadow-sm"
                  >
                    <ScanBarcode className="w-3.5 h-3.5 text-emerald-700" /> Switch to Barcode / Offline Scan instead
                  </button>
                )}
              </div>
            )}
            {aiMessage && !apiError && <p className="text-white/85 text-[13px] mt-1 leading-snug">{aiMessage}</p>}
          </div>

          <div className="flex-1 overflow-y-auto space-y-2.5 pb-3">
            {eligible.length === 0 && !apiError && (
              <div className="rounded-[26px] liquid-glass text-center py-12 px-6">
                <Camera className="w-12 h-12 text-white/60 mx-auto mb-3" />
                <p className="text-white text-[15px] font-semibold mb-1.5">{aiMessage || "No containers detected"}</p>
                {!aiMessage && <p className="text-white/75 text-[13px]">Try a clearer photo with better lighting or toggle the flashlight.</p>}
              </div>
            )}

            {eligible.length > 0 && (
              <>
                {eligible.map((item, i) => {
                  const bagGuide = streamGuideForMaterial(item.material, item.name);
                  return (
                    <div key={i} className="flex items-center gap-3 p-3.5 rounded-[22px] liquid-glass-light text-slate-900">
                      <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
                        <Check className="w-5 h-5 text-emerald-700" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] text-slate-950 font-bold truncate">{item.name}</p>
                        <p className="text-[12px] text-slate-600">{isBonusRate ? "Bonus sorting rate" : "8c each"} &middot; sort into your own bags today</p>
                        <span className={`inline-flex items-center gap-1 mt-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${bagGuide.badgeBg} ${bagGuide.badgeText}`}>
                          Put in {bagGuide.bagName} &middot; {bagGuide.shortLabel} (GSB-{bagGuide.codePrefix})
                        </span>
                      </div>
                      <span className="text-[16px] font-display font-extrabold text-slate-950 tabular-nums">&times;{item.count}</span>
                    </div>
                  );
                })}

                <div className="p-4 rounded-[22px] liquid-glass-emerald">
                  <p className="text-[12px] text-white/95 font-medium leading-relaxed">
                    Keep it in your sorted bags. When suburb volume unlocks a run, bag out — we take them to a refund point.
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="pt-2 space-y-2">
            {total > 0 && !binCode && (
              <button
                type="button"
                onClick={confirmAndScanNext}
                disabled={confirming}
                className="w-full min-h-[48px] rounded-full liquid-glass-bright text-slate-950 font-extrabold text-[14px] disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
                style={{ touchAction: "manipulation" }}
              >
                <Plus className="w-4 h-4 text-emerald-700" />
                {confirming ? "Banking..." : `Bank +${displayCents}c & scan next`}
              </button>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={retake}
                className="flex-1 py-3.5 rounded-full liquid-glass-pill text-white font-bold text-[13px] flex items-center justify-center gap-1.5 min-h-[48px]"
                style={{ touchAction: "manipulation" }}
              >
                <RotateCcw className="w-4 h-4" /> Retake
              </button>
              {total > 0 ? (
                <button
                  type="button"
                  onClick={confirm}
                  disabled={confirming}
                  className="flex-[2] bg-gradient-to-b from-emerald-500 to-emerald-600 text-white font-extrabold py-3.5 rounded-full text-[15px] shadow-lg shadow-emerald-950/35 disabled:opacity-50 flex items-center justify-center gap-2 min-h-[48px]"
                  style={{ touchAction: "manipulation" }}
                >
                  <Check className="w-5 h-5" /> {confirming ? "Saving..." : <>Done &middot; +{displayCents}c</>}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => window.location.href = "/sort"}
                  className="flex-1 py-3.5 rounded-full liquid-glass-pill text-white font-bold text-[13px] flex items-center justify-center gap-1.5 min-h-[48px]"
                  style={{ touchAction: "manipulation" }}
                >
                  <Home className="w-4 h-4" /> Home
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════
  // EDGE-TO-EDGE APPLE CAMERA VIEW
  // ════════════════════════════════════
  return (
    <div className="fixed inset-0 bg-black flex flex-col z-50 overflow-hidden select-none">
      {/* Full-bleed edge-to-edge live camera feed */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
        autoPlay
        style={{ WebkitTransform: "translateZ(0)" }}
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* Subtle top & bottom gradient scrims so floating glass HUD stays crisp in any light */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-32 z-10"
        style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.58) 0%, rgba(0,0,0,0) 100%)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-52 z-10"
        style={{ background: "linear-gradient(0deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.28) 58%, rgba(0,0,0,0) 100%)" }}
      />

      {/* Shutter pulse flash on capture */}
      {shutterFlash && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-white z-30 animate-shutter-flash" />
      )}

      {/* Precision translucent viewfinder brackets */}
      {cameraReady && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-10 pb-20">
          <div className={`relative w-full max-w-[270px] ${scanMode === "barcode" ? "h-40" : "aspect-[3/4] max-h-[340px]"} transition-all duration-300`}>
            <div className="absolute top-0 left-0 w-7 h-7 border-t-2 border-l-2 border-white/80 rounded-tl-2xl" />
            <div className="absolute top-0 right-0 w-7 h-7 border-t-2 border-r-2 border-white/80 rounded-tr-2xl" />
            <div className="absolute bottom-0 left-0 w-7 h-7 border-b-2 border-l-2 border-white/80 rounded-bl-2xl" />
            <div className="absolute bottom-0 right-0 w-7 h-7 border-b-2 border-r-2 border-white/80 rounded-br-2xl" />
            {scanMode === "barcode" && (
              <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 h-[2px] bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_rgba(52,211,153,0.85)]" />
            )}
          </div>
        </div>
      )}

      {/* Floating Apple Liquid Glass Top HUD */}
      <div
        className="relative z-20 flex-shrink-0 px-4 flex items-center justify-between gap-2"
        style={{ paddingTop: "max(14px, env(safe-area-inset-top, 14px))" }}
      >
        <button
          type="button"
          onClick={() => {
            if (sessionBatch.count > 0) finishBatchSession();
            else window.location.href = "/sort";
          }}
          aria-label="Close scanner"
          className="h-11 w-11 rounded-full liquid-glass-pill flex items-center justify-center text-white active:scale-95 transition-transform shrink-0"
          style={{ touchAction: "manipulation" }}
        >
          <X className="w-5 h-5" />
        </button>

        {!bin ? (
          <div role="group" aria-label="Scanner mode" className="inline-flex rounded-full liquid-glass-dock p-1 shrink-0">
            <button
              type="button"
              onClick={() => { setScanMode("photo"); setBarcodeError(""); }}
              className={`min-h-[36px] px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-all ${scanMode === "photo" ? "bg-white text-slate-950 shadow-sm" : "text-white/85"}`}
            >
              Photo AI
            </button>
            <button
              type="button"
              onClick={() => { setScanMode("barcode"); setBarcodeError(""); }}
              className={`min-h-[36px] px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-all flex items-center gap-1 ${scanMode === "barcode" ? "bg-white text-slate-950 shadow-sm" : "text-white/85"}`}
            >
              <ScanBarcode className="w-3.5 h-3.5" /> Barcode
            </button>
          </div>
        ) : (
          <p className="rounded-full liquid-glass-pill px-4 py-2 text-[13px] text-white font-display font-bold truncate">
            {bin.name}
          </p>
        )}

        {torchSupported ? (
          <button
            type="button"
            onClick={toggleTorch}
            aria-label={torchOn ? "Turn flashlight off" : "Turn flashlight on"}
            aria-pressed={torchOn}
            className={`h-11 w-11 rounded-full flex items-center justify-center transition-all active:scale-95 shrink-0 ${
              torchOn
                ? "bg-amber-300 text-slate-950 shadow-[0_0_18px_rgba(252,211,77,0.7)]"
                : "liquid-glass-pill text-white"
            }`}
            style={{ touchAction: "manipulation" }}
          >
            {torchOn ? <Zap className="w-5 h-5" /> : <ZapOff className="w-5 h-5" />}
          </button>
        ) : (
          <span className="h-11 w-11 shrink-0" aria-hidden="true" />
        )}
      </div>

      {/* Rapid-Fire Feedback Toast Pill */}
      {batchToast && (
        <div className="relative z-20 px-4 mt-3 flex justify-center pointer-events-none">
          <div
            className={`max-w-sm rounded-2xl px-4 py-2.5 text-center shadow-xl animate-tab-in ${
              batchToast.refused
                ? "bg-red-500/90 border border-red-200/50 text-white"
                : "liquid-glass-emerald text-white"
            }`}
          >
            <p className="text-[13px] font-display font-extrabold leading-tight">{batchToast.title}</p>
            <p className="text-[11px] text-white/90 mt-0.5">{batchToast.subtitle}</p>
          </div>
        </div>
      )}

      {/* Spacer pushing barcode tray + session bar + bottom controls cleanly to the bottom */}
      <div className="flex-1" />

      {/* Rapid Barcode Manual Input Drawer */}
      {scanMode === "barcode" && (
        <div className="relative z-20 px-4 mb-3 max-w-md w-full mx-auto">
          <div className="liquid-glass-dock rounded-2xl p-3.5 text-white">
            <p className="text-[12px] font-semibold mb-2 text-white/90">
              Aim at barcode — or enter 8–13 digits (rapid batch &amp; offline ready):
            </p>
            <form
              onSubmit={(e) => { e.preventDefault(); void processBarcode(manualBarcode); }}
              className="flex gap-2"
            >
              <input
                type="text"
                inputMode="numeric"
                aria-label="Container barcode number"
                value={manualBarcode}
                onChange={(e) => setManualBarcode(e.target.value.replace(/\D/g, ""))}
                placeholder="e.g. 9300675024235"
                maxLength={14}
                className="flex-1 min-h-[44px] bg-white/95 border border-white/80 rounded-xl px-3.5 py-2.5 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
              <button
                type="submit"
                disabled={barcodeBusy || manualBarcode.length < 8}
                className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-extrabold px-4 py-2.5 rounded-xl text-[14px] min-h-[44px]"
              >
                {barcodeBusy ? "..." : "Add"}
              </button>
            </form>
            {barcodeError && <p className="text-red-200 text-[11px] mt-1.5">{barcodeError}</p>}
          </div>
        </div>
      )}

      {/* Floating Multi-Can Batch Session Tray */}
      {sessionBatch.count > 0 && (
        <div className="relative z-20 px-4 mb-3 max-w-md w-full mx-auto">
          <div className="rounded-full liquid-glass-emerald pl-4 pr-2 py-2 flex items-center justify-between gap-3 shadow-xl">
            <div className="min-w-0">
              <p className="text-[13px] font-display font-extrabold text-white tabular-nums truncate">
                {sessionBatch.count} {sessionBatch.count === 1 ? "can" : "cans"} banked &middot; +${(sessionBatch.cents / 100).toFixed(2)}
              </p>
              {sessionBatch.lastBag && (
                <p className="text-[11px] text-emerald-100 truncate">
                  Last: {sessionBatch.lastBag}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={finishBatchSession}
              className="min-h-[38px] px-4 py-1.5 rounded-full bg-white text-slate-950 font-extrabold text-[13px] shadow-sm active:scale-95 transition-transform shrink-0"
            >
              Finish &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Bottom Floating Camera Controls */}
      <div className="relative z-20 flex-shrink-0 px-4" style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom, 20px))" }}>
        <div className="flex items-center justify-center gap-7 py-3">
          {/* Gallery / file fallback — primary big emerald circle when camera not ready */}
          <label
            aria-label={cameraReady ? "Choose a photo from your gallery" : "Take or choose a photo of your container"}
            className={`rounded-full flex items-center justify-center cursor-pointer transition-all active:scale-95 ${
              !cameraReady ? "w-[74px] h-[74px] bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-[0_0_24px_rgba(16,185,129,0.55)]" : "w-12 h-12 liquid-glass-pill"
            }`}
            style={{ touchAction: "manipulation" }}
          >
            <ImagePlus className={`${!cameraReady ? "w-8 h-8 text-slate-950" : "w-5 h-5 text-white"}`} />
            <input type="file" accept="image/*" capture={cameraReady ? undefined : "environment"} className="hidden" onChange={handleFileCapture} />
          </label>

          {/* Apple-style tactile shutter ring when camera is live */}
          {cameraReady && (
            <button
              type="button"
              onClick={capture}
              aria-label="Capture photo"
              className="w-[74px] h-[74px] rounded-full border-[4px] border-white/90 p-1.5 flex items-center justify-center active:scale-90 transition-transform shadow-2xl"
              style={{ touchAction: "manipulation" }}
            >
              <span className="w-full h-full rounded-full bg-white block" />
            </button>
          )}

          {/* Home shortcut (or Finish if batch active) */}
          <button
            type="button"
            onClick={() => {
              if (sessionBatch.count > 0) finishBatchSession();
              else window.location.href = "/sort";
            }}
            aria-label={sessionBatch.count > 0 ? "Finish scanning session" : "Return to home dashboard"}
            className="w-12 h-12 rounded-full liquid-glass-pill flex items-center justify-center text-white active:scale-95 transition-transform"
            style={{ touchAction: "manipulation" }}
          >
            <Home className="w-5 h-5" />
          </button>
        </div>

        {/* Mode-aware concise camera status */}
        <p className="text-white/80 text-[12px] font-medium text-center pb-1 px-4 glass-text-shadow">
          {scanMode === "barcode"
            ? cameraReady
              ? "Aim at a container barcode — rapid scans bank automatically"
              : "Type the barcode above, or tap the green button for a photo"
            : cameraDenied
            ? "Camera blocked — tap the green button to use your photo gallery"
            : cameraReady
            ? "Tap the shutter to capture, or switch to Barcode for rapid batching"
            : "Tap the green button to take a photo"}
        </p>
      </div>
    </div>
  );
}

// ── Shared ──

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-x-clip flex flex-col items-center justify-center px-5 py-8 overflow-y-auto text-white">
      <GlassBackdrop />
      <div className="relative z-10 w-full max-w-sm">
        <div className="flex justify-center mb-4">
          <Logo size="md" dark />
        </div>
        <div className="rounded-[28px] liquid-glass p-6 text-center">{children}</div>
      </div>
    </div>
  );
}

function IconBubble({ children }: { children: React.ReactNode }) {
  return <div className="w-14 h-14 rounded-2xl bg-emerald-400/25 border border-emerald-200/50 flex items-center justify-center mx-auto mb-4 shadow-inner">{children}</div>;
}

function GreenButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-full bg-gradient-to-b from-emerald-500 to-emerald-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-emerald-950/30 disabled:opacity-50 transition-all min-h-[48px] flex items-center justify-center mt-3"
      style={{ touchAction: "manipulation" }}>
      {children}
    </button>
  );
}

export default function ScanPage() {
  return (
    <Suspense fallback={<Center><p className="text-white/85 font-medium">Loading...</p></Center>}>
      <ScanPageContent />
    </Suspense>
  );
}
