# Asset Inventory — Crispr Projects → GoodSort Pty Ltd

**Purpose:** Enumerate everything currently tied to Crispr Projects Pty Ltd (ABN 85 680 798 770) that needs to transfer to, be re-issued to, or be licensed into GoodSort Pty Ltd.

**Prepared for:** Corporate lawyer handling the spin-out + IP assignment deed.

**Status:** Draft for Knox review before sharing with lawyer.

---

## 1. Intellectual property

| Asset | Current owner | Transfer path | Notes |
|---|---|---|---|
| Source code (this repo) | Crispr Projects | Assign to GoodSort | Repo at `github.com/Tailor-AUS/GoodSort`; includes frontend, backend, infra, docs |
| "The Good Sort" word trademark | Crispr Projects (via McBratney Law) | Assign to GoodSort | Check filing status; priority date matters for international filings |
| "The Good Sort" logo trademark | Crispr Projects (via McBratney Law) | Assign to GoodSort | Same as above |
| Product designs, UX, brand guidelines | Crispr Projects | Assign to GoodSort | Implicit in codebase and marketing assets |
| Vision prompts / CDS rules (if any custom) | Crispr Projects | Assign to GoodSort | Currently lean on Tailor Vision, so minimal |

## 2. Domains

| Domain | Registrar | Current owner | Transfer path |
|---|---|---|---|
| `thegoodsort.org` | TBC — likely GoDaddy or similar | Crispr / Knox | Transfer to GoodSort |
| `thegoodsort.com.au` (if held) | TBC | TBC | Check if registered; secure if not |
| `thegoodsort.com` (if held) | TBC | TBC | Check if registered; secure if not |

## 3. Cloud infrastructure (Azure)

| Resource | Identifier | Current subscription owner | Transfer path |
|---|---|---|---|
| Azure subscription | TBC | Knox personal or Crispr | New GoodSort subscription OR transfer billing ownership |
| Static Web App | `kind-mushroom-0fe89a200` | Current subscription | Move between subscriptions |
| Container App (backend API) | `api.livelyfield-64227152.eastasia.azurecontainerapps.io` | Current subscription | Move between subscriptions |
| Azure SQL (DB) | `goodsortdb` | Current subscription | Move; consider backup/restore to new region |
| Azure OpenAI | `AZURE_OPENAI_ENDPOINT` | Current subscription | Re-provision under new subscription |
| Azure Communication Services | `ACS_CONNECTION_STRING`, sender `thegoodsort.org` domain | Current subscription | Move; domain verification needs to be re-done on new tenant |
| Azure Container Apps Environment | `AZURE_CONTAINER_APP_ENV` | Current subscription | Move with container app |

## 4. Third-party API keys

| Service | Used for | Current account holder | Action |
|---|---|---|---|
| Google Maps Platform | Places Autocomplete, Geocoding, Maps JS, Routes | Crispr / Knox | Create new key on GoodSort Google Cloud project; update `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` secret |
| Tailor Vision API | Container classification | Crispr → re-issued under new commercial agreement | Re-issue key post-agreement; update `TAILOR_VISION_API_KEY` secret |
| Open Food Facts | Barcode lookups | Public, no key needed | No action |
| Azure Communication Services | Transactional email (OTP) | Inside Azure sub (see section 3) | Covered by Azure transfer |

## 5. GitHub

| Item | Current location | Transfer path |
|---|---|---|
| Repo | `github.com/Tailor-AUS/GoodSort` | Transfer to new `GoodSort` org OR keep under Tailor-AUS with admin handoff to Wylie |
| Repo secrets | Under Tailor-AUS org | Re-create in new org if moved |
| GitHub Actions workflows | `.github/workflows/` | No action — YAML moves with repo |
| Team permissions | TBC | Wylie + David + Knox + Bridget get admin/write as appropriate |

### GitHub secrets currently in use

- `AZURE_CREDENTIALS` — service principal JSON
- `AZURE_RESOURCE_GROUP` — resource group name
- `AZURE_CONTAINER_APP_NAME` — container app name
- `AZURE_CONTAINER_APP_ENV` — container app environment name
- `AZURE_STATIC_WEB_APPS_API_TOKEN_KIND_MUSHROOM_0FE89A200` — SWA deploy token
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — Maps API key

All need re-creation on new subscription/org or re-issued with GoodSort identity.

## 6. Counterparty contracts & applications

| Counterparty | Artifact | Current entity | Action |
|---|---|---|---|
| COEX (QLD CDS scheme operator) | PSP application (`docs/PSP-Application-GoodSort.docx`) | Crispr Projects | Check submission status; may need re-application under GoodSort OR amendment to transfer |
| BCC, Logan, Redlands, Moreton Bay, Gold Coast councils | Any MoUs / pilot agreements | TBC — check `docs/` | Novation or re-sign under GoodSort |
| TOMRA / depot operators | Depot dropoff arrangements (`docs/tomra-depot-email.md`) | Crispr Projects | Novate |
| Recycler partners | Outreach in progress (`docs/recycler-outreach-emails.md`) | Crispr Projects | Update entity on outstanding proposals |
| Divider supplier (RFQ) | RFQ (`docs/divider-rfq-email.md`) | Crispr Projects | Update entity if RFQ still live |
| Tailor Vision | Informal dogfooding arrangement | Crispr Projects | Formalise as arms-length SaaS agreement (see Workstream 2) |
| Stripe / payment processor (if any) | TBC | TBC | Check; new GoodSort merchant account |
| ABA banking / cashout | Payout bank file processing | Crispr Projects | New GoodSort business bank account; update ABA user details |

## 7. User data

| Data | Volume | Current controller | Transfer path |
|---|---|---|---|
| User profiles | TBC — query DB | Crispr Projects | GoodSort becomes new controller |
| Scan history | TBC — query DB | Crispr Projects | Transfer with DB |
| OTP codes (transient) | Transient | Crispr Projects | Move with DB |
| Vision call logs | TBC | Crispr Projects | Move with DB |
| Cashout requests + bank details | TBC | Crispr Projects | Move with DB — sensitive; ensure encryption + access control on new tenant |
| Household addresses + geolocation | TBC | Crispr Projects | Move with DB |

**Privacy implications:** Data controller change requires notice to users under the Australian Privacy Act. Draft notice is a separate deliverable.

## 8. Physical assets

| Asset | Location | Owner | Action |
|---|---|---|---|
| Good Sort bins (deployed) | Per `docs/*` — QLD locations | Crispr Projects (per current terms page) | Assign ownership to GoodSort via IP/assets deed |
| Bin inventory (undeployed) | TBC | Crispr Projects | Same |
| Bag stock (4-bag sorting system) | TBC | Crispr Projects | Same |

## 9. Legal / operational

| Item | Current | Action |
|---|---|---|
| Business name registration | "The Good Sort" trading under Crispr | Register as GoodSort Pty Ltd trading name OR register "The Good Sort" business name under GoodSort |
| Insurance (public liability, cyber, product) | Unknown — likely Crispr's general policy | GoodSort needs its own cover (Wylie's Lexaly proposal flags this) |
| Privacy Policy | Identifies Crispr as controller (`app/privacy/page.tsx`) | Update post-transfer |
| Terms of Service | Identifies Crispr as operator (`app/terms/page.tsx`) | Update post-transfer |
| Bank account | TBC — likely Crispr business account | New GoodSort account; direct debit / cashout needs re-linking |
| ATO / tax registration | Crispr ABN | New GoodSort ABN, GST registration, etc. |

## 10. Files in this repo that reference Crispr

These will need updating on spin-out day (captured separately in the terms/privacy audit):

- `CLAUDE.md` — line 147
- `app/privacy/page.tsx` — line 49
- `app/terms/page.tsx` — lines 10, 82, 114
- `docs/create-psp.js` — lines 49, 58, 201, 255 (PSP application generator)
- `docs/lawyer-brief.md` — lines 5, 49
- `docs/coex-application-email.md` — line 41
- `docs/tomra-depot-email.md` — line 32
- `docs/tailor-vision-response.md` — lines 4, 78–79, 93
- `docs/recycler-outreach-emails.md` — lines 66, 110, 137
- `docs/divider-rfq-email.md` — line 49

---

## Items that need Knox to confirm before lawyer engagement

1. Domain registrars (who holds `thegoodsort.org` — GoDaddy? which account?)
2. Azure subscription owner (Knox personal vs Crispr business account)
3. Current Google Cloud project owner for the Maps API key
4. Current state of COEX application (submitted? approved? pending?)
5. Any council MoUs or pilot agreements signed — under what entity?
6. Bank account status — does Crispr have a dedicated GoodSort sub-account, or mixed with other Crispr activity?
7. Insurance — does Crispr hold any policies covering GoodSort's activity, or is there nothing in place?
