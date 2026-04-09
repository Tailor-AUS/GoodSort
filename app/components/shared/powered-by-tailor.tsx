"use client";

export function PoweredByTailor() {
  return (
    <div className="flex justify-center">
      <a href="https://tailor.au" target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-[11px] tracking-wide text-slate-400 hover:text-slate-600 border border-slate-200/50 rounded-full pl-2.5 pr-3 py-1 transition-all duration-200">
        <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><path d="M5 0L9.33 3v6L5 12 .67 9V3L5 0z" /></svg>
        <span>Powered by <span className="font-bold text-slate-500">Tailor</span></span>
      </a>
    </div>
  );
}
