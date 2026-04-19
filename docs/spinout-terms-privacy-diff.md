# Terms & Privacy Page Audit — Prepared Diff

**Status:** DO NOT APPLY yet. Apply on incorporation day once GoodSort Pty Ltd has its ABN.
**Purpose:** Every Crispr Projects reference in the user-facing legal pages, with the exact replacement ready to go.

---

## Placeholders (fill in on incorporation day)

- `GOODSORT_ABN` — GoodSort Pty Ltd's registered ABN (TBD at ASIC filing)
- `GOODSORT_ACN` — GoodSort Pty Ltd's ACN
- `GOODSORT_ADDRESS` — Registered office address (likely Wylie's or a serviced address, not Moorooka)

---

## File 1: `app/terms/page.tsx`

### Change 1 — Line 10 (Section 1, Service Description)

**Before:**
```tsx
          Crispr Projects Pty Ltd (ABN 85 680 798 770), trading as The Good Sort (&quot;The Good Sort&quot;, &quot;we&quot;, &quot;us&quot;) operates a container
```

**After:**
```tsx
          GoodSort Pty Ltd (ABN GOODSORT_ABN), trading as The Good Sort (&quot;The Good Sort&quot;, &quot;we&quot;, &quot;us&quot;) operates a container
```

### Change 2 — Line 82 (Section 9, Bins and Property)

**Before:**
```tsx
          Good Sort Bins remain the property of Crispr Projects Pty Ltd (ABN 85 680 798 770), trading as The Good Sort. Bins are placed at locations
```

**After:**
```tsx
          Good Sort Bins remain the property of GoodSort Pty Ltd (ABN GOODSORT_ABN), trading as The Good Sort. Bins are placed at locations
```

### Change 3 — Line 114 (Section 13, Contact)

**Before:**
```tsx
          For questions about these terms, contact us at legal@thegoodsort.org or write to:
          Crispr Projects Pty Ltd (ABN 85 680 798 770), trading as The Good Sort, Moorooka QLD 4105, Australia.
```

**After:**
```tsx
          For questions about these terms, contact us at legal@thegoodsort.org or write to:
          GoodSort Pty Ltd (ABN GOODSORT_ABN), GOODSORT_ADDRESS.
```

### Change 4 — Line 6 (updated date)

**Before:**
```tsx
        <p className="text-slate-500 text-sm mb-6">Last updated: April 2026</p>
```

**After (update to actual incorporation month):**
```tsx
        <p className="text-slate-500 text-sm mb-6">Last updated: [INCORPORATION MONTH] 2026</p>
```

### Additional section to ADD — before Section 11 (Changes to Terms)

Insert a new section noting the entity change and continuity of service:

```tsx
        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">11. Transition of Service Provider</h2>
        <p className="text-slate-600 text-sm mb-4">
          Effective [DATE], the operator of The Good Sort transitioned from Crispr Projects Pty Ltd
          (ABN 85 680 798 770) to GoodSort Pty Ltd (ABN GOODSORT_ABN). All user accounts, balances,
          and scan history transferred under the continuity of service. If you do not consent to
          the new operator, you may cash out your cleared balance and close your account.
        </p>
```

(Renumber subsequent sections 12, 13, 14 accordingly.)

---

## File 2: `app/privacy/page.tsx`

### Change 1 — Line 49 (Section 6, Contact)

**Before:**
```tsx
          For privacy inquiries, contact us at privacy@thegoodsort.org or write to:
          Crispr Projects Pty Ltd (ABN 85 680 798 770), trading as The Good Sort, Moorooka QLD 4105, Australia.
```

**After:**
```tsx
          For privacy inquiries, contact us at privacy@thegoodsort.org or write to:
          GoodSort Pty Ltd (ABN GOODSORT_ABN), GOODSORT_ADDRESS.
```

### Change 2 — Line 6 (updated date)

**Before:**
```tsx
        <p className="text-slate-500 text-sm mb-6">Last updated: April 2026</p>
```

**After:**
```tsx
        <p className="text-slate-500 text-sm mb-6">Last updated: [INCORPORATION MONTH] 2026</p>
```

### Additional section to ADD — before Section 1

Insert a new section noting the controller change and prior controller:

```tsx
        <h2 className="text-lg font-display font-bold text-slate-900 mt-8 mb-3">About the Data Controller</h2>
        <p className="text-slate-600 text-sm mb-4">
          GoodSort Pty Ltd (ABN GOODSORT_ABN) is the data controller for The Good Sort. Effective
          [DATE], personal information previously held by Crispr Projects Pty Ltd (ABN 85 680 798 770)
          as controller was transferred to GoodSort Pty Ltd under continuity of service. Users were
          notified of this change via email on [DATE]. For questions about information held prior
          to the transition, contact privacy@thegoodsort.org.
        </p>
```

(Renumber subsequent sections accordingly.)

---

## File 3: `CLAUDE.md` (line 147)

**Before:**
```markdown
- **Legal entity**: Crispr Projects Pty Ltd (ABN 85 680 798 770)
```

**After:**
```markdown
- **Legal entity**: GoodSort Pty Ltd (ABN GOODSORT_ABN)
```

---

## Files that also reference Crispr but are NOT user-facing

Update these on the same day for consistency, but they don't carry legal weight:

| File | Lines | Action |
|---|---|---|
| `docs/create-psp.js` | 49, 58, 201, 255 | Update PSP application template (will need re-submission anyway) |
| `docs/lawyer-brief.md` | 5, 49 | Update historical brief (or mark as superseded) |
| `docs/coex-application-email.md` | 41 | Update — may require re-application to COEX under GoodSort |
| `docs/tomra-depot-email.md` | 32 | Update if still in negotiation |
| `docs/tailor-vision-response.md` | 4, 78–79, 93 | Update — historical but references current entity |
| `docs/recycler-outreach-emails.md` | 66, 110, 137 | Update — outreach in progress |
| `docs/divider-rfq-email.md` | 49 | Update if RFQ still live |

## Files that stay with Crispr (no change needed)

- Any historical records of Crispr's operation of the service pre-transition
- Any docs that explicitly describe the transition itself (this one, for example)

---

## Application order (on incorporation day)

1. Verify ABN and registered address are final
2. Fill in `GOODSORT_ABN`, `GOODSORT_ACN`, `GOODSORT_ADDRESS` throughout this doc
3. Apply changes to `app/terms/page.tsx` and `app/privacy/page.tsx`
4. Update `CLAUDE.md`
5. Update docs in the secondary list
6. Update the "Last updated" date to match the incorporation date
7. Run `npx tsc --noEmit` to confirm no TS errors
8. Commit with message like: "Transition service provider to GoodSort Pty Ltd"
9. Deploy (via `/deploy-prod`) so users hit updated terms on next page load
10. Send user notice email in parallel (see `spinout-user-notice.md`)
