import { MarketingHome } from "@/app/components/marketing/marketing-home";
import {
  absoluteUrl,
  homeMetadata,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "@/app/seo";

export const metadata = homeMetadata;

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      inLanguage: "en-AU",
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: absoluteUrl("/icon-512.png"),
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: "hello@thegoodsort.org",
        areaServed: "AU",
        availableLanguage: "English",
      },
    },
    {
      "@type": "Service",
      "@id": `${SITE_URL}/#service`,
      name: "Yellow-bin container pickup",
      serviceType: "Residential container recycling pickup",
      provider: {
        "@id": `${SITE_URL}/#organization`,
      },
      areaServed: {
        "@type": "City",
        name: "Brisbane",
        addressRegion: "Queensland",
        addressCountry: "AU",
      },
      description:
        "The Good Sort helps Brisbane households scan eligible drink containers, sort them into a yellow bin, and earn sorting credits after pickup.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "AUD",
        description: "Free household signup with sorting credits for eligible containers.",
      },
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE_URL}/#faq`,
      mainEntity: [
        {
          "@type": "Question",
          name: "How does The Good Sort work?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Scan your eligible cans and bottles, place them in the CDS side of your yellow bin, and The Good Sort collects them before council collection day.",
          },
        },
        {
          "@type": "Question",
          name: "Where is The Good Sort available?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "The Good Sort is currently focused on Brisbane households with council yellow-bin collection.",
          },
        },
        {
          "@type": "Question",
          name: "Do I need to drive to a depot?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. The service is designed to remove the depot trip by collecting sorted eligible containers from your yellow bin.",
          },
        },
      ],
    },
  ],
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <MarketingHome />
    </>
  );
}
