# Handoff: GoodSort Tenant Admin Access on Tailor Platform

**From:** The Good Sort (GoodSort integration team)
**To:** Tailor Dev Team
**Date:** 12 April 2026
**Priority:** Blocking — cannot top up Vision API credits

---

## Problem

1. **goodsort.tailor.au loads the full Tailor app**, not a customer admin/billing dashboard. As GoodSort, we should see a simple admin panel: usage stats, credit balance, top-up, API key management. Instead we see the full Tailor document platform.

2. **No GoodSort user account exists.** When we log in at goodsort.tailor.au with `knox@tailor.au`, it logs us into the Tailor super-admin context — not the GoodSort org. The GoodSort customer email (`knox.hart@gmail.com`) has never been provisioned as a user on the GoodSort tenant.

3. **Cannot top up Vision API credits.** The Vision API is returning 500 (likely $0 balance / spend limit). We have no way to add credits because there's no billing UI accessible to us as a customer.

## What We Need

### 1. GoodSort org/tenant setup
- Create a GoodSort organization on the Tailor platform (if not already done)
- Link it to the Vision API key: `tailor_sk_mp83aI74SHwkgnD5gEn1SJsvun0Bj8VQ`
- Set a reasonable initial spend limit (e.g. $50)

### 2. Customer admin user
- Register `knox.hart@gmail.com` as an admin user on the GoodSort tenant
- This is the email used to log into thegoodsort.org — it should also be the email for the Tailor billing dashboard
- Alternatively, `knox@tailor.au` can be added, but it should resolve to the GoodSort org context, not the Tailor super-admin

### 3. goodsort.tailor.au should show a customer dashboard
For a Vision API customer, the dashboard should show:
- Current credit balance
- Usage (API calls, tokens, cost)
- Top-up / payment option
- API key management
- Invoices / billing history

Not the full Tailor document platform.

### 4. Initial credit top-up
- Top up GoodSort's balance with $50 so we can test the Vision API end-to-end
- Or use the admin endpoint: `POST /api/admin/organizations/{orgId}/top-up`
- We'll pay the first invoice via BAINK once it's issued

## Current State

| Component | Status |
|---|---|
| GoodSort API key | `tailor_sk_mp83aI74SHwkgnD5gEn1SJsvun0Bj8VQ` — issued and working (auth passes, gets 500 not 401) |
| Vision API `/api/vision/classify` | Returns 500 — likely spend limit / balance issue |
| GoodSort VisionService | Correctly calls Tailor Vision, falls back to Azure OpenAI on failure |
| goodsort.tailor.au | Loads full Tailor app, not customer admin |
| GoodSort user on Tailor | Not provisioned |

## Contact

Knox Hart
knox.hart@gmail.com (GoodSort customer email)
knox@tailor.au (Tailor admin email)
