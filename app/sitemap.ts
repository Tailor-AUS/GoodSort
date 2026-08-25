import type { MetadataRoute } from "next";
import { BRISBANE_SUBURBS } from "@/lib/brisbane";
import { absoluteUrl, SOCIAL_IMAGE } from "./seo";

const lastModified = "2026-08-25";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: absoluteUrl("/"),
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
      images: [absoluteUrl(SOCIAL_IMAGE.url)],
    },
    {
      url: absoluteUrl("/brisbane"),
      lastModified,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    ...BRISBANE_SUBURBS.map((s) => ({
      url: absoluteUrl(`/brisbane/${s.slug}`),
      lastModified,
      changeFrequency: "weekly" as const,
      priority: s.wedge ? 0.7 : 0.5,
    })),
    {
      url: absoluteUrl("/privacy"),
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: absoluteUrl("/terms"),
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
