"use client";

import Link from "next/link";
import { Logo } from "./logo";

/**
 * Branding footer — standalone GoodSort mark.
 * Formerly [logo + brand name](/sort) [powered by tailor](https://tailor.au).
 */
export function PoweredByTailor() {
  return (
    <div className="flex items-center justify-center gap-3">
      <Link href="/sort" className="hover:opacity-80 transition-opacity duration-200">
        <Logo size="sm" />
      </Link>
    </div>
  );
}
