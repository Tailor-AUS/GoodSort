import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BRISBANE_SUBURBS, LIVE_HOUSEHOLD_THRESHOLD } from "@/lib/brisbane";
import { MarketingHome } from "@/app/components/marketing/marketing-home";
import { SITE_URL } from "@/app/seo";

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
  const description = `Start sorting today in ${found.name}. We tell you the collection night once ${LIVE_HOUSEHOLD_THRESHOLD} neighbours on the same recycling day join.`;
  return {
    title: `${found.name} — start sorting`,
    description,
    alternates: { canonical: `/brisbane/${found.slug}` },
    openGraph: {
      title: `${found.name} | The Good Sort`,
      description,
      url: `/brisbane/${found.slug}`,
      siteName: "The Good Sort",
      locale: "en_AU",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${found.name} | The Good Sort`,
      description,
    },
  };
}

export default async function SuburbPage({
  params,
}: {
  params: Promise<{ suburb: string }>;
}) {
  const { suburb } = await params;
  const found = BRISBANE_SUBURBS.find((s) => s.slug === suburb);
  if (!found) notFound();
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: `The Good Sort — ${found.name}`,
    url: `${SITE_URL}/brisbane/${found.slug}`,
    areaServed: {
      "@type": "Place",
      name: `${found.name}, Brisbane, Queensland`,
    },
    provider: {
      "@type": "Organization",
      name: "The Good Sort",
      url: SITE_URL,
    },
    description: `Start sorting today in ${found.name}. ${LIVE_HOUSEHOLD_THRESHOLD} neighbours on the same recycling day start the collection night.`,
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <MarketingHome suburbName={found.name} />
    </>
  );
}
