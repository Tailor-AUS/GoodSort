# Response to Tailor Vision — The Good Sort Integration

**To:** Knox Hart, Tailor Intelligence  
**From:** The Good Sort (Crispr Projects Pty Ltd)  
**Date:** 10 April 2026  
**Re:** Tailor Vision API — Container Classification for CDS Recycling

---

Knox,

Thanks for the welcome pack — the API spec looks clean and the structured response format is exactly what we need. Much better than us managing our own prompt engineering. Having Tailor Vision own the container intelligence (material classification, CDS eligibility, barcode matching) while we focus on the user experience is the right split.

## Integration Status

We've already integrated the Tailor Vision API into our backend. The VisionService in our .NET API is wired to call `POST https://api.tailor.au/api/vision/classify` with the `X-Api-Key` header. We have an automatic fallback to our existing Azure OpenAI path until the key is provisioned and the endpoint is live.

**We're ready to go as soon as you issue the API key.**

## What You Asked For

### 1. Containers for Change Catalogue

We don't have a formal catalogue export, but here's what we know from building the local container database:

- **48 common Australian products** already in our local lookup (`lib/containers.ts`)
- Covers the major brands: Coca-Cola, Pepsi, Schweppes, Carlton, XXXX, Bundaberg, Mount Franklin, Cool Ridge
- Material breakdown: ~40% aluminium cans, ~30% PET bottles, ~20% glass, ~10% cartons/HDPE
- We also cross-reference Open Food Facts API for barcode lookups when our local DB doesn't match

Happy to export the full list as JSON if useful for your training data.

### 2. Sample Images

We'll send a batch of 50-100 photos from real user scans once we have a few pilot users active. For now, the types of images you'll see:

- **Kitchen bench photos**: 1-10 containers laid out, usually good lighting
- **Bag-in-bin photos**: looking down into a recycling bag, multiple containers overlapping
- **Single container close-ups**: user holding one item for quick identification
- **Mixed materials**: aluminium cans + PET bottles + glass in the same frame

Most photos will be taken on mobile (iPhone/Android rear camera, JPEG, typically 2-4MB). We strip to base64 before sending.

### 3. Current API Contract

Our existing request/response schema that the frontend expects:

**Our endpoint:** `POST /api/scan/photo`

**Our response to the frontend:**
```json
{
  "containers": [
    { "name": "Coca-Cola 375ml can", "material": "aluminium", "count": 3, "eligible": true },
    { "name": "Mount Franklin 600ml bottle", "material": "pet", "count": 2, "eligible": true }
  ],
  "totalItems": 5,
  "totalCents": 25,
  "summary": "5 containers found — $0.25 pending"
}
```

We handle the mapping from your response to ours on our side — your structured format makes this straightforward. The `classification.material` maps to our 4-bag sorting system (aluminium → Blue Bag, PET → Teal Bag, glass → Amber Bag, HDPE/cartons → Green Bag).

**One question:** Your API returns a single classification per call. Our users sometimes photograph 5-10 containers at once. Should we:
- (a) Send one photo and expect multiple classifications back (i.e., you detect all containers in frame)?
- (b) Send one photo per container (we'd need to change our UX)?
- (c) Something else you have planned?

Current Azure path returns multiple containers per image — we'd want to keep that behaviour.

## Billing

$200/month base + $0.01/image works for us. At pilot scale (~100 scans/day) that's ~$230/month. As we scale to 1,000+ scans/day across Queensland, we'd want to discuss volume pricing.

We'll pay via BAINK. Entity details for invoicing:

**Crispr Projects Pty Ltd**  
ABN 85 680 798 770  
Knox Hart, Director  
knox.hart@tailorco.au

## Next Steps

1. **You:** Issue the API key (`tailor_sk_...`) and confirm the endpoint is live
2. **Us:** Set `TAILOR_VISION_API_KEY` on our Container App and test end-to-end
3. **Together:** Benchmark accuracy on real container photos before pilot launch

Looking forward to being customer #1.

Knox Hart  
The Good Sort  
Crispr Projects Pty Ltd  
thegoodsort.org
