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
      name: "The Good Sort Brisbane collection",
      serviceType: "Residential container sorting and scheduled pickup",
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
        "Scan eligible drink containers in Brisbane for a 10¢ sorting credit. When your suburb has enough containers for one driver trip, bag out — we take them to a refund point or depot.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "AUD",
        description: "Free to join. Scan for 10¢. Suburb volume run when there are enough containers for one driver trip.",
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
            text: "Scan eligible cans and bottles. Earn a 10¢ sorting credit each. Sort into four streams at home. When your suburb has enough scanned containers for one driver trip, bag out — we collect and present them at a refund point or depot.",
          },
        },
        {
          "@type": "Question",
          name: "Is The Good Sort live across Brisbane?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "You can start scanning today. A suburb volume run starts when there are enough containers for one driver trip. City-wide totals never unlock a run.",
          },
        },
        {
          "@type": "Question",
          name: "Do I need to drive to a depot?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. Keep scanning and sorting at home. When suburb volume is enough, bag out — we take the containers to a refund point or depot.",
          },
        },
        {
          "@type": "Question",
          name: "Is this the Containers for Change 10¢ refund?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. Sorting credits (10¢ per eligible container) are a private reward paid by The Good Sort after pickup and depot verification. The Good Sort is not claiming approval as a Containers for Change refund point.",
          },
        },
        {
          "@type": "Question",
          name: "Do I have to scan every container?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Scan is how you earn the 10¢ sorting credit and build suburb volume. Pending credits clear after we collect and containers are verified at a refund point or depot.",
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
