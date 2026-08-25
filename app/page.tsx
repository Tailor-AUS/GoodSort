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
        "Join with your Brisbane address and start sorting eligible drink containers at home today. We tell you the collection night — the night before council recycling — once 12 houses on the same recycling day join. 5¢ sorting credit after depot verification.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "AUD",
        description: "Free to join. Sort today. Collection night starts when your recycling day unlocks.",
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
            text: "Join with your address and start sorting at home today — four streams, you manage them. We tell you the collection night: the night before your council recycling day. That night starts when 12 houses in your suburb on the same recycling day join. We do not rummage the council yellow bin. Scan is optional.",
          },
        },
        {
          "@type": "Question",
          name: "Is The Good Sort live across Brisbane?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "You can start sorting today. Collection nights start only when a suburb and recycling day hit 12 houses. City-wide totals never unlock a run.",
          },
        },
        {
          "@type": "Question",
          name: "Do I need to drive to a depot?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. Keep sorting at home. When your recycling day is live, we collect from the kerb. You do not drive to a depot.",
          },
        },
        {
          "@type": "Question",
          name: "Is this the Containers for Change 10¢ refund?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. The scheme pays 10¢ when eligible containers reach a refund point. You earn a 5¢ sorting credit from The Good Sort. We are not claiming approval as a Containers for Change refund point.",
          },
        },
        {
          "@type": "Question",
          name: "Do I have to scan every container?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. Scanning is optional. Credits are based on the runner count when we collect, after a depot verifies the containers.",
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
