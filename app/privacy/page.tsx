export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-white px-6 py-12 max-w-2xl mx-auto">
      <h1 className="text-3xl font-display font-extrabold text-slate-900 mb-8">Privacy Policy</h1>
      <div className="prose prose-slate prose-sm">
        <p className="text-slate-500 text-sm mb-6">Last updated: April 2026</p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">1. Information We Collect</h2>
        <p className="text-slate-600 text-sm mb-4">
          The Good Sort collects the following information when you use our service:
        </p>
        <ul className="list-disc pl-5 text-slate-600 text-sm space-y-1 mb-4">
          <li>Phone number (for account verification)</li>
          <li>Name and household address</li>
          <li>Container scan records (barcodes, materials, timestamps)</li>
          <li>Location data (for map functionality and route optimization)</li>
          <li>Collection and earnings history</li>
        </ul>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">2. How We Use Your Information</h2>
        <p className="text-slate-600 text-sm mb-4">
          We use your information to operate the container recycling service, process container refunds,
          optimize collection routes, and improve our service. We do not sell your personal information
          to third parties.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">3. Data Storage</h2>
        <p className="text-slate-600 text-sm mb-4">
          Your data is stored securely on servers located in Australia. We use industry-standard
          encryption and security measures to protect your information.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">4. Your Rights</h2>
        <p className="text-slate-600 text-sm mb-4">
          Under the Australian Privacy Act 1988, you have the right to access, correct, and delete
          your personal information. Contact us at privacy@goodsort.com.au to exercise these rights.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">5. Location Data</h2>
        <p className="text-slate-600 text-sm mb-4">
          We collect location data only when you actively use the app and have granted permission.
          Location data is used for displaying nearby collection points and optimizing collection routes.
          You can disable location access in your device settings at any time.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">6. Contact</h2>
        <p className="text-slate-600 text-sm mb-4">
          For privacy inquiries, contact us at privacy@goodsort.com.au or write to:
          The Good Sort Pty Ltd, South Brisbane QLD 4101, Australia.
        </p>
      </div>
    </div>
  );
}
