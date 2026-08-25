"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { track } from "@/lib/analytics";
import { BRISBANE_SUBURBS, wedgeSuburbs } from "@/lib/brisbane";

const WEDGE_CHIPS = wedgeSuburbs().slice(0, 8);

export function SuburbFinder() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const slugNeedle = needle.replace(/\s+/g, "-");
    return BRISBANE_SUBURBS.filter(
      (s) => s.name.toLowerCase().includes(needle) || s.slug.includes(slugNeedle),
    ).slice(0, 8);
  }, [q]);

  return (
    <div className="w-full max-w-md mb-8">
      <label htmlFor="suburb-finder" className="block text-[12px] font-semibold text-slate-600 mb-2">
        What suburb are you in?
      </label>
      <input
        id="suburb-finder"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Moorooka, West End, …"
        autoComplete="address-level2"
        className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base text-slate-900 placeholder-slate-300 bg-white/90 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
      />
      {matches.length > 0 && (
        <ul className="mt-2 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
          {matches.map((s) => (
            <li key={s.slug}>
              <button
                type="button"
                onClick={() => {
                  track("suburb_picked", { suburb: s.name });
                  router.push(`/brisbane/${s.slug}`);
                }}
                className="w-full text-left px-4 py-2.5 text-[14px] font-semibold text-slate-900 hover:bg-violet-50"
              >
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {WEDGE_CHIPS.map((s) => (
          <Link
            key={s.slug}
            href={`/brisbane/${s.slug}`}
            className="text-[12px] font-semibold text-violet-800 bg-white/80 border border-violet-200 rounded-full px-3 py-1 hover:border-violet-400"
          >
            {s.name}
          </Link>
        ))}
        <Link
          href="/brisbane"
          className="text-[12px] font-semibold text-slate-600 bg-white/80 border border-slate-200 rounded-full px-3 py-1 hover:border-slate-400"
        >
          All suburbs
        </Link>
      </div>
    </div>
  );
}
