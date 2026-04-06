export default function TermsPage() {
  return (
    <div className="min-h-dvh bg-white px-6 py-12 max-w-2xl mx-auto">
      <h1 className="text-3xl font-display font-extrabold text-slate-900 mb-8">Terms of Service</h1>
      <div className="prose prose-slate prose-sm">
        <p className="text-slate-500 text-sm mb-6">Last updated: April 2026</p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">1. Service Description</h2>
        <p className="text-slate-600 text-sm mb-4">
          The Good Sort operates a container recycling platform under the Queensland Container Refund
          Scheme (Containers for Change). Users scan eligible beverage containers, sort them into
          designated bags, and earn refunds when containers are collected and verified at approved depots.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">2. Eligibility</h2>
        <p className="text-slate-600 text-sm mb-4">
          You must be at least 13 years old and a resident of Queensland, Australia to use this service.
          Container refunds are available only for eligible containers as defined by the QLD Container
          Refund Scheme (150ml to 3L beverage containers with a refund marking).
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">3. Pending Balances</h2>
        <p className="text-slate-600 text-sm mb-4">
          Scanned containers earn a pending balance. This balance is only confirmed and cleared when
          containers are physically collected by a Runner and verified at an approved depot. The actual
          payout may differ from the pending amount based on depot verification.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">4. Cash Out</h2>
        <p className="text-slate-600 text-sm mb-4">
          Cleared balances may be cashed out via bank transfer. A minimum threshold of $20 applies.
          Processing times may vary. The Good Sort is not a financial institution and balances are
          not insured deposits.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">5. Runner Terms</h2>
        <p className="text-slate-600 text-sm mb-4">
          Runners are independent contractors, not employees. Runners are responsible for their own
          vehicle, insurance, and compliance with road rules. The Good Sort is not liable for any
          incidents during collection or delivery.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">6. Fraud Prevention</h2>
        <p className="text-slate-600 text-sm mb-4">
          Scanning containers you do not physically possess, submitting false delivery confirmations,
          or any other fraudulent activity will result in account termination and forfeiture of
          pending balances. We reserve the right to withhold payouts pending investigation.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">7. Limitation of Liability</h2>
        <p className="text-slate-600 text-sm mb-4">
          The Good Sort is provided "as is" without warranties. We are not liable for lost or
          damaged containers, depot rejections, or service interruptions. Our total liability
          is limited to the cleared balance in your account.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">8. Changes</h2>
        <p className="text-slate-600 text-sm mb-4">
          We may update these terms at any time. Continued use of the service constitutes acceptance
          of updated terms. Material changes will be communicated via the app.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">9. Governing Law</h2>
        <p className="text-slate-600 text-sm mb-4">
          These terms are governed by the laws of Queensland, Australia.
        </p>
      </div>
    </div>
  );
}
