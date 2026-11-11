import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How The Good Sort collects, uses, stores, and protects account, address, location, scan, and earnings information.",
  alternates: {
    canonical: "/privacy",
  },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-white px-6 py-12 max-w-2xl mx-auto">
      <h1 className="text-3xl font-display font-extrabold text-slate-900 mb-8">Privacy Policy</h1>
      <div className="prose prose-slate prose-sm">
        <p className="text-slate-500 text-sm mb-6">Last updated: November 2026</p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">1. Information We Collect</h2>
        <p className="text-slate-600 text-sm mb-4">
          The Good Sort collects the following information when you use our service:
        </p>
        <ul className="list-disc pl-5 text-slate-600 text-sm space-y-1 mb-4">
          <li>Email address (for account verification)</li>
          <li>Name and household pickup address</li>
          <li>Payout preferences (PayID or Australian BSB, account number, and account holder name when you save a payout method or request cash-out)</li>
          <li>Container scan records (barcodes, materials, QR bag tag IDs, timestamps)</li>
          <li>Photographs you take to identify containers, and a short mathematical
            fingerprint of each one</li>
          <li>Where a bin deposit was made, when you scan at one of our bins</li>
          <li>Location data (for map functionality and route optimization)</li>
          <li>Pickup consent and kerbside collection status of your sorted home bags</li>
          <li>Collection, referral network, and earnings history</li>
        </ul>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">2. How We Use Your Information</h2>
        <p className="text-slate-600 text-sm mb-4">
          We use your information to track suburb container volume toward collection runs (about 1,000
          scanned containers), coordinate kerbside pickup of QR-tagged home bags, verify depot counts,
          process sorting credits and PayID/bank payouts, and improve the service. We share your pickup
          address and bag counts with appointed runners only when a collection run is active for your
          suburb. We never share your PayID or bank account details with runners, and we do not sell
          your personal information.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">3. Data Storage</h2>
        <p className="text-slate-600 text-sm mb-4">
          Account, waitlist, and collection data are stored on Microsoft Azure (Azure SQL and related
          services). The live API currently runs in Azure East Asia. That is not an Australian region.
          We intend to host in Australia and will update this policy when that move is complete.
          Traffic is encrypted in transit.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">4. Your Rights</h2>
        <p className="text-slate-600 text-sm mb-4">
          Under the Australian Privacy Act 1988, you have the right to access, correct, and delete
          your personal information. Contact us at privacy@thegoodsort.org to exercise these rights.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">5. Photo Scanning</h2>
        <p className="text-slate-600 text-sm mb-4">
          When you photograph containers, the image is sent to our Australian Azure OpenAI
          service (Australia East) that identifies what is in it. <strong>We do not keep your photo.</strong> We keep a short
          mathematical fingerprint of it so the same photo cannot be claimed twice,
          and — for deposits at one of our bins — the location where the scan was made,
          so we can tell a real deposit from credit farmed remotely. You can use the
          app without photo scanning.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">6. Location Data</h2>
        <p className="text-slate-600 text-sm mb-4">
          We collect location data only when you actively use the app and have granted permission.
          Location data is used for displaying nearby collection points and optimizing collection routes.
          You can disable location access in your device settings at any time.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">7. Services We Rely On</h2>
        <p className="text-slate-600 text-sm mb-4">
          Some parts of the app are provided by other organisations, and reach them rather than us.
        </p>
        <ul className="list-disc pl-5 text-slate-600 text-sm space-y-1 mb-4">
          <li>
            <strong>Address suggestions.</strong> Once you have typed three characters of an address,
            what you have typed is sent from your browser to Photon, an address-lookup service
            operated by Komoot, a German company. It is sent as you type, not when you choose a
            suggestion, so it happens even if you ignore the suggestions or never finish signing up,
            and it reaches them before it reaches us.
          </li>
          <li>
            <strong>Maps.</strong> Map images come from OpenFreeMap, which is outside Australia. Loading
            them tells that service roughly which area of the map you are looking at.
          </li>
          <li>
            <strong>Route planning.</strong> When we plan a collection run we send the stop locations to
            a public routing service (OSRM), from our servers rather than your device.
          </li>
        </ul>
        <p className="text-slate-600 text-sm mb-4">
          None of these receive your email address, your scan history or your balance.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">8. Contact</h2>
        <p className="text-slate-600 text-sm mb-4">
          For privacy inquiries, contact us at privacy@thegoodsort.org or write to:
          Tailor Intelligence Pty Ltd (ABN 13 688 827 572), trading as The Good Sort, Moorooka QLD 4105, Australia.
        </p>
      </div>
    </div>
  );
}
