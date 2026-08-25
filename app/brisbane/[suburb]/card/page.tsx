import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BRISBANE_SUBURBS } from "@/lib/brisbane";
import { StreetCard } from "@/app/components/marketing/street-card";

export function generateStaticParams() {
  return BRISBANE_SUBURBS.map((s) => ({ suburb: s.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ suburb: string }>;
}): Promise<Metadata> {
  const { suburb } = await params;
  const found = BRISBANE_SUBURBS.find((s) => s.slug === suburb);
  return {
    title: found ? `${found.name} letterbox card` : "Letterbox card",
    robots: { index: false, follow: false },
  };
}

export default async function SuburbCardPage({
  params,
}: {
  params: Promise<{ suburb: string }>;
}) {
  const { suburb } = await params;
  const found = BRISBANE_SUBURBS.find((s) => s.slug === suburb);
  if (!found) notFound();
  return (
    <Suspense fallback={<p className="p-6 text-slate-500">Preparing card…</p>}>
      <StreetCard suburbName={found.name} suburbSlug={found.slug} />
    </Suspense>
  );
}
