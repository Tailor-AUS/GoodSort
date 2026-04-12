"use client";

/**
 * The Good Sort logo — 3A: Yellow lid, cream body, 4 CDS stream squares.
 * Colours match the 4-bag sorting system:
 *   Blue (#3b82f6)  = Aluminium
 *   Teal (#14b8a6)  = PET plastic
 *   Amber (#f59e0b) = Glass
 *   Green (#16a34a) = Other (HDPE, cartons)
 * Yellow lid = AS4123.7 Australian recycling bin standard.
 */

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  dark?: boolean;
  className?: string;
}

export function Logo({ size = "md", showText = true, dark = false, className = "" }: LogoProps) {
  const sizes = {
    sm: { icon: 32, gap: 8, text: "text-[20px]", lid: { w: 30, h: 5, rx: 3 }, body: { x: 1.5, w: 27, h: 22, rx: 4, pad: 3, sq: 9.5, sqh: 8, gap: 2 } },
    md: { icon: 44, gap: 12, text: "text-[28px]", lid: { w: 42, h: 7, rx: 4 }, body: { x: 2, w: 38, h: 30, rx: 5, pad: 4, sq: 14, sqh: 11, gap: 2 } },
    lg: { icon: 56, gap: 16, text: "text-[36px]", lid: { w: 54, h: 9, rx: 5 }, body: { x: 2.5, w: 49, h: 38, rx: 6, pad: 5, sq: 18, sqh: 13, gap: 3 } },
  };

  const s = sizes[size];
  const bodyY = s.lid.h + 2;
  const sqStartX = s.body.x + s.body.pad;
  const sqStartY = bodyY + s.body.pad;
  const sqCol2X = sqStartX + s.body.sq + s.body.gap;
  const sqRow2Y = sqStartY + s.body.sqh + s.body.gap;

  return (
    <div className={`flex items-center ${className}`} style={{ gap: s.gap }}>
      <svg
        width={s.icon}
        height={s.icon}
        viewBox={`0 0 ${s.icon} ${s.icon}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Yellow lid */}
        <rect x={(s.icon - s.lid.w) / 2} y={1} width={s.lid.w} height={s.lid.h} rx={s.lid.rx} fill="#eab308" />
        {/* Cream body with yellow border */}
        <rect
          x={s.body.x + (s.icon - s.lid.w) / 2}
          y={bodyY}
          width={s.body.w}
          height={s.body.h}
          rx={s.body.rx}
          fill={dark ? "#1e293b" : "#fefce8"}
          stroke={dark ? "#334155" : "#fde047"}
          strokeWidth={1.5}
        />
        {/* Aluminium — blue */}
        <rect x={sqStartX + (s.icon - s.lid.w) / 2} y={sqStartY} width={s.body.sq} height={s.body.sqh} rx={2.5} fill="#3b82f6" />
        {/* PET — teal */}
        <rect x={sqCol2X + (s.icon - s.lid.w) / 2} y={sqStartY} width={s.body.sq} height={s.body.sqh} rx={2.5} fill="#14b8a6" />
        {/* Glass — amber */}
        <rect x={sqStartX + (s.icon - s.lid.w) / 2} y={sqRow2Y} width={s.body.sq} height={s.body.sqh} rx={2.5} fill="#f59e0b" />
        {/* Other — green */}
        <rect x={sqCol2X + (s.icon - s.lid.w) / 2} y={sqRow2Y} width={s.body.sq} height={s.body.sqh} rx={2.5} fill="#16a34a" />
      </svg>
      {showText && (
        <span
          className={`font-display font-extrabold tracking-tight ${s.text} ${dark ? "text-white" : "text-slate-900"}`}
          style={{ letterSpacing: "-0.04em" }}
        >
          the good sort
        </span>
      )}
    </div>
  );
}

/**
 * Icon-only version for app icons, favicons, loading states.
 */
export function LogoIcon({ size = 44, dark = false }: { size?: number; dark?: boolean }) {
  return <Logo size={size <= 36 ? "sm" : size <= 48 ? "md" : "lg"} showText={false} dark={dark} />;
}
