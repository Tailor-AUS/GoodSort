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
      name: "The Good Sort purple-bin waitlist",
      serviceType: "Residential container recycling waitlist and pickup",
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
        "Join a Brisbane waitlist for a purple The Good Sort bin. When 12 houses on the same recycling day join, we deliver the bin and collect eligible drink containers, paying a 5¢ sorting credit after depot verification.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "AUD",
        description: "Free waitlist signup. Collection starts when your area unlocks.",
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
            text: "Request a purple The Good Sort bin. That puts your house on a Brisbane waitlist. When 12 houses in your suburb on the same recycling day join, we deliver our bin and collect eligible cans and bottles. We do not rummage the council yellow bin. Scan is optional.",
          },
        },
        {
          "@type": "Question",
          name: "Is The Good Sort live across Brisbane?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. This is a waitlist, not a city-wide pickup. Collection starts only when a suburb and recycling day hit 12 houses. City-wide totals never unlock a run.",
          },
        },
        {
          "@type": "Question",
          name: "Do I need to drive to a depot?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. Once your street is live, we collect the purple The Good Sort bin we delivered. You do not drive to a depot.",
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
            text: "No. Scanning is optional. Credits are based on the runner count when we collect your purple bin, after a depot verifies the containers.",
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
