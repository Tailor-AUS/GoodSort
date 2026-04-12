# Collection Economics — When To Collect

## The Formula

```
Run is profitable when:

  Total Containers × $0.05 (runner credit)
  >
  Total Distance (km) × $0.21 (fuel)
  +
  Total Time (min) / 60 × $30 (time value)
```

## Time Estimates

| Activity | Time |
|----------|------|
| Drive between bins (per km) | 2 min |
| Stop + collect bags (per bin) | 3 min |
| Drive to depot | varies |
| Process at depot | 15 min |
| TOTAL per run | bins × 3 + km × 2 + 15 min |

## Density Scenarios

### SCENARIO A: 10 bins on one street (tight cluster)
```
Distance:     3km circuit + 3km to depot = 6km total
Time:         10 bins × 3min + 6km × 2min + 15min = 57 min
Fuel cost:    6 × $0.21 = $1.26
Time cost:    57/60 × $30 = $28.50
TOTAL COST:   $29.76

Break even:   $29.76 / $0.05 = 596 containers
Per bin:      60 containers each

At 50/bin:    500 × $0.05 = $25.00 → LOSS of $4.76
At 80/bin:    800 × $0.05 = $40.00 → PROFIT of $10.24
At 100/bin:   1000 × $0.05 = $50.00 → PROFIT of $20.24
```

### SCENARIO B: 10 bins across 5km radius (suburban spread)
```
Distance:     15km circuit + 5km to depot = 20km total
Time:         10 bins × 3min + 20km × 2min + 15min = 85 min
Fuel cost:    20 × $0.21 = $4.20
Time cost:    85/60 × $30 = $42.50
TOTAL COST:   $46.70

Break even:   $46.70 / $0.05 = 934 containers
Per bin:      94 containers each
```

### SCENARIO C: 10 bins across Brisbane (city-wide)
```
Distance:     80km circuit + 10km to depot = 90km total
Time:         10 bins × 3min + 90km × 2min + 15min = 225 min (3.75 hrs)
Fuel cost:    90 × $0.21 = $18.90
Time cost:    225/60 × $30 = $112.50
TOTAL COST:   $131.40

Break even:   $131.40 / $0.05 = 2,628 containers
Per bin:      263 containers each
→ NOT VIABLE at residential volumes
```

### SCENARIO D: 5 bins on YOUR street (Moorooka pilot)
```
Distance:     1km circuit + 3km to depot (Yeerongpilly) = 4km total
Time:         5 bins × 3min + 4km × 2min + 15min = 38 min
Fuel cost:    4 × $0.21 = $0.84
Time cost:    38/60 × $30 = $19.00
TOTAL COST:   $19.84

Break even:   $19.84 / $0.05 = 397 containers
Per bin:      80 containers each

But if YOU are the runner (time cost = $0):
Break even:   $0.84 / $0.05 = 17 containers total
Per bin:      4 containers each ← ALWAYS PROFITABLE
```

## The Runner Marketplace Model

The app shows bins tagged as "ready for collection" on the runner map.
Each bin shows:
- Location (address + map pin)
- Estimated containers
- Estimated payout (containers × 5c)

The runner selects which bins to collect. The app calculates:
- Total route distance (Google Directions API)
- Estimated time
- Total payout
- Estimated profit after fuel

The runner decides if the run is worth it. Market price discovery.

## Key Insights

1. **Density is everything.** 10 bins in 1km = profitable at 60/bin. 10 bins in 80km = never profitable.

2. **Focus on streets, not suburbs.** One street with 10 houses > 10 houses across 10 suburbs.

3. **The pilot (Moorooka):** 5 bins within 1km of your house, 3km from Yeerongpilly depot. Break even at 17 containers total if you're the runner. Profitable from day 1.

4. **You are the runner initially.** Time cost = $0 (you're doing this anyway). Only fuel matters. That means 4 containers per bin is break-even.

5. **When you hire a runner:** They need 60+ per bin in a tight cluster, or 100+ in a spread-out area. The app should only show bins to runners when there's a viable route.

## Threshold Formula for "Ready for Collection"

```
bin.status = "ready" when:
  bin.containers >= MINIMUM_VIABLE_CONTAINERS

MINIMUM_VIABLE_CONTAINERS = ceil(
  (estimated_fuel_to_nearest_depot / $0.05) / estimated_nearby_bins
)

Where:
  estimated_fuel = distance_to_depot × 2 × $0.21 (round trip)
  estimated_nearby_bins = bins within 3km radius with containers > 0
```

Simplified for pilot: **Set ready threshold at 50 containers per bin.**
Below 50 = "filling". Above 50 = "ready for collection".
Runners only see "ready" bins on their map.
```

