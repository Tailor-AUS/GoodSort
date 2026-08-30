import type { Metadata } from "next";
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
  if (!found) return { title: "Brisbane" };
  return {
    title: `${found.name} letterbox card`,
    description: `Print a letterbox card to invite ${found.name} neighbours to scan.`,
    // An internal tool, not a landing page.
    robots: { index: false, follow: false },
  };
}

export default async function StreetCardPage({
  params,
}: {
  params: Promise<{ suburb: string }>;
}) {
  const { suburb } = await params;
  const found = BRISBANE_SUBURBS.find((s) => s.slug === suburb);
  if (!found) notFound();
  return <StreetCard suburb={found.name} slug={found.slug} />;
}
