"use client";

/**
 * Pixel-art style looping scene showing the GoodSort flow:
 * House → yellow bin → runner car collects → depot → money back.
 * Pure SVG + CSS keyframes. Respects prefers-reduced-motion.
 */
export function SortAnimation() {
  return (
    <div className="w-full max-w-md mx-auto select-none pointer-events-none">
      <svg viewBox="0 0 400 140" className="w-full h-auto" aria-hidden="true">
        <style>{`
          @keyframes sa-car {
            0%   { transform: translateX(420px); }
            20%  { transform: translateX(170px); }
            35%  { transform: translateX(170px); }
            70%  { transform: translateX(370px); }
            100% { transform: translateX(420px); }
          }
          @keyframes sa-can-to-bin {
            0%, 60% { opacity: 0; transform: translate(0, 0); }
            65% { opacity: 1; transform: translate(0, 0); }
            85% { opacity: 1; transform: translate(35px, -8px); }
            90% { opacity: 1; transform: translate(55px, 8px); }
            100% { opacity: 0; transform: translate(55px, 8px); }
          }
          @keyframes sa-can-to-car {
            0%, 21% { opacity: 0; transform: translate(0, 0); }
            23% { opacity: 1; transform: translate(0, 0); }
            30% { opacity: 1; transform: translate(30px, -10px); }
            33% { opacity: 1; transform: translate(60px, 4px); }
            35%, 100% { opacity: 0; transform: translate(60px, 4px); }
          }
          @keyframes sa-money {
            0%, 72% { opacity: 0; transform: translate(0, 0); }
            74% { opacity: 1; transform: translate(0, 0); }
            92% { opacity: 1; transform: translate(-295px, -10px); }
            95% { opacity: 1; transform: translate(-310px, 5px); }
            100% { opacity: 0; transform: translate(-310px, 5px); }
          }
          @keyframes sa-wave {
            0%, 45%, 100% { transform: rotate(0deg); }
            50%, 60% { transform: rotate(-35deg); }
          }
          @keyframes sa-smoke {
            0%, 100% { opacity: 0; transform: translate(0,0) scale(1); }
            20% { opacity: 0.5; transform: translate(-2px,-3px) scale(0.8); }
            40% { opacity: 0; transform: translate(-5px,-8px) scale(0.3); }
          }

          .sa-car-group { animation: sa-car 10s linear infinite; transform-origin: center; }
          .sa-can-bin { animation: sa-can-to-bin 10s linear infinite; transform-origin: center; }
          .sa-can-car { animation: sa-can-to-car 10s linear infinite; transform-origin: center; }
          .sa-money { animation: sa-money 10s linear infinite; transform-origin: center; }
          .sa-arm { animation: sa-wave 10s linear infinite; transform-origin: 62px 62px; }
          .sa-smoke { animation: sa-smoke 10s linear infinite; }

          @media (prefers-reduced-motion: reduce) {
            .sa-car-group, .sa-can-bin, .sa-can-car, .sa-money, .sa-arm, .sa-smoke {
              animation: none;
            }
            .sa-car-group { transform: translateX(170px); }
            .sa-can-bin, .sa-can-car, .sa-money { opacity: 0; }
          }
        `}</style>

        {/* Sky gradient background */}
        <defs>
          <linearGradient id="sa-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#dcfce7" />
            <stop offset="100%" stopColor="#f0fdf4" />
          </linearGradient>
        </defs>
        <rect width="400" height="120" fill="url(#sa-sky)" />

        {/* Ground */}
        <rect x="0" y="110" width="400" height="30" fill="#86efac" />
        <rect x="0" y="110" width="400" height="2" fill="#22c55e" />

        {/* Sun */}
        <circle cx="340" cy="28" r="10" fill="#fde047" />
        <circle cx="340" cy="28" r="6" fill="#facc15" />

        {/* Cloud */}
        <g fill="#fff">
          <rect x="60" y="20" width="24" height="6" />
          <rect x="54" y="24" width="36" height="4" />
        </g>

        {/* ─── House (left) ─── */}
        <g>
          {/* Roof */}
          <polygon points="12,60 42,40 72,60" fill="#dc2626" />
          <polygon points="14,60 42,42 70,60" fill="#ef4444" />
          {/* Body */}
          <rect x="18" y="60" width="48" height="50" fill="#fde68a" />
          <rect x="18" y="60" width="48" height="50" fill="none" stroke="#b45309" strokeWidth="1.5" />
          {/* Door */}
          <rect x="36" y="82" width="12" height="28" fill="#7c2d12" />
          <rect x="45" y="96" width="2" height="2" fill="#facc15" />
          {/* Window */}
          <rect x="24" y="68" width="8" height="8" fill="#7dd3fc" />
          <rect x="24" y="68" width="8" height="8" fill="none" stroke="#0284c7" strokeWidth="1" />
          <rect x="54" y="68" width="8" height="8" fill="#7dd3fc" />
          <rect x="54" y="68" width="8" height="8" fill="none" stroke="#0284c7" strokeWidth="1" />
        </g>

        {/* ─── Person (scanner) ─── */}
        <g>
          {/* Head */}
          <circle cx="85" cy="78" r="4" fill="#fcd34d" />
          {/* Body */}
          <rect x="82" y="82" width="6" height="12" fill="#3b82f6" />
          {/* Legs */}
          <rect x="82" y="94" width="2.5" height="10" fill="#1e40af" />
          <rect x="85.5" y="94" width="2.5" height="10" fill="#1e40af" />
          {/* Static arm (down) */}
          <rect x="80" y="84" width="2" height="8" fill="#fcd34d" />
          {/* Waving arm holding phone */}
          <g className="sa-arm">
            <rect x="87" y="84" width="2" height="8" fill="#fcd34d" />
            {/* Phone */}
            <rect x="86.5" y="79" width="3" height="5" fill="#0f172a" />
            <rect x="87" y="79.5" width="2" height="4" fill="#22c55e" />
          </g>
        </g>

        {/* ─── Can being scanned → going to bin ─── */}
        <g className="sa-can-bin">
          <rect x="91" y="78" width="4" height="8" fill="#64748b" />
          <rect x="91" y="78" width="4" height="2" fill="#475569" />
          <rect x="91" y="84" width="4" height="1" fill="#e2e8f0" />
        </g>

        {/* ─── Yellow bin ─── */}
        <g>
          <rect x="142" y="80" width="22" height="30" fill="#facc15" />
          <rect x="142" y="80" width="22" height="30" fill="none" stroke="#a16207" strokeWidth="1.5" />
          {/* Lid */}
          <rect x="140" y="76" width="26" height="5" fill="#eab308" />
          <rect x="140" y="76" width="26" height="5" fill="none" stroke="#a16207" strokeWidth="1" />
          {/* Wheels */}
          <circle cx="147" cy="112" r="2.5" fill="#1e293b" />
          <circle cx="159" cy="112" r="2.5" fill="#1e293b" />
          {/* GS label */}
          <rect x="148" y="90" width="10" height="6" fill="#22c55e" />
          <text x="153" y="95" fontSize="5" fontWeight="800" fill="white" textAnchor="middle" fontFamily="system-ui">GS</text>
        </g>

        {/* ─── Depot (right) ─── */}
        <g>
          {/* Building */}
          <rect x="318" y="70" width="52" height="40" fill="#94a3b8" />
          <rect x="318" y="70" width="52" height="40" fill="none" stroke="#475569" strokeWidth="1.5" />
          {/* Roof */}
          <rect x="316" y="66" width="56" height="6" fill="#64748b" />
          {/* Sign */}
          <rect x="326" y="76" width="36" height="8" fill="#22c55e" />
          <text x="344" y="82" fontSize="5" fontWeight="800" fill="white" textAnchor="middle" fontFamily="system-ui">DEPOT</text>
          {/* Garage door */}
          <rect x="334" y="90" width="20" height="20" fill="#334155" />
          <rect x="334" y="90" width="20" height="2" fill="#1e293b" />
          <rect x="334" y="96" width="20" height="1" fill="#1e293b" />
          <rect x="334" y="101" width="20" height="1" fill="#1e293b" />
          {/* Bin/aggregation icon */}
          <circle cx="310" cy="104" r="4" fill="#22c55e" />
          <text x="310" y="107" fontSize="6" fontWeight="800" fill="white" textAnchor="middle" fontFamily="system-ui">♻</text>
        </g>

        {/* ─── Runner car ─── */}
        <g className="sa-car-group">
          {/* Exhaust smoke */}
          <g className="sa-smoke" style={{ transformOrigin: "-6px 104px" }}>
            <circle cx="-6" cy="104" r="3" fill="#cbd5e1" />
          </g>
          {/* Body */}
          <rect x="0" y="92" width="30" height="14" fill="#16a34a" />
          <rect x="0" y="92" width="30" height="14" fill="none" stroke="#14532d" strokeWidth="1.5" />
          {/* Cabin */}
          <rect x="6" y="85" width="18" height="8" fill="#22c55e" />
          <rect x="6" y="85" width="18" height="8" fill="none" stroke="#14532d" strokeWidth="1.5" />
          {/* Window */}
          <rect x="8" y="87" width="6" height="5" fill="#7dd3fc" />
          <rect x="16" y="87" width="6" height="5" fill="#7dd3fc" />
          {/* GS label */}
          <rect x="10" y="96" width="10" height="6" fill="white" />
          <text x="15" y="101" fontSize="5" fontWeight="800" fill="#16a34a" textAnchor="middle" fontFamily="system-ui">GS</text>
          {/* Wheels */}
          <circle cx="6" cy="108" r="3.5" fill="#1e293b" />
          <circle cx="24" cy="108" r="3.5" fill="#1e293b" />
          <circle cx="6" cy="108" r="1.5" fill="#64748b" />
          <circle cx="24" cy="108" r="1.5" fill="#64748b" />

          {/* Can in bin being picked up → into car */}
          <g className="sa-can-car" style={{ transform: "translateX(-30px)" }}>
            <rect x="0" y="82" width="4" height="8" fill="#64748b" />
            <rect x="0" y="82" width="4" height="2" fill="#475569" />
          </g>
        </g>

        {/* ─── Money icon flying back from depot to person ─── */}
        <g className="sa-money">
          <circle cx="318" cy="90" r="6" fill="#fde047" />
          <circle cx="318" cy="90" r="6" fill="none" stroke="#a16207" strokeWidth="1" />
          <text x="318" y="93" fontSize="8" fontWeight="800" fill="#a16207" textAnchor="middle" fontFamily="system-ui">$</text>
        </g>

        {/* Clouds background */}
        <g fill="#ffffff" opacity="0.7">
          <rect x="200" y="18" width="24" height="6" />
          <rect x="194" y="22" width="36" height="4" />
        </g>
      </svg>
    </div>
  );
}
