import { ImageResponse } from "next/og";
import { BRISBANE_SUBURBS, titleSuburb } from "@/lib/brisbane";
import { OG_SIZE, waitlistOgElement } from "@/app/og/waitlist-og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const dynamic = "force-static";

export function generateStaticParams() {
  return BRISBANE_SUBURBS.map((s) => ({ suburb: s.slug }));
}

export const alt = "Start sorting today with The Good Sort in this Brisbane suburb";

export default async function Image({ params }: { params: Promise<{ suburb: string }> }) {
  const { suburb } = await params;
  const found = BRISBANE_SUBURBS.find((s) => s.slug === suburb);
  return new ImageResponse(waitlistOgElement({ suburb: found?.name ?? titleSuburb(suburb) }), size);
}
