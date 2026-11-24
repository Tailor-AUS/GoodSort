import type { MetadataRoute } from "next";
import { absoluteUrl, SITE_URL } from "./seo";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [
        "/",
        "/brisbane",
        "/guides",
        "/privacy",
        "/terms",
        "/favicon.ico",
        "/favicon.svg",
        "/favicon-16x16.png",
        "/favicon-32x32.png",
        "/apple-touch-icon.png",
        "/icon-192.png",
        "/icon-512.png",
        "/icon-512-maskable.png",
        "/images/",
      ],
      disallow: [
        "/admin",
        "/household",
        "/invite",
        "/login",
        "/onboard",
        "/runner",
        "/scan",
        "/sort",
        "/start",
        "/verify",
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
