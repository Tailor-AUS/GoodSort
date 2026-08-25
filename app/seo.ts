import type { Metadata } from "next";

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://thegoodsort.org"
).replace(/\/+$/, "");

export const SITE_NAME = "The Good Sort";
export const SITE_TITLE = "The Good Sort | Brisbane purple-bin waitlist";
export const SITE_DESCRIPTION =
  "Join the waitlist for a purple The Good Sort bin. When enough neighbours on your street sign up, we deliver the bin and start collecting eligible cans and bottles. We'll let you know when we're collecting in your area.";

export const SOCIAL_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "The Good Sort purple-bin waitlist for Brisbane streets",
};

export const seoKeywords = [
  "The Good Sort",
  "GoodSort",
  "Brisbane recycling pickup",
  "container refund pickup",
  "Containers for Change",
  "Queensland container refund scheme",
  "cash for cans Brisbane",
  "recycling waitlist Brisbane",
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
