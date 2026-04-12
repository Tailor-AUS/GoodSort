"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Share, PlusSquare, MoreVertical, Download } from "lucide-react";
import { Logo } from "./logo";

type Platform = "ios" | "android" | "desktop" | null;

function detectPlatform(): Platform {
  if (typeof window === "undefined") return null;
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "desktop";
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

const DISMISS_KEY = "goodsort_install_dismissed";
const DISMISS_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

export function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [platform, setPlatform] = useState<Platform>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    // Don't show if already installed as PWA
    if (isStandalone()) return;

    // Don't show if dismissed recently
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed && Date.now() - parseInt(dismissed) < DISMISS_DURATION) return;

    const plat = detectPlatform();
    setPlatform(plat);

    // Delay showing prompt so the user sees the app first
    const timer = setTimeout(() => setShow(true), 3000);

    // Listen for the native install prompt (Chrome/Android)
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  const dismiss = useCallback(() => {
    setShow(false);
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
  }, []);

  const handleInstall = useCallback(async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === "accepted") {
        setShow(false);
      }
      setDeferredPrompt(null);
    } else {
      setShowSteps(true);
    }
  }, [deferredPrompt]);

  if (!show || !platform) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] pointer-events-none" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div className="pointer-events-auto mx-4 mb-4 glass-strong rounded-2xl shadow-[0_-4px_40px_rgba(0,0,0,0.1)] border border-white/40 overflow-hidden animate-slide-up">

        {/* Main prompt */}
        {!showSteps && (
          <div className="p-5">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">
                <Logo size="sm" showText={false} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-display font-bold text-slate-900">Add to Home Screen</p>
                <p className="text-[13px] text-slate-500 mt-0.5">Get the full app experience — instant access, no browser bar</p>
              </div>
              <button onClick={dismiss} className="flex-shrink-0 p-1 -mr-1 -mt-1 text-slate-300 hover:text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={handleInstall}
                className="flex-1 bg-gradient-to-b from-green-500 to-green-600 text-white font-bold py-3 rounded-xl text-[13px] shadow-lg shadow-green-600/20 min-h-[44px] active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                {deferredPrompt ? "Install App" : "Show Me How"}
              </button>
              <button
                onClick={dismiss}
                className="px-4 py-3 glass border border-white/40 text-slate-400 font-bold rounded-xl text-[13px] min-h-[44px]"
              >
                Later
              </button>
            </div>
          </div>
        )}

        {/* Step-by-step instructions */}
        {showSteps && (
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[15px] font-display font-bold text-slate-900">
                {platform === "ios" ? "Add to Home Screen" : "Install the app"}
              </p>
              <button onClick={dismiss} className="p-1 text-slate-300 hover:text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>

            {platform === "ios" && <IOSSteps />}
            {platform === "android" && <AndroidSteps />}
            {platform === "desktop" && <DesktopSteps />}

            <button
              onClick={dismiss}
              className="w-full mt-4 py-3 bg-gradient-to-b from-green-500 to-green-600 text-white font-bold rounded-xl text-[13px] min-h-[44px] active:scale-[0.98] transition-transform"
            >
              Got it
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function IOSSteps() {
  return (
    <div className="space-y-3">
      <Step number={1} icon={<Share className="w-5 h-5 text-blue-500" />}>
        Tap the <strong>Share</strong> button at the bottom of Safari
        <div className="mt-1.5 flex justify-center">
          <div className="bg-slate-100 rounded-lg px-3 py-1.5 inline-flex items-center gap-2">
            <Share className="w-4 h-4 text-blue-500" />
            <span className="text-[12px] text-slate-500 font-medium">Share button</span>
          </div>
        </div>
      </Step>
      <Step number={2} icon={<PlusSquare className="w-5 h-5 text-slate-700" />}>
        Scroll down and tap <strong>&quot;Add to Home Screen&quot;</strong>
        <div className="mt-1.5 flex justify-center">
          <div className="bg-slate-100 rounded-lg px-3 py-1.5 inline-flex items-center gap-2">
            <PlusSquare className="w-4 h-4 text-slate-600" />
            <span className="text-[12px] text-slate-500 font-medium">Add to Home Screen</span>
          </div>
        </div>
      </Step>
      <Step number={3}>
        Tap <strong>&quot;Add&quot;</strong> in the top right corner — done!
      </Step>
    </div>
  );
}

function AndroidSteps() {
  return (
    <div className="space-y-3">
      <Step number={1} icon={<MoreVertical className="w-5 h-5 text-slate-700" />}>
        Tap the <strong>three dots</strong> menu in Chrome (top right)
        <div className="mt-1.5 flex justify-center">
          <div className="bg-slate-100 rounded-lg px-3 py-1.5 inline-flex items-center gap-2">
            <MoreVertical className="w-4 h-4 text-slate-600" />
            <span className="text-[12px] text-slate-500 font-medium">Chrome menu</span>
          </div>
        </div>
      </Step>
      <Step number={2} icon={<Download className="w-5 h-5 text-slate-700" />}>
        Tap <strong>&quot;Install app&quot;</strong> or <strong>&quot;Add to Home screen&quot;</strong>
      </Step>
      <Step number={3}>
        Tap <strong>&quot;Install&quot;</strong> to confirm — done!
      </Step>
    </div>
  );
}

function DesktopSteps() {
  return (
    <div className="space-y-3">
      <Step number={1}>
        In Chrome, click the <strong>install icon</strong> in the address bar (right side)
        <div className="mt-1.5 flex justify-center">
          <div className="bg-slate-100 rounded-lg px-3 py-1.5 inline-flex items-center gap-2">
            <Download className="w-4 h-4 text-slate-600" />
            <span className="text-[12px] text-slate-500 font-medium">Install icon in address bar</span>
          </div>
        </div>
      </Step>
      <Step number={2}>
        Or press <strong>Ctrl+D</strong> (Windows) / <strong>Cmd+D</strong> (Mac) to bookmark this page
      </Step>
    </div>
  );
}

function Step({ number, icon, children }: { number: number; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-green-100 text-green-700 font-bold text-[13px] flex items-center justify-center">
        {number}
      </div>
      <div className="flex-1 text-[13px] text-slate-600 leading-relaxed pt-0.5">
        {children}
      </div>
    </div>
  );
}

// Chrome's BeforeInstallPromptEvent type
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
