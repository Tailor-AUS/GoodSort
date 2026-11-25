import type { Metadata } from "next";
import Link from "next/link";
import { BRISBANE_SUBURBS, wedgeSuburbs } from "@/lib/brisbane";
import { Logo } from "@/app/components/shared/logo";
import { DensityBoard } from "@/app/components/marketing/density-board";
import { GlassBackdrop } from "@/app/components/shared/glass-backdrop";

export const metadata: Metadata = {
  title: "Brisbane suburbs",
  description:
    "Scan eligible containers in your Brisbane suburb. Earn 10¢ each. About 1,000 scanned containers unlocks a driver trip to the refund point.",
  alternates: { canonical: "/brisbane" },
};

export default function BrisbaneIndexPage() {
  const wedge = wedgeSuburbs();
  const rest = BRISBANE_SUBURBS.filter((s) => !s.wedge);
  return (
    <div className="relative min-h-dvh overflow-x-clip text-white">
      <GlassBackdrop />
      <div className="relative z-10 px-5 py-8 pb-14 max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Logo size="sm" dark />
          <Link
            href="/"
            className="inline-flex items-center min-h-[40px] rounded-full liquid-glass-pill px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-white/25"
          >
            Back to home
          </Link>
        </div>

        <div className="rounded-[28px] liquid-glass p-6 mb-6">
          <h1 className="text-3xl font-display font-extrabold text-white glass-text-shadow mb-3">Brisbane suburbs</h1>
          <p className="text-[14px] text-white/85 leading-relaxed">
            Anyone in a Brisbane City Council suburb can start scanning today. A volume run unlocks when there are enough containers for one driver trip. Inner south is first because the depots are there.{" "}
            <Link href="/guides/containers-for-change-brisbane" className="text-emerald-200 hover:text-white underline font-semibold">
              How this fits Containers for Change.
            </Link>
          </p>
        </div>

        <div className="rounded-[24px] liquid-glass-light p-5 mb-7 text-slate-900">
          <DensityBoard />
        </div>

        <h2 className="text-[12px] uppercase tracking-wider text-white/90 glass-text-shadow font-bold mb-3">Inner south first</h2>
        <ul className="grid grid-cols-2 gap-2.5 mb-8">
          {wedge.map((s) => (
            <li key={s.slug}>
              <Link
                href={`/brisbane/${s.slug}`}
                className="block rounded-2xl liquid-glass px-3.5 py-3 text-[14px] font-semibold text-white hover:bg-white/25 transition-colors"
              >
                {s.name}
              </Link>
            </li>
          ))}
        </ul>

        <h2 className="text-[12px] uppercase tracking-wider text-white/90 glass-text-shadow font-bold mb-3">Also signing up</h2>
        <ul className="grid grid-cols-2 gap-2.5 mb-8">
          {rest.map((s) => (
            <li key={s.slug}>
              <Link
                href={`/brisbane/${s.slug}`}
                className="block rounded-2xl liquid-glass px-3.5 py-3 text-[14px] font-semibold text-white hover:bg-white/25 transition-colors"
              >
                {s.name}
              </Link>
            </li>
          ))}
        </ul>

        <Link
          href="/"
          className="inline-flex items-center min-h-[44px] rounded-full liquid-glass-pill px-4 py-2 text-[13px] text-white font-semibold hover:bg-white/25"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
