# Collection Economics — Scan-first suburb run

Working model: **scan a container, earn 5¢**. When a suburb (start
**Moorooka**) has enough volume to cover a single driver trip (~$50
Uber-scale), call the run: bags/bin on the kerb, one trip **into the
scheme path** (existing refund point / processor). Purple bins later.
Unlock is a **container count**, not 12 houses on a recycling night.

## What the scheme actually pays (do not invent 25¢)

Containers for Change is a not-for-profit PRO ([COEX help](https://www.containersforchange.com.au/qld/help?category=17)).
Beverage manufacturers fund it.

| Line | Amount | Source |
|------|--------|--------|
| Supplier levy (Aluminium, through 31 Jan 2027) | **12.8¢** excl GST per container sold in QLD | [COEX manufacturer hub](https://containerexchange.com.au/beverage-manufacturer-hub/) |
| Weighted average levy (all materials) | ~**13.3¢** | Same hub |
| Consumer / presenter refund | **10¢** at an approved refund point | Public scheme rule |
| CRP handling (SEQ, Apr 2026) | community RVM hire **3.12¢**; commercial RVM **5.9¢**; shopfront depot **6.5¢**; higher sort/process **7.68¢** | [SEQ rate card PDF](https://containerexchange.com.au/wp-content/uploads/2026/04/COEX_AssetHire_SEQ-Rate-Card_ALL_CMYK.pdf) |
| Scrap (aluminium can ~13–15 g) | ~**2–3¢/can** at ~$1.50–2.00/kg | Commodity; whoever **keeps the metal** |

The ~13¢ levy is **10¢ refund + network** (CRP handling, logistics,
processors, COEX). Leftover on aluminium is ~**2.8¢**, not 15¢ of
secret profit. “Free bins everywhere” are mostly **COEX-owned RVMs**;
hosts earn handling, not 25¢.

## Product split (Knox)

- Household **5¢** — private sorting credit (half of 10¢ because they will
  not drive to a depot). Not the scheme refund.
- Driver **5¢/container** *or* a flat **$50** trip.
- TGS keeps **scrap** only when we keep the material (Path B).

Cash-out stays fail-closed until a real remitter is configured. Do not
treat placeholder ABA details as live payouts. Do not claim we are a CRP
until Knox / COEX say so.

## Path A — customer at someone else’s CRP (today)

We present containers at an existing refund point as a **customer**.

```
IN:   10¢  (scheme refund)
OUT:  5¢   (household) + 5¢ (driver)   OR   5¢ (household) + $50 (trip)
SCRAP: $0  (CRP keeps the metal)
HANDLING: $0  (COEX pays the CRP, not us)
```

- Driver at **5¢/can:** TGS = **$0** at every `N`.
- Driver at **$50/trip:** TGS = `N × $0.05 − $50`. Break-even at
  **1,000 containers** (`$50 / $0.05`). Below that the trip loses money.
- This path does **not** fund the business beyond covering the trip.

## Path B — we are the CRP / we sell to a processor (target)

Honest “recycler” cash-flow once registered and we keep material:

```
IN:   10¢ refund + ~5.9¢ commercial handling + ~2.3¢ scrap ≈ 18.2¢
OUT:  5¢ household + 5¢ driver = 10¢
TGS:  ≈ 8.2¢ / can before GST / true-up
```

At **1,000 cans:** ~$82 TGS, $50 household, $50 driver.
At **$50 flat Uber** instead of 5¢ driver: break-even on Uber + household
is roughly **~700 cans** if we still get 10¢ + scrap; **~400 cans** if we
also get ~5.9¢ handling.

Do not use Path B numbers in public copy until we are a CRP.

## Run threshold (product constant)

Default unlock: **1,000 eligible containers in one suburb** (Moorooka
first). That is Path A break-even when the trip is $50 and the household
keeps 5¢. Path B would allow a lower constant — tune only after CRP
status is real.

- Cluster key: **suburb only** (not suburb + Friday).
- City-wide totals never unlock.
- Waitlisted houses **can scan**; their pending containers count toward `N`.
- Material does not change the 10¢. Aluminium-only math is for scrap
  stories under Path B, not the unlock constant.

## Ops invariants

1. Unlock = suburb container volume ≥ `WaitlistDensity.LiveThreshold` (1000).
2. Household credit = 5¢ per eligible container (scan pending; runner count settles).
3. ABA files stay closed until a real remitter is configured.
4. Do not claim COEX approval, live user counts, city-wide collection, or 25¢ margin.
