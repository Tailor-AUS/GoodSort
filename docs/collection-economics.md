# Collection Economics — Yellow Bin / 8-Stream Model

## The Revenue Split

```
CDS refund per container:           10¢
────────────────────────────────────────
  → Household (sorting credit):      5¢
  → Runner (collection credit):     ~3¢  (variable, from PricingService)
  → GoodSort (margin):              ~2¢
────────────────────────────────────────
  + Commodity value of material:   1-3¢  (GoodSort keeps — aluminium, PET, glass scrap)
```

## The New Model: Council-Day Street Sweeps

Every house on a street shares the same council bin day. The runner
does a single pass the night before, hitting every signed-up house.

**Key difference from old model:** There's no "50 container threshold."
Runs are generated automatically based on council collection day,
regardless of container count. The run ALWAYS happens (weekly cadence).
The question is: is the route profitable?

## Time Estimates (Yellow Bin Model)

| Activity | Time |
|----------|------|
| Drive to start of route | 5 min (assumes local runner) |
| Stop at house, open lid, extract containers | 30-60 sec per house |
| Drive between houses on same street | 15 sec |
| Drive between streets in same suburb | 2 min |
| Drive to recycler/depot | 10 min |
| Unload 8 sorted bags at recycler | 10 min |
| **TOTAL** | houses × 1min + streets × 2min + 25min |

**Critical insight:** Yellow bin extraction is MUCH faster than the old
model. No weighing, no counting, no bag swap. Open lid → grab cans/bottles
→ close lid → next house. Under 60 seconds per house.

## Scenario Analysis

### SCENARIO A: 20 houses on 2 streets (tight, early pilot)

```
Houses:       20 (10 per street)
Distance:     2km between streets + 5km to recycler = 7km total
Time:         20 houses × 1min + 2 streets × 2min + 25min = 49 min

Containers per house (avg): 15/week (conservative — a 2-person household
generates ~10-20 cans/bottles per week)

Total containers:  20 × 15 = 300

REVENUE:
  CDS refund:      300 × $0.10 = $30.00
  Commodity value:  300 × $0.02 = $6.00 (mostly aluminium)
  TOTAL:           $36.00

COSTS:
  Runner payout:   300 × $0.03 = $9.00
  Fuel:            7km × $0.21 = $1.47
  TOTAL COST:      $10.47

HOUSEHOLD PAYOUT: 300 × $0.05 = $15.00

GOODSORT PROFIT:  $36.00 - $10.47 - $15.00 = $10.53
RUNNER EARNS:     $9.00 for 49 min work = $11.02/hr

✅ PROFITABLE — runner earns above minimum wage, GoodSort nets $10+
```

### SCENARIO B: 50 houses across 5 streets (scaled suburb)

```
Houses:       50
Distance:     5km circuit + 5km to recycler = 10km
Time:         50 × 1min + 5 × 2min + 25min = 85 min (1h 25m)

Containers:   50 × 15 = 750

REVENUE:
  CDS refund:      750 × $0.10 = $75.00
  Commodity:       750 × $0.02 = $15.00
  TOTAL:           $90.00

COSTS:
  Runner payout:   750 × $0.03 = $22.50
  Fuel:            10km × $0.21 = $2.10
  TOTAL COST:      $24.60

HOUSEHOLD PAYOUT: 750 × $0.05 = $37.50

GOODSORT PROFIT:  $90.00 - $24.60 - $37.50 = $27.90
RUNNER EARNS:     $22.50 for 85 min = $15.88/hr

✅ VERY PROFITABLE — runner earns well, GoodSort nets ~$28/week/suburb
```

### SCENARIO C: 200 houses across Moorooka (full suburb)

```
Houses:       200
Distance:     15km circuit + 5km to recycler = 20km
Time:         200 × 1min + 15 streets × 2min + 25min = 255 min (4h 15m)
              → Split across 2 runners: 2h 8m each

Containers:   200 × 15 = 3,000

REVENUE:
  CDS:            3000 × $0.10 = $300
  Commodity:      3000 × $0.02 = $60
  TOTAL:          $360

COSTS:
  Runner payout:  3000 × $0.03 = $90 (split 2 runners = $45 each)
  Fuel:           20km × $0.21 = $4.20
  TOTAL COST:     $94.20

HOUSEHOLD PAYOUT: 3000 × $0.05 = $150

GOODSORT PROFIT:  $360 - $94.20 - $150 = $115.80/week = $502/month
RUNNER EARNS:     $45 each for ~2h = $22.50/hr

✅ STRONG — $6K/year from one suburb, runners earn $22+/hr
```

## Break-Even Thresholds

```
Minimum houses for a viable run (assuming 15 containers/house avg):

  Runner at $3/hr min:    needs 3 houses (45 containers, $1.35 payout)
  Runner at $15/hr:       needs 12 houses (180 containers, $5.40 payout)
  Runner at $25/hr:       needs 20 houses (300 containers, $9.00 payout)

Minimum containers per house for viability:
  At 20 houses/run:       needs 5/house (runner gets $3 = ~$4/hr for 45min)
  At 50 houses/run:       needs 3/house (runner gets $4.50 = ~$3/hr — too low)

CONCLUSION: 15 containers/house/week is conservative and works.
            Below 10/house the runner hourly rate drops below minimum wage.
            The 8-stream sorting doesn't change the economics — it just
            increases commodity value (pre-sorted = higher $/kg).
```

## Commodity Value of Pre-Sorted Material

| Material | $/kg (approx) | Weight per unit | Value per unit |
|----------|--------------|----------------|---------------|
| Aluminium cans | $1.50/kg | 15g | 2.3¢ |
| PET clear | $0.40/kg | 25g | 1.0¢ |
| PET coloured | $0.20/kg | 25g | 0.5¢ |
| Glass clear | $0.05/kg | 300g | 1.5¢ |
| Glass brown | $0.04/kg | 300g | 1.2¢ |
| Glass green | $0.03/kg | 300g | 0.9¢ |
| Steel | $0.30/kg | 50g | 1.5¢ |
| HDPE/LPB | $0.15/kg | 20g | 0.3¢ |

**Weighted average (typical Aussie household mix):** ~1.5-2¢ per container

This is pure profit for GoodSort on top of the CDS split — and it only
exists BECAUSE we do the 8-stream sort at kerbside.

## What Triggers a Run?

In the new model, runs are automatic — generated nightly by
`RunGenerationService` for every suburb where council pickup is tomorrow.

A run is generated when:
1. At least 1 household has `CouncilCollectionDay == tomorrow`
2. That household has `PendingContainers >= 1`
3. No active run already covers that household

The runner decides whether to claim the run based on the estimated payout
shown in the marketplace.

## Key Insights (Updated)

1. **Street density still matters** but the bar is lower. 10 houses on a
   street = viable. 3 houses spread across a suburb = marginal.

2. **Weekly cadence is guaranteed.** Unlike the old model where you waited
   for bins to fill, every house gets visited weekly (council day). This
   means predictable runner income and predictable household experience.

3. **Container count per house is the key variable.** 15/week is average.
   A house with 4 adults may do 30+. A single retiree might do 5. The
   8-stream bin might actually INCREASE containers because people who
   previously threw CDS items in the red bin (landfill) will now sort them.

4. **Runner hourly rate scales with density.** At 20 houses/run: ~$11/hr.
   At 50 houses/run: ~$16/hr. At 200 houses: ~$22/hr. This naturally
   attracts runners as the network grows.

5. **You are the runner initially.** At pilot scale (5-20 houses), the
   run generates $5-15 revenue. Not worth hiring a runner. You do it
   yourself, time cost = $0, break even at basically 1 house.
