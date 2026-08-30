import type { Metadata } from "next";
import Link from "next/link";
import { BRISBANE_SUBURBS, wedgeSuburbs } from "@/lib/brisbane";
import { Logo } from "@/app/components/shared/logo";
import { DensityBoard } from "@/app/components/marketing/density-board";

export const metadata: Metadata = {
  title: "Brisbane suburbs",
  description:
    "Scan eligible containers in your Brisbane suburb. Earn 5¢ each. About 1,000 scanned containers unlocks a driver trip to the refund point.",
  alternates: { canonical: "/brisbane" },
};

export default function BrisbaneIndexPage() {
  const wedge = wedgeSuburbs();
  const rest = BRISBANE_SUBURBS.filter((s) => !s.wedge);
  return (
    <div className="min-h-dvh bg-white px-6 py-10 max-w-lg mx-auto">
      <div className="mb-8"><Logo size="sm" /></div>
      <h1 className="text-3xl font-display font-extrabold text-slate-900 mb-3">Brisbane suburbs</h1>
      <p className="text-[14px] text-slate-500 mb-8">
        Anyone in a Brisbane City Council suburb can start scanning today. A volume run unlocks when there are enough containers for one driver trip. Inner south is first because the depots are there.
      </p>
      <DensityBoard />
      <h2 className="text-[12px] uppercase tracking-wider text-slate-400 font-semibold mb-3">Inner south first</h2>
      <ul className="grid grid-cols-2 gap-2 mb-8">
        {wedge.map((s) => (
          <li key={s.slug}>
            <Link href={`/brisbane/${s.slug}`} className="block border border-slate-200 rounded-xl px-3 py-3 text-[14px] font-semibold text-slate-900 hover:border-green-500">
              {s.name}
            </Link>
          </li>
        ))}
      </ul>
      <h2 className="text-[12px] uppercase tracking-wider text-slate-400 font-semibold mb-3">Also signing up</h2>
      <ul className="grid grid-cols-2 gap-2 mb-10">
        {rest.map((s) => (
          <li key={s.slug}>
            <Link href={`/brisbane/${s.slug}`} className="block border border-slate-200 rounded-xl px-3 py-3 text-[14px] font-semibold text-slate-900 hover:border-green-500">
              {s.name}
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/" className="text-[13px] text-green-700 font-semibold">Back to home</Link>
    </div>
  );
}
