"use client";

import { useEffect, useRef, useState } from "react";
import { Banknote, Camera, CheckCircle2, QrCode, Sparkles, Truck } from "lucide-react";

type StageIndex = 0 | 1 | 2 | 3;

const STAGES: Array<{
  idx: StageIndex;
  pill: string;
  eyebrow: string;
  headline: string;
  detail: string;
  badge: string;
  badgeTone: string;
  spotlightClass: string;
}> = [
  {
    idx: 0,
    pill: "1. Scan",
    eyebrow: "Step 1 · Instant AI camera scan",
    headline: "Aluminium Can 375mL → Blue bag",
    detail: "Point your phone camera at any eligible 150mL–3L container.",
    badge: "+10¢ pending",
    badgeTone: "bg-violet-700 text-white",
    spotlightClass: "left-3 top-3",
  },
  {
    idx: 1,
    pill: "2. 4 Bags",
    eyebrow: "Step 2 · Four clean streams at home",
    headline: "Blue · Teal · Amber · Green bags",
    detail: "Sort into your own bags at home and tag full bags with a GSB QR code.",
    badge: "GSB-ALU tagged",
    badgeTone: "bg-blue-700 text-white",
    spotlightClass: "left-1/2 -translate-x-1/2 top-3",
  },
  {
    idx: 2,
    pill: "3. Kerb Run",
    eyebrow: "Step 3 · 1,000-container suburb run",
    headline: "1,000 / 1,000 cans · Driver dispatched",
    detail: "Put tagged bags by your front gate — a local runner takes them to the depot.",
    badge: "Zero depot queue",
    badgeTone: "bg-amber-400 text-slate-950",
    spotlightClass: "right-3 top-3",
  },
  {
    idx: 3,
    pill: "4. Paid",
    eyebrow: "Step 4 · Verified depot payout + referral bonus",
    headline: "10¢/can cleared to PayID + 1¢/can street bonus",
    detail: "Cash out from $20 via PayID or bank transfer, plus $1 per neighbour you invite.",
    badge: "PayID ready",
    badgeTone: "bg-emerald-700 text-white",
    spotlightClass: "right-3 top-3",
  },
];

/**
 * Interactive + gently auto-cycling 4-step visual showcase for How It Works:
 * Scan on phone -> Sort into 4 home bags -> 1,000-can kerbside van pickup -> PayID + 1c referral bonus.
 * Respects prefers-reduced-motion, full WAI-ARIA tablist/tabpanel semantics, and zero CLS.
 */
export function SortAnimation() {
  const [active, setActive] = useState<StageIndex>(0);
  const [hoveredOrFocused, setHoveredOrFocused] = useState(false);
  const [userLocked, setUserLocked] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([null, null, null, null]);

  const paused = hoveredOrFocused || userLocked;

  useEffect(() => {
    if (paused || typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setActive((prev) => (((prev + 1) % 4) as StageIndex));
    }, 3400);
    return () => window.clearInterval(timer);
  }, [paused]);

  const stage = STAGES[active];

  function selectTab(next: StageIndex, moveFocus = false) {
    setActive(next);
    setUserLocked(true);
    if (moveFocus) {
      tabRefs.current[next]?.focus();
    }
  }

  function handleTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, idx: StageIndex) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      selectTab((((idx + 1) % 4) as StageIndex), true);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      selectTab((((idx + 3) % 4) as StageIndex), true);
    } else if (e.key === "Home") {
      e.preventDefault();
      selectTab(0, true);
    } else if (e.key === "End") {
      e.preventDefault();
      selectTab(3, true);
    }
  }

  return (
    <div
      className="w-full max-w-lg mx-auto rounded-3xl bg-white border border-slate-200/90 shadow-[0_20px_50px_-20px_rgba(15,23,42,0.16)] overflow-hidden"
      onMouseEnter={() => setHoveredOrFocused(true)}
      onMouseLeave={() => setHoveredOrFocused(false)}
      onFocusCapture={() => setHoveredOrFocused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setHoveredOrFocused(false);
        }
      }}
    >
      {/* Apple Keynote studio editorial scene — unobstructed hero frame */}
      <div className="relative aspect-[16/9] w-full bg-stone-100 overflow-hidden">
        <img
          src="/images/how-it-works-flow.webp"
          alt="Smartphone scanning a brushed aluminium drink can beside four structured architectural sorting totes in cobalt blue, mineral teal, warm amber, and eucalyptus green"
          width={1200}
          height={675}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
        />

        {/* Floating live stage pill — pinned to open negative space at top */}
        <div
          className={`absolute ${stage.spotlightClass} transition-all duration-500 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-extrabold tracking-wide shadow-lg ${stage.badgeTone}`}
        >
          <Sparkles className="w-3 h-3" />
          {stage.badge}
        </div>
      </div>

      {/* Clean stream strip beneath the photograph so 100% of the totes remain visible */}
      <div className="px-4 sm:px-5 py-2.5 bg-slate-50/90 border-b border-slate-200/70 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
          <span className="w-2 h-2 rounded-full bg-blue-600" />
          <span className="w-2 h-2 rounded-full bg-teal-500" />
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          <span className="w-2 h-2 rounded-full bg-emerald-700" />
          <span className="ml-0.5">4 home streams · no wheelie bins</span>
        </div>
        <span className="text-[11px] font-extrabold bg-emerald-100 text-emerald-900 px-2.5 py-0.5 rounded-full">
          10¢ / can
        </span>
      </div>

      {/* Interactive 4-stage selector + zero-CLS stacked tabpanels */}
      <div className="p-4 sm:p-5 bg-white">
        <div className="grid grid-cols-4 gap-1.5 p-1 rounded-2xl bg-slate-100 mb-3.5" role="tablist" aria-label="How The Good Sort works">
          {STAGES.map((s) => {
            const isSelected = s.idx === active;
            return (
              <button
                key={s.idx}
                ref={(el) => {
                  tabRefs.current[s.idx] = el;
                }}
                id={`gs-how-tab-${s.idx}`}
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-controls={`gs-how-panel-${s.idx}`}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => selectTab(s.idx)}
                onKeyDown={(e) => handleTabKeyDown(e, s.idx)}
                className={`py-2 px-1.5 rounded-xl text-[11px] font-extrabold transition-all ${
                  isSelected
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-700 hover:text-slate-950"
                }`}
              >
                {s.pill}
              </button>
            );
          })}
        </div>

        {/* All 4 panels share one CSS grid cell so container height always equals the tallest stage (zero CLS) */}
        <div className="grid">
          {STAGES.map((s) => {
            const isSelected = s.idx === active;
            return (
              <div
                key={s.idx}
                id={`gs-how-panel-${s.idx}`}
                role="tabpanel"
                aria-labelledby={`gs-how-tab-${s.idx}`}
                aria-hidden={!isSelected}
                className={`col-start-1 row-start-1 rounded-2xl bg-slate-50 border border-slate-200/80 p-3.5 flex items-start justify-between gap-3 transition-opacity duration-200 ${
                  isSelected ? "opacity-100 visible" : "opacity-0 invisible pointer-events-none"
                }`}
              >
                <div className="min-w-0">
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-600 mb-0.5">
                    {s.eyebrow}
                  </p>
                  <p className="text-[14px] font-display font-extrabold text-slate-900 leading-snug">
                    {s.headline}
                  </p>
                  <p className="text-[12px] text-slate-600 leading-relaxed mt-1">
                    {s.detail}
                  </p>
                </div>
                <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0 shadow-xs">
                  {s.idx === 0 && <Camera className="w-4 h-4 text-violet-700" />}
                  {s.idx === 1 && <QrCode className="w-4 h-4 text-blue-700" />}
                  {s.idx === 2 && <Truck className="w-4 h-4 text-amber-700" />}
                  {s.idx === 3 && <Banknote className="w-4 h-4 text-emerald-700" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Sunlit Brisbane Queenslander kerbside hero showcase card for desktop viewports.
 * Uses <picture media="(min-width: 1024px)"> so mobile viewports download 0 bytes.
 */
export function HeroKerbsideCard({ suburbName }: { suburbName?: string }) {
  const placeLabel = suburbName || "Brisbane";

  return (
    <div className="relative w-full max-w-xl mx-auto">
      <div className="relative rounded-[2rem] overflow-hidden border border-slate-200/80 shadow-[0_28px_70px_-20px_rgba(15,23,42,0.22)] bg-white">
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-stone-100">
          <picture>
            <source media="(min-width: 1024px)" srcSet="/images/brisbane-kerbside-hero.webp" type="image/webp" />
            <img
              src="data:image/gif;base64,R0lGODlhAQABAAAAACw="
              alt={`Four structured matte architectural sorting totes lined up neatly on a sunlit ${placeLabel} front path with a minimalist white electric van on the street behind`}
              width={1200}
              height={675}
              decoding="async"
              className="w-full h-full object-cover"
            />
          </picture>

          {/* Subtle top-left Apple glassmorphic pill in open foliage/fence corner */}
          <div className="absolute top-4 left-4 inline-flex items-center gap-2 rounded-2xl bg-white/92 backdrop-blur-md px-3.5 py-2 shadow-lg border border-white">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <div>
              <p className="text-[11px] font-extrabold text-slate-900 leading-none">
                10¢ credit per container
              </p>
              <p className="text-[10px] font-semibold text-slate-600 mt-0.5 leading-none">
                Scan indoors · bag out at 1,000 cans
              </p>
            </div>
          </div>
        </div>

        {/* Clean editorial caption bar below the photo — 0% obstruction on the 4 totes */}
        <div className="flex items-center justify-between gap-3 bg-slate-950 px-5 py-3.5 text-white">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">
              {placeLabel} · Kerbside Bag-Out
            </p>
            <p className="text-[13px] font-display font-extrabold leading-snug mt-0.5">
              Your own 4 streams at the gate — we drive the depot run
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0" aria-hidden="true">
            <span className="px-2 py-0.5 rounded-md bg-blue-500 text-white text-[10px] font-extrabold">ALU</span>
            <span className="px-2 py-0.5 rounded-md bg-teal-400 text-slate-950 text-[10px] font-extrabold">CLR</span>
            <span className="px-2 py-0.5 rounded-md bg-amber-400 text-slate-950 text-[10px] font-extrabold">COL</span>
            <span className="px-2 py-0.5 rounded-md bg-emerald-500 text-slate-950 text-[10px] font-extrabold">GLS</span>
          </div>
        </div>
      </div>
    </div>
  );
}
