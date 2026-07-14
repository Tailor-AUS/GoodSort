import type { Metadata } from "next";

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://thegoodsort.org"
).replace(/\/+$/, "");

export const SITE_NAME = "The Good Sort";
export const SITE_TITLE = "The Good Sort | Brisbane yellow-bin container pickup";
export const SITE_DESCRIPTION =
  "The Good Sort helps Brisbane households turn eligible cans and bottles into sorting credits without a depot run. Scan, sort into your yellow bin, and get paid after pickup.";

export const SOCIAL_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "The Good Sort yellow-bin container pickup service in Brisbane",
};

export const seoKeywords = [
  "The Good Sort",
  "GoodSort",
  "Brisbane recycling pickup",
  "yellow bin recycling",
  "container refund pickup",
  "Containers for Change",
  "Queensland container refund scheme",
  "cash for cans Brisbane",
  "recycling app Australia",
];

export const homeMetadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: SITE_NAME,
    locale: "en_AU",
    type: "website",
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
};

export const noIndexMetadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export function absoluteUrl(path = "/") {
  return new URL(path, SITE_URL).toString();
}
