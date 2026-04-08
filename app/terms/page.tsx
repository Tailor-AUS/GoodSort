export default function TermsPage() {
  return (
    <div className="min-h-dvh bg-white px-6 py-12 max-w-2xl mx-auto">
      <h1 className="text-3xl font-display font-extrabold text-slate-900 mb-8">Terms of Service</h1>
      <div className="prose prose-slate prose-sm">
        <p className="text-slate-500 text-sm mb-6">Last updated: April 2026</p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">1. Service Description</h2>
        <p className="text-slate-600 text-sm mb-4">
          The Good Sort Pty Ltd (&quot;The Good Sort&quot;, &quot;we&quot;, &quot;us&quot;) operates a container
          sorting and collection platform. We provide physical collection bins (&quot;Bins&quot;) at various
          locations where users (&quot;Sorters&quot;) may deposit eligible beverage containers. We separately
          engage collection personnel (&quot;Runners&quot;) to collect deposited containers and deliver them
          to approved recycling depots. The Good Sort is the entity that returns containers to Container
          Refund Points under the Queensland Container Refund Scheme (Containers for Change).
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">2. Sorting Credits — Not CDS Refunds</h2>
        <p className="text-slate-600 text-sm mb-4">
          <strong>Important:</strong> Credits earned through The Good Sort are &quot;Sorting Credits&quot; — a
          reward paid by The Good Sort for the service of sorting and depositing eligible containers into
          our Bins. Sorting Credits are <strong>not</strong> the 10-cent container refund under the Queensland
          Container Refund Scheme. The Good Sort, as the party physically returning containers to approved
          depots, is the recipient of any applicable CDS refunds and handling fees. Sorting Credits are a
          separate, private arrangement between you and The Good Sort.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">3. Sorting Credit Rates</h2>
        <p className="text-slate-600 text-sm mb-4">
          Sorters earn Sorting Credits at the rate displayed in the app at the time of scanning (currently
          5 cents per eligible container). Runner Credits are earned at rates displayed in the Runner app.
          We reserve the right to adjust credit rates at any time. Rate changes will be reflected in the
          app and apply to future scans only.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">4. Pending and Cleared Balances</h2>
        <p className="text-slate-600 text-sm mb-4">
          Scanning a container earns a &quot;pending&quot; Sorting Credit. Pending credits are confirmed
          and moved to your &quot;cleared&quot; balance only when the containers from that Bin are physically
          collected by a Runner and verified at an approved depot. The actual cleared amount may differ
          from the pending amount based on depot verification and container eligibility. Containers that
          are ineligible, damaged, or rejected by the depot will not generate cleared credits.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">5. Cash Out</h2>
        <p className="text-slate-600 text-sm mb-4">
          Cleared balances may be cashed out via bank transfer to an Australian bank account. A minimum
          threshold of $20.00 applies. Cash-out requests are processed in weekly batches via ABA bank
          file. Processing typically takes 3-5 business days from the batch date. The Good Sort is not
          a financial institution, and credit balances are not insured deposits or held on trust.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">6. Eligibility</h2>
        <p className="text-slate-600 text-sm mb-4">
          You must be at least 13 years old and located in Queensland, Australia to use this service.
          Sorting Credits are only earned for eligible beverage containers as defined by the QLD
          Container Refund Scheme (150ml to 3L containers bearing a refund marking). Non-eligible items
          deposited in Bins will not earn credits and may result in account review.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">7. Runner Terms</h2>
        <p className="text-slate-600 text-sm mb-4">
          Runners are independent contractors, not employees of The Good Sort. Runners are responsible
          for their own vehicle, fuel, insurance, and compliance with all applicable road rules and
          regulations. The Good Sort is not liable for any incidents, injuries, or property damage
          occurring during collection or delivery. Runner Credits are earned per collection route
          completed and verified at a depot.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">8. Fraud Prevention</h2>
        <p className="text-slate-600 text-sm mb-4">
          The following activities constitute fraud and will result in immediate account termination
          and forfeiture of all pending and cleared balances: scanning containers not physically
          deposited in a Good Sort Bin; scanning containers at a Bin without being physically present;
          submitting false delivery confirmations; manipulating container counts; creating multiple
          accounts; or any other deceptive activity. We reserve the right to withhold payouts pending
          investigation and to report suspected fraud to relevant authorities.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">9. Bins and Property</h2>
        <p className="text-slate-600 text-sm mb-4">
          Good Sort Bins remain the property of The Good Sort Pty Ltd. Bins are placed at locations
          with the consent of the property owner or occupier. Containers deposited in Bins become
          the property of The Good Sort upon deposit. Tampering with, damaging, or removing Bins
          or their contents is prohibited and may constitute theft.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">10. Limitation of Liability</h2>
        <p className="text-slate-600 text-sm mb-4">
          The Good Sort is provided &quot;as is&quot; without warranties of any kind. We are not liable
          for lost or damaged containers, depot rejections, service interruptions, app downtime, or
          delays in credit processing. Our total aggregate liability to any user is limited to the
          cleared balance in their account at the time of any claim.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">11. Changes to Terms</h2>
        <p className="text-slate-600 text-sm mb-4">
          We may update these terms at any time. Material changes (including changes to credit rates)
          will be communicated via the app and/or email. Continued use of the service after notification
          constitutes acceptance of updated terms. If you do not agree with changes, you may cash out
          your cleared balance and discontinue use.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">12. Governing Law</h2>
        <p className="text-slate-600 text-sm mb-4">
          These terms are governed by the laws of Queensland, Australia. Any disputes arising from
          these terms or your use of the service will be subject to the exclusive jurisdiction of
          the courts of Queensland.
        </p>

        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">13. Contact</h2>
        <p className="text-slate-600 text-sm mb-4">
          For questions about these terms, contact us at legal@thegoodsort.org or write to:
          The Good Sort Pty Ltd, Moorooka QLD 4105, Australia.
        </p>
      </div>
    </div>
  );
}
