/**
 * Shared full-bleed sunlit Brisbane veranda backdrop for Apple iOS 26 Liquid Glass screens.
 * Bright daylight calibration keeps timber, palms, sky and pool glowing through refractive
 * glass cards while maintaining crisp WCAG legibility for white typography.
 */
export function GlassBackdrop({ printHidden = false }: { printHidden?: boolean }) {
  return (
    <div
      className={`${printHidden ? "print:hidden " : ""}fixed inset-0 z-0 pointer-events-none select-none overflow-hidden`}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/brisbane-veranda-glass.webp"
        alt=""
        className="h-full w-full object-cover object-center scale-[1.03] brightness-[1.14] saturate-[1.08]"
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(12,32,42,0.16) 0%, rgba(16,36,40,0.12) 45%, rgba(8,24,26,0.34) 100%)",
        }}
      />
    </div>
  );
}
