import type { Metadata } from "next";
import Link from "next/link";
import { LIVE_VOLUME_THRESHOLD, wedgeSuburbs } from "@/lib/brisbane";
import { Logo } from "@/app/components/shared/logo";
import { SITE_URL } from "@/app/seo";

const PATH = "/guides/containers-for-change-brisbane";
const TITLE = "Containers for Change in Brisbane";
const DESCRIPTION =
  "Eligible drink containers in Queensland are worth 10¢ at a refund point. Scan them at home with The Good Sort for a 5¢ sorting credit, and a driver trip starts when your suburb has enough containers.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: {
    title: `${TITLE} | The Good Sort`,
    description: DESCRIPTION,
    url: PATH,
    siteName: "The Good Sort",
    locale: "en_AU",
    type: "article",
  },
};

const faq = [
  {
    q: "Is The Good Sort the 10¢ Containers for Change refund?",
    a: "No. The scheme pays 10¢ when an eligible container is presented at a refund point. The Good Sort pays a 5¢ sorting credit for the scan. We are not a Containers for Change refund point.",
  },
  {
    q: "Can I start if nobody else in my suburb has scanned yet?",
    a: "Yes. Scanning is open across Brisbane City Council suburbs today. A driver trip for your suburb starts when there are about 1,000 scanned containers, enough for one run. City-wide totals never unlock a trip.",
  },
  {
    q: "Do I have to drive to a depot?",
    a: "Not for the scan. You photograph the container at home, sort it into your own bags, and keep the 5¢ pending. Collection from the kerb happens when your suburb's volume run is on, not before.",
  },
];

export default function ContainersForChangeBrisbanePage() {
  const wedge = wedgeSuburbs();
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <div className="min-h-dvh bg-white px-6 py-10 max-w-2xl mx-auto">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <div className="mb-8"><Logo size="sm" /></div>
      <p className="text-[12px] font-semibold uppercase tracking-[0.15em] text-violet-800 mb-3">
        Brisbane · scan first
      </p>
      <h1 className="text-3xl sm:text-4xl font-display font-extrabold text-slate-950 leading-tight mb-4">
        Containers for Change in Brisbane, without the depot queue
      </h1>
      <p className="text-[16px] text-slate-700 leading-relaxed mb-4">
        Most eligible cans and bottles in Queensland never reach a refund point.
        The 10¢ is real. The Saturday queue is why it goes unclaimed.
      </p>
      <p className="text-[16px] text-slate-700 leading-relaxed mb-8">
        The Good Sort is the at-home version. Scan a container, earn a 5¢ sorting
        credit, and sort it into your own bags. When your suburb has about{" "}
        {LIVE_VOLUME_THRESHOLD.toLocaleString()} scanned containers — one driver
        trip — bag out and we take them to a refund point.
      </p>

      <Link
        href="/scan"
        className="inline-flex items-center justify-center bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold px-5 py-4 rounded-2xl text-[16px] min-h-[52px]"
      >
        Scan a container
      </Link>

      <h2 className="text-xl font-display font-extrabold text-slate-900 mt-12 mb-3">
        What the 10¢ actually is
      </h2>
      <p className="text-[15px] text-slate-600 leading-relaxed mb-4">
        Queensland&apos;s container refund scheme pays 10¢ for most drink
        containers between 150ml and 3L when they are presented at a refund
        point: a depot, a reverse vending machine, or a bag drop. Wine and
        spirit bottles in that size range have been in the scheme since
        November 2023.
      </p>
      <p className="text-[15px] text-slate-600 leading-relaxed">
        That 10¢ is the scheme&apos;s refund, paid at the refund point. Your 5¢
        on The Good Sort is a private sorting credit. It is pending until a
        volume run is collected and the containers are verified. It is not the
        scheme refund, and this site is not a refund point.
      </p>

      <h2 className="text-xl font-display font-extrabold text-slate-900 mt-12 mb-3">
        What you can do today
      </h2>
      <ol className="list-decimal pl-5 text-[15px] text-slate-600 space-y-3">
        <li>Open the scanner and photograph one eligible can or bottle.</li>
        <li>Confirm the material. An eligible container credits 5¢, pending.</li>
        <li>Add your email and your address so the scan counts in your suburb.</li>
        <li>Sort into four bags at home: aluminium, PET, glass, and other.</li>
      </ol>
      <p className="text-[15px] text-slate-600 leading-relaxed mt-4">
        You do not wait for a bin to be delivered, and you do not need neighbours
        signed up before the first scan. The first household in a suburb is the
        one that starts the count.
      </p>

      <h2 className="text-xl font-display font-extrabold text-slate-900 mt-12 mb-3">
        When a driver actually comes
      </h2>
      <p className="text-[15px] text-slate-600 leading-relaxed mb-4">
        A volume run unlocks per suburb, at about {LIVE_VOLUME_THRESHOLD.toLocaleString()}{" "}
        scanned containers. That is one van, not a standing weekly pickup, and
        not a promise that someone is already booked. Until that count is
        reached, keep the bags at home. City-wide totals never unlock a run.
      </p>
      <p className="text-[15px] text-slate-600 leading-relaxed">
        Inner south is first because the refund points are there: Moorooka,
        Yeronga, Yeerongpilly and the suburbs around them. Anyone in a Brisbane
        City Council suburb can still scan today.
      </p>

      <h2 className="text-xl font-display font-extrabold text-slate-900 mt-12 mb-4">
        Start in your suburb
      </h2>
      <ul className="grid grid-cols-2 gap-2 mb-8">
        {wedge.map((s) => (
          <li key={s.slug}>
            <Link
              href={`/brisbane/${s.slug}`}
              className="block border border-slate-200 rounded-xl px-3 py-3 text-[14px] font-semibold text-slate-900 hover:border-green-500"
            >
              {s.name}
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/brisbane" className="text-[13px] text-green-700 font-semibold">
        Every Brisbane suburb
      </Link>

      <h2 className="text-xl font-display font-extrabold text-slate-900 mt-12 mb-4">
        Questions
      </h2>
      <div className="space-y-6">
        {faq.map((item) => (
          <div key={item.q}>
            <h3 className="text-[15px] font-bold text-slate-900 mb-1">{item.q}</h3>
            <p className="text-[14px] text-slate-600 leading-relaxed">{item.a}</p>
          </div>
        ))}
      </div>

      <div className="mt-12 mb-8">
        <Link
          href="/scan"
          className="inline-flex items-center justify-center bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold px-5 py-4 rounded-2xl text-[16px] min-h-[52px]"
        >
          Scan a container
        </Link>
      </div>

      <p className="text-[12px] text-slate-400 leading-relaxed border-t border-slate-100 pt-6">
        Sorting credits are a private reward, not the 10¢ Containers for Change
        refund. We are not claiming approval as a refund point.{" "}
        <Link href="/terms" className="underline">Terms</Link>
        {" · "}
        <Link href="/" className="underline">Home</Link>
        {" · "}
        <a href={SITE_URL} className="underline">thegoodsort.org</a>
      </p>
    </div>
  );
}
