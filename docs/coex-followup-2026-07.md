# COEX Expansion follow-up — July 2026

**Status:** Ready to send via `POST /api/admin/outreach/send` (or ACS directly).  
**To:** expansion@coex.com.au  
**Cc:** knox@tailor.au  
**Reply-To:** knox@tailor.au  
**From:** hello@thegoodsort.org (preferred) or DoNotReply@thegoodsort.org until MailFrom is added  
**Subject:** Follow-up: The Good Sort — kerbside / bag-drop CRP (Brisbane South) + FY26–28 alignment

---

## Plain-text body (send this)

Hi Expansion Team,

I'm following up on my Expression of Interest sent **18 April 2026** from admin@thegoodsort.org regarding **The Good Sort** — a technology-enabled residential container collection service in **Moorooka / Brisbane South (QLD 4105)**, ABN 85 680 798 770 (Crispr Projects Pty Ltd).

I haven't seen a reply (our inbound mailbox on that domain had an access issue — please reply to **knox@tailor.au** going forward). If a response is already waiting, grateful if you could resend.

### Why I'm writing now

We've reviewed COEX's published FY26–28 direction and the QLD Government's CDS reform work for this financial year, and want to align our application with where the scheme is heading:

1. **FY26–28 Strategic Plan — Partner for Growth**  
   SEQ still has the densest population and the lowest recovery rates. COEX is prioritising smaller-format return channels and waste-sector partnerships so containers don't leave the kerbside stream unclaimed. That is exactly our model: intercept CDS-eligible containers from residential yellow bins the night before council collection, with zero behaviour change for householders.

2. **CRP types that fit us**  
   Your CRP application form now lists **Bag Drop / Drop Off** and **Mobile Pop Up** alongside depot / shopfront / RVM. Our operating model is closest to a **bag-drop / community collection** pattern (runners extract bagged containers from signed-up households on council night, deliver counted/sorted material to an approved depot such as Tomra Yeerongpilly or Salisbury). We'd welcome guidance on the right registration category before we lodge an open-market application.

3. **RVM Asset Hire Program (commercial, SEQ)**  
   As a new scheme participant with annual turnover under $2.5m, we appear eligible. We're interested in the **RVM X30** hire path (~$706/mo, 5.90¢ handling fee) as a complementary channel for apartment / mixed-use buildings under our B2B building subscription, not as a substitute for kerbside.

4. **Waste Reduction and Recycling (Strengthening the Container Refund Scheme) Amendment Bill 2026**  
   Introduced 26 March 2026; committee recommended passage (Report No. 24, 15 May 2026). Notably the Bill expands PRO functions to support environmental/community programmes and requires a published **network of container refund points plan**. We want to understand whether innovative kerbside recovery pilots (digital evidence chain + AI-verified counts) can be considered under those expanded functions or the surplus / investment plan once the Bill is in force.

### What we need from you (20-minute call)

1. Correct CRP category for kerbside pre-collection / bag-drop aggregation in Brisbane City.  
2. Handling fee schedule that would apply when we deliver pre-counted, stream-sorted containers to an existing SEQ depot (vs operating our own CRP).  
3. Whether our AI scan + household attribution trail can simplify depot verification.  
4. Eligibility confirmation for the commercial RVM hire program, and any current SEQ opportunity-map priority suburbs near Moorooka / Annerley / Yeronga / Tarragindi.  
5. Any pilot, innovation, or community-recovery support available this FY.

Live product: https://thegoodsort.org  
Happy to jump on a call this week or next — please suggest a time, or I'll hold **Tue/Wed 10:00–12:00 AEST**.

Thank you,

**Knox Hart**  
Founder, The Good Sort  
knox@tailor.au · thegoodsort.org  
Moorooka QLD 4105  
ABN 85 680 798 770

---

## HTML body (for ACS)

See `scripts/send-coex-followup.sh` — embeds the same content as HTML.

## Send commands

```bash
# After Azure login + admin JWT:
./scripts/send-coex-followup.sh

# Or via admin API directly:
curl -sS -X POST "$API_URL/api/admin/outreach/send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @docs/coex-followup-payload.json
```

## Policy notes (internal — do not paste into email)

| Item | Status (as of 2026-07-31) | Implication for GoodSort |
|------|---------------------------|--------------------------|
| COEX FY26–28 Strategic Plan | Partner for Growth = SEQ smaller formats + waste partnerships | Pitch kerbside interception as waste-sector partnership |
| RVM Asset Hire (commercial) | SEQ only; new ops <$2.5m turnover; X30 from $706/mo; 5.90¢/container | Capital-light building lobbies |
| CRP open-market applications | Rolling; no fee; bag-drop + mobile pop-up are named types | Apply once category confirmed |
| Amendment Bill 2026 | Introduced Mar 2026; committee recommended pass May 2026; 2nd reading pending | Governance/surplus plan may unlock pilot funding later — soft ask only |
| Refund amount increase | Inquiry rec #11 **not supported** by government | Stay at 10¢ economics |
| SEQ recovery | Lowest in state despite highest density | Strongest geographic fit |

**Important:** COEX is industry-funded (beverage manufacturers), not a government grants body. "Funding" = **handling fees + RVM hire (capex relief) + possible pilot under expanded PRO functions** — not a cash grant. Do not ask COEX for a grant in those words.
