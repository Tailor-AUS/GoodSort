# Handoff: GoodSort Spin-out — Entity, Tailor Vision Agreement, Wylie Engagement

**Owner:** Knox Hart
**Status:** Pre-execution — needs corporate lawyer + Wylie sign-off
**Counterparties:** Wylie Thorpe (Lexaly Advisory), Tailor (existing IP holder), Crispr Projects Pty Ltd (current legal home of GoodSort)

## Context

GoodSort is currently developed and operated under Crispr Projects Pty Ltd (ABN 85 680 798 770). It dogfoods Tailor Vision (api.tailor.au) for container classification. We want to:

1. Spin GoodSort out into a standalone entity so it can fundraise, be partnered/sold, and limit liability.
2. Bring in Wylie Thorpe (founder of Lexaly Advisory) to **run** GoodSort — distinct from her existing fractional advisory engagement to Tailor.
3. Formalise the commercial relationship between Tailor (vision API supplier) and the new GoodSort entity, since they'll no longer be inside the same corporate group.

Sequencing matters: lock the entity structure first so there's a counterparty for the Tailor agreement and the Wylie engagement.

---

## Workstream 1 — New entity for GoodSort

**Recommended structure:** New Pty Ltd ("GoodSort Pty Ltd" or similar) with three founding shareholders:

- **Tailor** — equity in exchange for the IP/tech contribution + ongoing Vision API discount/credit
- **Lexaly / Wylie** — operational equity (see Workstream 3 for vesting)
- **Knox** — founder equity

### Decisions needed

- [ ] Equity split (suggest starting point: Knox 50%, Tailor 25%, Wylie/Lexaly 25%, with a 10–15% option pool carved out for future hires)
- [ ] Director composition (single director vs board)
- [ ] Vesting schedule (standard 4-year, 1-year cliff for Wylie; Tailor's stake fully vested at incorporation as IP consideration)
- [ ] ESIC eligibility (early stage innovation company concession — relevant for future investors)

### Asset transfer from Crispr Projects → GoodSort Pty Ltd

These need an IP assignment deed:

- **Codebase** — this repo (`Tailor-AUS/GoodSort`)
- **Brand** — "The Good Sort" trademark filings (check status with McBratney Law)
- **Domain** — `thegoodsort.org`
- **Counterparty contracts** — anything signed under Crispr (COEX application, council MoUs, depot agreements, ACS account, Azure subscription, Google Maps API key, etc.)
- **Data** — user records, scan history (privacy implications — needs a Privacy Act-compliant data transfer notice to existing users)

### What stays with Crispr Projects

- Anything not GoodSort-specific (other Crispr projects, generic infra)
- Tax/accounting history pre-spin-out

### Gotchas

- **Tailor Vision API key is currently provisioned to GoodSort under the existing relationship** — that key needs to be re-issued under the new entity name once the commercial agreement is signed
- **Azure subscription** — likely registered to Knox personally or Crispr; needs transfer or new subscription
- **GitHub org** — `Tailor-AUS` org currently houses the repo; either move repo to a new `goodsort` org or leave it under Tailor with an admin handoff to Wylie
- **Existing user data + consents** — privacy policy referenced Crispr; users need notice of the controller change

---

## Workstream 2 — Tailor Vision ↔ GoodSort commercial agreement

**Recommended structure:** Hybrid pricing — low per-classification rate + minority equity stake.

### Pricing

- **Per-call rate:** ~$0.03/call already documented in `docs/create-psp.js:188`. Suggest a tiered rate that drops at volume: $0.03 (0–10k/mo), $0.025 (10–50k/mo), $0.02 (50k+/mo).
- **Volume commit / floor:** Optional minimum monthly fee (e.g. $500/mo) to give Tailor predictable revenue.
- **Equity offset:** Tailor takes ~25% of GoodSort at incorporation as IP/tech consideration (see Workstream 1). This means Tailor is incentivised to make the Vision API succeed, and GoodSort isn't bleeding cash to its biggest cost line.

### Contract scope (boilerplate API/SaaS terms)

- [ ] Service description (vision/classify endpoint, SLA targets, uptime commitment)
- [ ] Pricing schedule + invoicing cadence (monthly in arrears)
- [ ] Data processing addendum (image data, retention, region — Australia)
- [ ] IP ownership (Tailor owns model + classification output schema; GoodSort owns its scan records)
- [ ] Term + termination (suggest 12 months auto-renew, 60-day exit notice)
- [ ] Liability cap (typical: 12 months of fees)
- [ ] **CDS data ownership clause** — make explicit that Tailor maintains CDS eligibility data (this is the bug we just hit with wine bottles — see github.com/Tailor-AUS/GoodSort/issues/1). Tailor warrants that CDS rules are kept current; GoodSort doesn't need to override downstream.

### Tradeoffs

- **Pure cash arrangement** — clean, but burns runway as scans scale (15k classifications/mo at $0.03 = $450/mo, manageable; at 1M/mo = $30k/mo, painful pre-revenue)
- **Pure equity offset** — Tailor over-indexed on GoodSort upside, may not invest in Vision API improvements that benefit GoodSort
- **Hybrid (recommended)** — Tailor gets cash floor + upside via equity; GoodSort gets discounted core dependency

### Decisions needed

- [ ] Final pricing tiers + equity %
- [ ] Whether Tailor's stake is voting or non-voting
- [ ] Right of first refusal clauses (if GoodSort sells, does Tailor have first option?)

---

## Workstream 3 — Wylie running GoodSort

Wylie's existing proposal (attached in user's earlier message) is **fractional commercial advisory**: $250/hr, up to 8hrs/mo, with the option to convert some/all into equity later. That proposal was scoped for **Tailor's** legal/regulatory expansion needs, not for operating GoodSort.

**This needs a separate engagement** with a different scope and structure.

### Two possible structures

**Option A — Founder/CEO with equity vesting**
- Title: CEO or Managing Director of GoodSort Pty Ltd
- Compensation: small cash stipend + significant equity (e.g. ~25%) vesting over 4 years with 1-year cliff
- Best fit if she's full-time-ish and treating this as a venture
- Needs founder agreement covering: IP assignment, non-compete, leaver provisions (good leaver / bad leaver), drag-along/tag-along

**Option B — Employment with options**
- Title: CEO
- Compensation: market salary (~$180–220k for early-stage CEO in Brisbane) + ESOP grant
- Best fit if cash is available and she wants employment certainty
- Needs ESOP plan established (Wylie's Lexaly background means she can probably set this up)

### Don't conflate hats

Wylie wears two hats post-spin-out:

| Engagement | Role | Counterparty | Scope |
|---|---|---|---|
| Existing Lexaly proposal | Fractional commercial advisor | **Tailor** | Legal/regulatory expansion (GDPR, AI regs, trademarks, etc.) |
| New GoodSort engagement | CEO/operator | **GoodSort Pty Ltd** | Run the business, fundraise, commercial deals |

Two contracts. Two invoicing arrangements. Different equity treatments.

### Decisions needed

- [ ] A or B structure?
- [ ] Equity grant size + vesting schedule
- [ ] Cash component (if any)
- [ ] Whether Wylie continues the Lexaly advisory work for Tailor in parallel (yes is fine — different counterparty, different hat)

---

## Recommended sequencing

```
Week 1–2:  Lock entity structure with corporate lawyer
            • Incorporate GoodSort Pty Ltd
            • Draft shareholders agreement (Knox + Tailor + Wylie/Lexaly)
            • IP assignment deed from Crispr → GoodSort

Week 2–3:  Negotiate Tailor ↔ GoodSort agreement
            • Both entities now exist as counterparties
            • Lock pricing tiers, equity %, CDS data ownership clause
            • New Tailor Vision API key issued to GoodSort entity

Week 3–4:  Formalise Wylie's CEO engagement
            • Pick A or B structure
            • Founder agreement OR employment contract + ESOP
            • Handover from Knox: GitHub admin, Azure, deploy access, contracts

Ongoing:    Asset migration
            • Domain, contracts, data — transfer one by one
            • User notice re: data controller change
            • Re-issue API keys (Google Maps, ACS) under new entity
```

## Key contacts

- **Wylie Thorpe** — Lexaly Advisory — wylie.thorpe@lexalyadvisory.com — +61 451 851 581
- **Bridget Goldsworthy** — copied on Lexaly proposal (presumed Tailor side)
- **McBratney Law** — existing trademark/IP counsel for Tailor (per Wylie's proposal)
- **Tailor Vision team** — owners of `api.tailor.au` (need contact for the agreement negotiation)

## Open questions for Knox

1. **Tailor side**: Who signs on Tailor's behalf? Is there a Tailor parent entity, or is "Tailor" itself a brand of another company?
2. **Crispr Projects**: What else lives in Crispr beyond GoodSort? Affects whether asset transfer is clean.
3. **COEX application**: Was it submitted under Crispr? If approved, does the licence transfer to the new entity, or does it need to be re-applied?
4. **User base**: Current scale (active users, MAU, monthly scans) — drives the pricing tier conversation with Tailor.
5. **Funding intent**: Are you raising in the next 6–12 months? If yes, the entity structure needs to be investor-ready (clean cap table, ESIC eligibility checked).

## Files / assets impacted

- `CLAUDE.md` — references Crispr Projects as legal entity; update post-spin-out
- `app/terms/page.tsx`, `app/privacy/page.tsx` — terms reference Crispr; update with new entity
- `docs/lawyer-brief.md` — existing legal brief, may need updating
- `docs/tailor-vision-response.md` — historical context on Tailor Vision integration
- `docs/coex-application-email.md` — COEX application content
- All GitHub Actions secrets — currently provisioned under Tailor-AUS org; may need re-issue
- Azure subscription — needs ownership review

## Next action

Engage a corporate lawyer (suggest Wylie coordinates via her McBratney network — that was in scope of her advisory proposal). Get them a copy of this handoff plus the Lexaly proposal. Target: shareholders agreement draft within 2 weeks.
