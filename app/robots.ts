import type { MetadataRoute } from "next";
import { absoluteUrl, SITE_URL } from "./seo";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/brisbane", "/privacy", "/terms", "/favicon.ico", "/favicon.svg", "/icon-192.png", "/icon-512.png"],
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
