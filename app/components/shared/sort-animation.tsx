"use client";

import { useEffect, useState } from "react";
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
    badgeTone: "bg-violet-600 text-white",
    spotlightClass: "left-3 top-3",
  },
  {
    idx: 1,
    pill: "2. 4 Bags",
    eyebrow: "Step 2 · Four clean streams at home",
    headline: "Blue · Teal · Amber · Green bags",
    detail: "Sort into your own bags at home and tag full bags with a GSB QR code.",
    badge: "GSB-ALU tagged",
    badgeTone: "bg-blue-600 text-white",
    spotlightClass: "left-1/2 -translate-x-1/2 top-3",
  },
  {
    idx: 2,
    pill: "3. Kerb Run",
    eyebrow: "Step 3 · 1,000-container suburb run",
    headline: "1,000 / 1,000 cans · Driver dispatched",
    detail: "Put tagged bags by your front gate — a local runner takes them to the depot.",
    badge: "Zero depot queue",
    badgeTone: "bg-amber-500 text-slate-950",
    spotlightClass: "right-3 top-3",
  },
  {
    idx: 3,
    pill: "4. Paid",
    eyebrow: "Step 4 · Verified depot payout + Mafia cut",
    headline: "10¢/can cleared to PayID + 1¢/can street bonus",
    detail: "Cash out from $20 via PayID or bank transfer, plus $1 per neighbour you recruit.",
    badge: "PayID ready",
    badgeTone: "bg-emerald-600 text-white",
    spotlightClass: "right-3 top-3",
  },
];

/**
 * Interactive + gently auto-cycling 4-step visual showcase for How It Works:
 * Scan on phone -> Sort into 4 home bags -> 1,000-can kerbside van pickup -> PayID + 1c Mafia.
 * Respects prefers-reduced-motion.
 */
export function SortAnimation() {
  const [active, setActive] = useState<StageIndex>(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setActive((prev) => (((prev + 1) % 4) as StageIndex));
    }, 3400);
    return () => window.clearInterval(timer);
  }, [paused]);

  const stage = STAGES[active];

  return (
    <div
      className="w-full max-w-lg mx-auto rounded-3xl bg-white border border-slate-200/90 shadow-[0_20px_50px_-20px_rgba(15,23,42,0.16)] overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Studio editorial scene: phone scan -> 4 colour-coded home bags -> electric pickup van */}
      <div className="relative aspect-[16/9] w-full bg-stone-100 overflow-hidden">
        <img
          src="/images/how-it-works-flow.webp"
          alt="Phone scanning an aluminium drink can beside four colour-coded sorting bags and a compact kerbside collection van in Brisbane"
          width={1200}
          height={675}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
        />

        {/* Subtle bottom vignette for crisp badge contrast */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-slate-950/65 via-slate-950/20 to-transparent"
        />

        {/* Floating live stage pill */}
        <div
          className={`absolute ${stage.spotlightClass} transition-all duration-500 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-extrabold tracking-wide shadow-lg ${stage.badgeTone}`}
        >
          <Sparkles className="w-3 h-3" />
          {stage.badge}
        </div>

        {/* Bottom overlay caption inside scene */}
        <div className="absolute inset-x-3 bottom-2.5 flex items-center justify-between gap-2 text-white">
          <div className="flex items-center gap-1.5 text-[11px] font-bold bg-slate-950/65 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/15">
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            <span className="w-2 h-2 rounded-full bg-teal-400" />
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="ml-0.5">4 home streams · no wheelie bins</span>
          </div>
          <span className="text-[11px] font-extrabold bg-emerald-500/90 text-slate-950 px-2.5 py-1 rounded-full">
            10¢ / can
          </span>
        </div>
      </div>

      {/* Interactive 4-stage selector + live product state */}
      <div className="p-4 sm:p-5 bg-white">
        <div className="grid grid-cols-4 gap-1.5 p-1 rounded-2xl bg-slate-100 mb-3.5" role="tablist" aria-label="How The Good Sort works">
          {STAGES.map((s) => {
            const isSelected = s.idx === active;
            return (
              <button
                key={s.idx}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => {
                  setActive(s.idx);
                  setPaused(true);
                }}
                className={`py-2 px-1.5 rounded-xl text-[11px] font-extrabold transition-all ${
                  isSelected
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {s.pill}
              </button>
            );
          })}
        </div>

        <div className="rounded-2xl bg-slate-50 border border-slate-200/80 p-3.5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-400 mb-0.5">
              {stage.eyebrow}
            </p>
            <p className="text-[14px] font-display font-extrabold text-slate-900 leading-snug">
              {stage.headline}
            </p>
            <p className="text-[12px] text-slate-500 leading-relaxed mt-1">
              {stage.detail}
            </p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-emerald-600 shrink-0 shadow-xs">
            {active === 0 && <Camera className="w-4 h-4 text-violet-600" />}
            {active === 1 && <QrCode className="w-4 h-4 text-blue-600" />}
            {active === 2 && <Truck className="w-4 h-4 text-amber-600" />}
            {active === 3 && <Banknote className="w-4 h-4 text-emerald-600" />}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Sunlit Brisbane Queenslander kerbside hero showcase card for desktop viewports.
 */
export function HeroKerbsideCard({ suburbName }: { suburbName?: string }) {
  const placeLabel = suburbName || "Brisbane";

  return (
    <div className="relative w-full max-w-xl mx-auto">
      <div className="relative rounded-[2rem] overflow-hidden border border-white/80 shadow-[0_28px_70px_-20px_rgba(15,23,42,0.28)] bg-slate-900">
        <div className="aspect-[16/10] w-full overflow-hidden">
          <img
            src="/images/brisbane-kerbside-hero.webp"
            alt={`Four colour-coded Good Sort bags neatly tied inside a ${placeLabel} Queenslander front gate with a collection van on the street`}
            width={1200}
            height={675}
            fetchPriority="high"
            decoding="async"
            className="w-full h-full object-cover"
          />
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-slate-950/80 via-slate-950/35 to-transparent"
        />

        {/* Top-left live scan credit chip */}
        <div className="absolute top-4 left-4 inline-flex items-center gap-2 rounded-2xl bg-white/92 backdrop-blur-md px-3.5 py-2 shadow-lg border border-white">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <div>
            <p className="text-[11px] font-extrabold text-slate-900 leading-none">
              10¢ credit per container
            </p>
            <p className="text-[10px] font-semibold text-slate-500 mt-0.5 leading-none">
              Scan indoors · bag out at 1,000 cans
            </p>
          </div>
        </div>

        {/* Bottom stream legend bar */}
        <div className="absolute inset-x-4 bottom-4 flex items-center justify-between gap-3 rounded-2xl bg-slate-950/75 backdrop-blur-md px-4 py-3 text-white border border-white/15">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">
              {placeLabel} · Kerbside Bag-Out
            </p>
            <p className="text-[13px] font-display font-extrabold leading-snug mt-0.5">
              Your own 4 bags at the gate — we drive the depot run
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0" aria-hidden="true">
            <span className="px-2 py-0.5 rounded-md bg-blue-500/90 text-[10px] font-extrabold">ALU</span>
            <span className="px-2 py-0.5 rounded-md bg-teal-500/90 text-[10px] font-extrabold">PET</span>
            <span className="px-2 py-0.5 rounded-md bg-amber-500/90 text-slate-950 text-[10px] font-extrabold">GLS</span>
            <span className="px-2 py-0.5 rounded-md bg-emerald-500/90 text-slate-950 text-[10px] font-extrabold">OTH</span>
          </div>
        </div>
      </div>
    </div>
  );
}
