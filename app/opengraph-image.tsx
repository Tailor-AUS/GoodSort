import { ImageResponse } from "next/og";
import { OG_ALT, OG_SIZE, waitlistOgElement } from "./og/waitlist-og";

export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = "image/png";
export const dynamic = "force-static";

export default function Image() {
  return new ImageResponse(waitlistOgElement(), size);
}
