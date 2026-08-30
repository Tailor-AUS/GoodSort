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
        <p className="text-slate-500 text-sm mb-6">Last updated: August 2026</p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">1. Information We Collect</h2>
        <p className="text-slate-600 text-sm mb-4">
          The Good Sort collects the following information when you use our service:
        </p>
        <ul className="list-disc pl-5 text-slate-600 text-sm space-y-1 mb-4">
          <li>Email address (for account verification)</li>
          <li>Name and household address</li>
          <li>Container scan records (barcodes, materials, timestamps)</li>
          <li>Photographs you take to identify containers, and a short mathematical
            fingerprint of each one</li>
          <li>Where a bin deposit was made, when you scan at one of our bins</li>
          <li>Location data (for map functionality and route optimization)</li>
          <li>Waitlist consent, recycling day, and later collection of a The Good Sort bin</li>
          <li>Collection and earnings history</li>
        </ul>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">2. How We Use Your Information</h2>
        <p className="text-slate-600 text-sm mb-4">
          We use your information to operate the waitlist, decide when an area has enough density to
          order bins, schedule collection of The Good Sort bins, process sorting credits, and improve
          the service. We share your address and container counts with appointed runners for pickup
          only after your area is collecting. We do not sell your personal information.
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
          When you photograph containers, the image is sent to an artificial-intelligence
          service that identifies what is in it. That processing may happen outside
          Australia. <strong>We do not keep your photo.</strong> We keep a short
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

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">7. Contact</h2>
        <p className="text-slate-600 text-sm mb-4">
          For privacy inquiries, contact us at privacy@thegoodsort.org or write to:
          Crispr Projects Pty Ltd (ABN 85 680 798 770), trading as The Good Sort, Moorooka QLD 4105, Australia.
        </p>
      </div>
    </div>
  );
}
