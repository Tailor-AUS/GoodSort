"use client";

/**
 * The Good Sort logo — Apple Liquid Glass squircle housing four luminous
 * CDS stream orbs:
 *   Blue  (#2563eb / #3b82f6) = Aluminium cans
 *   Teal  (#0d9488 / #14b8a6) = PET plastic bottles
 *   Amber (#d97706 / #f59e0b) = Soft-drink / flavoured bottles
 *   Green (#15803d / #22c55e) = Glass bottles
 */

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  dark?: boolean;
  className?: string;
}

export function Logo({ size = "md", showText = true, dark = false, className = "" }: LogoProps) {
  const sizes = {
    sm: { icon: 34, gap: 9, text: "text-[20px]" },
    md: { icon: 46, gap: 12, text: "text-[28px]" },
    lg: { icon: 58, gap: 14, text: "text-[34px] sm:text-[36px]" },
  };

  const s = sizes[size];

  return (
    <div className={`inline-flex items-center ${className}`} style={{ gap: s.gap }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/tgs-glass-icon.webp"
        alt={showText ? "" : "The Good Sort"}
        aria-hidden={showText ? true : undefined}
        width={s.icon}
        height={s.icon}
        decoding="async"
        className={`shrink-0 select-none object-contain ${
          dark
            ? "drop-shadow-[0_4px_12px_rgba(0,0,0,0.45)]"
            : "drop-shadow-[0_4px_10px_rgba(15,23,42,0.14)]"
        }`}
        style={{ width: s.icon, height: s.icon }}
      />
      {showText && (
        <span
          className={`font-display font-extrabold leading-none tracking-[-0.02em] ${s.text} ${dark ? "text-white" : "text-slate-900"}`}
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
