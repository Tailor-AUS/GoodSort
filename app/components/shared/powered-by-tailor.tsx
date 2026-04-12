"use client";

import Link from "next/link";
import { Logo } from "./logo";

/**
 * Branding footer — matches Spark's pattern:
 * [logo + brand name](/) [powered by tailor](https://tailor.au)
 */
export function PoweredByTailor() {
  return (
    <div className="flex items-center justify-center gap-3">
      <Link href="/" className="hover:opacity-80 transition-opacity duration-200">
        <Logo size="sm" />
      </Link>
      <a href="https://tailor.au" target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[10px] tracking-wide text-slate-400 hover:text-slate-500 transition-colors duration-200">
        <span>powered by</span>
        <span className="font-bold text-slate-500">tailor</span>
      </a>
    </div>
  );
}
