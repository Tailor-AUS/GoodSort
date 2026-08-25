# Collection Economics — Purple Bin / Density Model

A run is one **suburb + one recycling night** (the night before that suburb's
council day). Unlock is **12 residential households on the same day**.
City-wide totals never start collection. Runners collect **our purple bin**.
They do not open the council yellow bin.

Scan is optional. Household credit is runner count × 5¢
(`HouseholdCredit.CentsPerContainer`). Unscanned houses estimate 20
containers (`DefaultUnscannedEstimate`).

## The Revenue Split

```
CDS refund at a depot (we receive):  10¢
────────────────────────────────────────
  → Household (sorting credit):       5¢
  → Runner (marketplace rate):     3–5¢  (PricingService floor 3¢, base 5¢)
  → Good Sort (scheme margin):     0–2¢  before scrap
────────────────────────────────────────
  + Commodity value of material:   1–3¢  (we keep — aluminium, PET, glass)
```

Household credits are a private reward, not the scheme refund. Cash-out is
fail-closed until `ABA_PAYOUTS_ENABLED=true` and a real remitter is set.
Do not treat placeholder BSB `062-000` as live payouts.

## What Triggers a Run

`RunGenerationService` builds tonight's work from Brisbane time (UTC+10,
QLD has no DST):

1. Household is `delivered` or `collecting` (waitlisted / allocated never run)
2. Council day is **tomorrow**, or the purple bin is already out
3. Cluster key is **suburb + recycling night** — Friday Moorooka never
   mixes with Monday Annerley or a city-wide 3 km blob
4. Public drop bins still 3 km-cluster among themselves

The 12-house waitlist is the purchase gate. A run after delivery always
happens on that night if any serviceable house is due. Profitability is
why we wait for density before buying bins.

## Time Estimates (Purple Bin)

| Activity | Time |
|----------|------|
| Drive to start of route | 5 min (local runner) |
| Lift our purple bin, count, load | 45–60 sec per house |
| Drive between houses on the same street | 15 sec |
| Drive between streets in the same suburb | 2 min |
| Drive to depot / CRP | 10 min |
| Unload at depot | 10 min |
| **TOTAL** | houses × 1 min + streets × 2 min + 25 min |

No yellow-bin rummage. No lid-open extract. Divider stays in our bin.

## Unlock Run — 12 Houses, One Night

The first collecting run is the 12-house unlock. Use the unscanned
default (20 containers) until runners enter a count.

```
Houses:       12 on the same recycling day in one suburb
Distance:     ~4 km circuit + 5 km to depot = 9 km
Time:         12 × 1 min + 3 streets × 2 min + 25 min = 43 min

Containers:   12 × 20 = 240

SCHEME / SCRAP IN:
  CDS refund:      240 × $0.10 = $24.00
  Commodity:       240 × $0.02 = $4.80
  TOTAL IN:                    $28.80

OUT:
  Household credit: 240 × $0.05 = $12.00
  Runner (~3¢):     240 × $0.03 = $7.20
  Fuel:               9 km × $0.21 = $1.89
  TOTAL OUT:                    $21.09

GOOD SORT:   $28.80 − $21.09 = $7.71 / week for that night
RUNNER:      $7.20 for 43 min ≈ $10.00/hr
```

Viable as a first street. Below 12 we do not buy bins — a 3-house
scatter across Brisbane is not a run.

## Dense Suburb Night — 50 Houses, Same Day

```
Houses:       50 on the same recycling day
Distance:     8 km circuit + 5 km to depot = 13 km
Time:         50 × 1 min + 6 × 2 min + 25 min = 87 min

Containers:   50 × 20 = 1,000

IN:   CDS $100 + scrap ~$20 = $120
OUT:  Households $50 + runner $30 + fuel $2.73 = $82.73

GOOD SORT:   ~$37 / week
RUNNER:      $30 for 87 min ≈ $20.70/hr
```

Hourly rate scales with density. That is why invite-the-street is the
growth loop, not scan-every-can.

## What Does Not Pay

- **City-wide 12.** Four Moorooka + four Annerley + four West End never
  unlock. Travel between suburbs kills the hour.
- **Split days.** Twelve houses in one suburb on two days is two thin
  nights, not one run.
- **Yellow-bin rummage.** Time blows out; council bins are not ours.
- **Scan-gated credit.** Vision HTTP 402 must not zero a street. Runner
  count is the authority.

## Break-Even

At 20 containers/house and 3¢ runner:

| Houses on that night | Runner payout | Time | ≈ $/hr |
|----------------------|---------------|------|--------|
| 6 (do not unlock)    | $3.60         | 33 min | $6.50 |
| 12 (unlock)          | $7.20         | 43 min | $10.00 |
| 20                   | $12.00        | 53 min | $13.60 |
| 50                   | $30.00        | 87 min | $20.70 |

The waitlist threshold **is** the economics threshold: 12 houses on the
same recycling day. Early streets: Knox or a local runner does the night.
Do not hire against a 3-house map.

## Commodity (we keep)

| Material | $/kg (approx) | Weight per unit | Value per unit |
|----------|--------------|----------------|---------------|
| Aluminium cans | $1.50/kg | 15g | 2.3¢ |
| PET clear | $0.40/kg | 25g | 1.0¢ |
| Glass mixed | $0.04/kg | 300g | 1.2¢ |

Typical household mix ≈ 1.5–2¢ per container on top of the scheme split.
The divider is what makes that scrap grade possible — not an 8-stream
sort of the council yellow bin.

## Ops Invariants

1. Unlock = 12 residential households, same suburb, same council day.
2. Tonight = suburb + night before that day, purple bin only.
3. Household credit = runner count × 5¢. Scans do not double-pay.
4. ABA files stay closed until a real remitter is configured.
5. Do not claim COEX approval, live user counts, or city-wide collection.
