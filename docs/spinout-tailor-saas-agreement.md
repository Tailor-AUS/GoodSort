# Tailor Vision ↔ GoodSort — SaaS Agreement Outline

**Status:** Commercial draft for lawyer to formalise. Not legally binding until signed.
**Parties:** Tailor (vision API provider) and GoodSort Pty Ltd (API consumer)
**Scope:** Arms-length commercial agreement governing GoodSort's ongoing use of the Tailor Vision API.

---

## 1. Parties

- **Supplier:** [Tailor legal entity name + ABN — TBC by Knox]
- **Customer:** GoodSort Pty Ltd (ACN/ABN — TBC at incorporation)

## 2. Services

Tailor grants GoodSort a non-exclusive, non-transferable licence to access and use the **Tailor Vision API** for the purpose of identifying beverage containers in the GoodSort product.

**Endpoint in scope:** `POST https://api.tailor.au/api/vision/classify`

**What Tailor provides:**
- Hosted REST API for container classification from images
- Container material classification (aluminium, PET, glass, HDPE, liquid paperboard, steel, other)
- CDS eligibility determination per Australian jurisdictional rules
- Barcode recognition where available
- Confidence scoring on classifications

**What GoodSort receives per call:**
- Classification object: material, description, confidence
- CDS eligibility flag with jurisdictional basis
- Barcode data (if detected)
- Alternatives / candidates if confidence is low

## 3. Pricing

### 3.1 Pricing model

**GoodSort pays Tailor 1.85× Tailor's cost of goods sold (COGS) per successful classification call**, invoiced monthly in arrears.

"COGS per call" means Tailor's direct per-call costs, including but not limited to:
- Azure OpenAI / equivalent AI inference costs
- Azure compute / hosting allocated per call
- Image storage allocated per call
- Third-party data licence costs apportioned per call

### 3.2 COGS transparency

Tailor will provide GoodSort with a **quarterly COGS breakdown** showing the composition of per-call costs. GoodSort may request (acting reasonably and no more than once per quarter) a review of the calculation by an independent accountant at its own cost.

### 3.3 Invoicing

- Monthly invoice issued within 7 days of month-end
- Payment terms: **net 14 days** from invoice date
- GST inclusive (or GST applied per ATO rules)
- Any amount in dispute must be notified within 14 days of invoice; undisputed portion payable on time

### 3.4 Floor and ceiling

- **Floor:** No minimum monthly commitment in Year 1. Parties may introduce one at renewal.
- **Ceiling:** Per-call rate will not exceed **AUD $0.05 per call** regardless of COGS changes, unless parties agree to revise.

### 3.5 Failed / errored calls

GoodSort is not charged for calls where Tailor returns an HTTP 5xx error, times out beyond the agreed SLA, or fails to return a valid classification object.

## 4. Service levels

### 4.1 Availability

- **Target uptime:** 99.5% measured monthly (excluding scheduled maintenance)
- **Scheduled maintenance:** Notified at least 48 hours in advance; outside business hours where possible

### 4.2 Latency

- **Target:** p95 response time under 3 seconds for classify calls
- **Fast-fail:** GoodSort may apply an 8-second timeout and fall back to its own Azure OpenAI path; calls that hit this timeout are not billable

### 4.3 Service credits

- If monthly uptime falls below 99%: 5% credit on next month's invoice
- If below 95%: 15% credit + right to terminate without penalty

## 5. Data

### 5.1 Data residency

All image data and processing occurs within **Australian Azure regions**.

### 5.2 Data ownership

- **Tailor owns:** the vision model, the classification output schema, any aggregate model improvements
- **GoodSort owns:** its own scan records, user data, and the product state built from API responses
- Neither party owns the other's brand or marks

### 5.3 Data retention

Tailor will:
- Retain submitted images for no more than **7 days** for diagnostic/training purposes, unless GoodSort opts into longer retention
- Process images in accordance with the Australian Privacy Principles
- Delete images on written request where technically feasible

### 5.4 Use of GoodSort data for model improvement

Tailor may use **de-identified, aggregated** image data and classification outcomes to improve its vision model. Tailor may **not** use GoodSort user data for any other purpose or share it with third parties without GoodSort's written consent.

## 6. CDS eligibility data

### 6.1 Tailor's responsibility

Tailor **warrants** that it will maintain and keep current the Container Deposit Scheme (CDS) eligibility ruleset for all Australian jurisdictions in which GoodSort operates, including but not limited to:

- Queensland Container Refund Scheme (Containers for Change)
- NSW Return and Earn
- SA Container Deposit Scheme
- Any future state / territory CDS programs

### 6.2 Update commitment

Tailor will update CDS rules within **30 days** of any published rule change by the scheme operator (e.g., inclusion of new container types, changes to size limits).

### 6.3 No override by GoodSort

GoodSort is entitled to rely on the `Cds.Eligible` flag returned by the API. GoodSort is not required to maintain or apply independent CDS rules downstream. If Tailor's CDS data is out of date, Tailor will remedy at its own cost within the 30-day update window.

## 7. Confidentiality

Standard mutual NDA. Each party treats the other's non-public business information as confidential. Survives termination for 3 years.

## 8. Liability

### 8.1 Cap

Each party's aggregate liability under this agreement is capped at **12 months of fees paid** in the 12 months preceding the claim.

### 8.2 Exclusions

No party is liable for indirect, consequential, or loss-of-profits damages, except in cases of gross negligence, wilful misconduct, or breach of confidentiality.

### 8.3 IP indemnity

Tailor indemnifies GoodSort against third-party claims that the Tailor Vision API infringes IP rights, provided GoodSort uses the API as intended.

## 9. Term and termination

### 9.1 Term

- **Initial term:** 12 months from signing
- **Renewal:** Auto-renew for 12-month periods unless either party gives 60 days' written notice
- **Termination for convenience:** Either party may terminate on 60 days' written notice after the initial term

### 9.2 Termination for cause

Either party may terminate immediately for:
- Material breach not cured within 30 days of notice
- Insolvency / liquidation of the other party
- Sustained SLA breach (below 95% uptime for 2 consecutive months)

### 9.3 Effect of termination

- GoodSort pays all outstanding fees up to termination date
- Tailor deletes GoodSort's submitted images within 30 days of termination
- Confidentiality obligations survive

## 10. Governing law

**Queensland, Australia.** Disputes to be resolved in QLD courts, with mediation as a first step.

## 11. Related party disclosure

If Tailor and GoodSort share any common shareholders or directors at signing or during the term, the arms-length nature of this agreement must be documented in both parties' board minutes. Pricing and terms benchmarked against market-rate SaaS vision API providers to demonstrate arms-length.

---

## Open questions for Knox / legal

1. **Tailor entity name + ABN** — need the exact legal entity for party identification
2. **Existing key provisioning** — what's the current commercial basis? Needs termination or transition clause
3. **Backup / fallback provider** — the codebase already has Azure OpenAI fallback. Contract should permit this; make explicit in Section 2.
4. **Insurance requirements** — should we require Tailor to carry professional indemnity and cyber cover? (Standard for SaaS)
5. **Subcontractors** — is Tailor using Azure OpenAI under the hood? If so, sub-processor disclosure required for Privacy Act / data processing agreement.
6. **Export / sanctions** — do we need any US/EU export control language if the data ever crosses borders?
