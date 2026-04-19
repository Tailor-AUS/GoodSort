# User Notice — Data Controller Change (Privacy Act compliance)

**Status:** Draft for lawyer review before sending.
**Purpose:** Meet notification obligations under the Australian Privacy Act when the data controller for The Good Sort changes from Crispr Projects Pty Ltd to GoodSort Pty Ltd.
**Channel:** Email to all registered users, via Azure Communication Services. Also displayed as an in-app banner for 30 days post-transition.
**Send date:** Same day as incorporation / asset transfer completes.

---

## Email

**Subject:** Important update: The Good Sort is becoming GoodSort Pty Ltd

Hi [name],

This is a quick but important update about The Good Sort.

## What's changing

From **[DATE]**, The Good Sort will be operated by a new company, **GoodSort Pty Ltd** (ABN [GOODSORT_ABN]).

The service was previously operated by **Crispr Projects Pty Ltd** (ABN 85 680 798 770). As part of the transition, your account, balance, and scan history have been transferred to GoodSort Pty Ltd.

## What stays the same

- **The app and website** (`thegoodsort.org`) — no change
- **Your login** — same email, no action needed
- **Your balance** — transferred in full (both pending and cleared credits)
- **Your scan history** — transferred in full
- **How the service works** — bins, scans, cash-outs, runners — all unchanged
- **Our commitment to privacy** — still stored in Australia, still governed by Australian law, still no sale to third parties

## What you should know

**Your personal information** (email, name, address, scan records, location data) has been transferred from Crispr Projects Pty Ltd to GoodSort Pty Ltd as the new data controller. The handling of your data will continue under the same Privacy Policy, with GoodSort Pty Ltd now standing in place of Crispr Projects Pty Ltd.

**Your rights under the Privacy Act 1988** are unchanged. You can still access, correct, or delete your personal information at any time by contacting privacy@thegoodsort.org.

## Why we're doing this

GoodSort has grown beyond its original home inside a broader tech company. Setting up its own entity lets us bring on partners, scale the service, and focus entirely on making container recycling easier for Queensland households. Same team, same product, dedicated company.

## Your options

- **Continue using the service** — no action needed. Your next visit to the app will update you to the new Terms and Privacy Policy, which reflect the new operator but are otherwise the same.
- **Cash out and leave** — if you'd prefer not to continue under the new operator, you can cash out your cleared balance ($20 minimum) and close your account. Email privacy@thegoodsort.org and we'll help you through it.
- **Delete your account** — you can delete your account and all associated data at any time via Settings → Delete Account in the app.

## Questions

- **Privacy / data questions:** privacy@thegoodsort.org
- **Legal / terms questions:** legal@thegoodsort.org
- **General:** hello@thegoodsort.org

Thanks for being part of The Good Sort — whether you've scanned 3 cans or 300, every container makes a difference.

The Good Sort team

---

GoodSort Pty Ltd (ABN [GOODSORT_ABN])
[GOODSORT_ADDRESS]
[thegoodsort.org](https://thegoodsort.org)

---

## In-app banner (display for 30 days post-transition)

```
The Good Sort is now operated by GoodSort Pty Ltd (previously Crispr
Projects Pty Ltd). Your account, balance, and data have transferred
across. [Learn more] [Dismiss]
```

"Learn more" links to a dedicated page at `/transition` with the full email text + FAQ.

---

## FAQ page content (at `/transition`)

### Why did the operator change?

GoodSort has been incubated inside Crispr Projects Pty Ltd, a broader tech company. To bring on co-founders, partners, and eventually investors, it made sense to move the product into its own dedicated company. Crispr Projects Pty Ltd transferred all GoodSort assets — including user accounts and data — to GoodSort Pty Ltd.

### Did you sell my data?

No. This is a corporate restructure, not a sale to an unrelated third party. The same people are running the service. Your data moved from one company (Crispr) to another (GoodSort) as part of the transition. GoodSort Pty Ltd is bound by the same Privacy Policy that applied before.

### Is my balance safe?

Yes. Every cent of your pending and cleared balance transferred to GoodSort Pty Ltd. Your cash-out options are unchanged.

### Did my scan history transfer?

Yes. Your full scan history is available in the app as before.

### Is the app different?

No. Same URL (`thegoodsort.org`), same login, same features. The only visible change is the company name in the Terms of Service and Privacy Policy.

### Will my cash-out bank details transfer?

Yes. Bank details you provided previously are retained. You may want to review them in Settings → Cashout to confirm they're current.

### I don't want to continue under the new operator. What do I do?

Contact privacy@thegoodsort.org and we'll help you cash out your cleared balance and close your account. You can also delete your account directly in the app via Settings → Delete Account.

### What about my existing consents?

All consents you gave previously (to Crispr Projects Pty Ltd) carry over to GoodSort Pty Ltd. If you'd like to withdraw any consent, you can do so in the app or by emailing privacy@thegoodsort.org.

### Who owns the data now?

GoodSort Pty Ltd is the new data controller. Crispr Projects Pty Ltd no longer holds active user data as of [DATE].

### Where is my data stored?

Still in Australia (Azure East Asia / Australia regions). No change to storage location.

---

## Internal notes (don't include in actual email/page)

- **Send timing:** Email + in-app banner go live the same day the IP assignment deed is executed. NOT before.
- **Privacy Act Notifiable Data Breach (NDB) scheme:** This is NOT a data breach, but Privacy Act APP 5 requires notification of purpose / controller changes. This email satisfies that.
- **Opt-out handling:** Set up a simple form at `/transition/opt-out` for users who want to cash out and close; queue those for manual handling.
- **Legal review:** MUST be reviewed by the corporate lawyer before sending. Don't send without sign-off.
- **Tone:** Warm, clear, practical. Avoid legalese in the email; keep it in the T&Cs. Users who want detail can click to the FAQ.
- **Record keeping:** Keep a copy of the email, the list of recipients, and the send date on file for 7 years (Privacy Act recordkeeping).
