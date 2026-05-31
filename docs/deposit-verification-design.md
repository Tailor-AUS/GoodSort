# Unattended deposit verification — design note

**Problem.** We want to place GoodSort bins anywhere (cafés, kerbs, public
spots), let a member deposit a container unattended, and credit them 5¢ — without
a runner present, and without someone farming credit they didn't earn.

**The question that prompted this:** *is there anything unique to a bottle we can
later scan to verify it's in the bin?*

## Short answer: no — not on today's containers

A beverage barcode (EAN-13 / GS1) is a **product (SKU) identifier, not a unit
identifier.** Every Coca-Cola 375ml can shares the same barcode
(`9300675024457`). Scanning it proves *a* Coke can exists — never *this specific
can, deposited once.* There is nothing else intrinsic, durable and
machine-readable-by-phone that is unique per unit:

- Barcode → product, not unit.
- Cap / ring / fill line / embossing → identical across units.
- Manufacturing micro-defects (dents, label skew) → not reliably readable by a
  phone camera, and trivially defeated.

This is exactly why **Digital Deposit Return Schemes (DDRS)** worldwide are
moving to **serialised 2D codes** — a unique DataMatrix/QR printed *per unit* and
activated at point of sale, so each deposit maps to one container and can be
redeemed once. But that requires the **beverage producer** to print the codes at
the line. We cannot unilaterally serialise other people's cans, and AU
containers are not serialised today.

### Consequence

We must verify the **deposit event**, not the **bottle identity.** This is what
every unattended scheme actually does — RVMs combine barcode + shape + weight +
material sensors; unattended bag-drop uses tamper-evident sealed bags. No single
"unique bottle fingerprint" exists; robustness comes from *correlating
independent signals* around the act of depositing.

## The threat model (what a cheat actually does)

1. **Replay the same container** — photograph one can, submit it N times.
2. **Replay the same photo** — submit one image repeatedly.
3. **Phantom deposit** — claim credit while standing nowhere near a bin, or
   without ever putting anything in.
4. **Ineligible item** — photograph an eligible can but bin trash (or nothing).
5. **Volume farming** — many small fake deposits across bins/accounts.

No bottle-side identifier defeats all five. A layered event-verification approach
does.

## Recommended approach — layered, shippable in stages

Ranked by value-per-effort. (1)–(3) need no hardware and no producer buy-in.

### 1. Photo-replay defence: perceptual image hash  *(cheap, ship first)*
Compute a perceptual hash (pHash/dHash) of every deposit photo server-side. Reject
a confirm whose hash is within a small Hamming distance of any recent accepted
photo (per bin, and globally per user). Kills threat #2 outright and raises the
cost of #1 (you must re-photograph from a new angle each time).
- Storage: a `PhotoHash` column on `Scan` (or a small `DepositPhoto` table) +
  an index for nearest-neighbour lookup over a rolling window.
- Note: a *cryptographic* hash is useless here (one-pixel change defeats it) —
  must be perceptual.

### 2. Bin-bound deposit token + geofence  *(strong, no hardware)*
Today `/scan?bin=GS-XXXX` already pins a bin code. Harden it:
- The deposit must be **physically at the bin**: capture device GPS at confirm
  and require it within ~50–100m of the bin's known lat/lng (we already store
  `Bin.Lat/Lng`). Defeats threat #3 (couch farming).
- Issue a **one-time, short-TTL deposit token bound to (user, bin)** — extend the
  existing HMAC `ScanTokenService` (already used for photo scans) to also commit
  to `BinId` + a server timestamp. `/confirm` consumes it once. This makes each
  deposit *slot* unique even though the bottle isn't.

### 3. Statistical / velocity backstop  *(cheap, partly exists)*
We already clamp per-scan counts and cap vision calls per user/day. Add:
- Per-user and per-bin deposit **velocity caps** (e.g. N/min, M/hour).
- Anomaly flags (same user hitting many bins in impossible succession →
  geofence + timing makes this detectable).
- Hold suspicious credit in `pendingCents` and only clear at runner pickup
  (already the model) — so fraud is catchable before cash-out.

### 4. Smart-bin sensor correlation  *(strongest, needs hardware)*
If/when bins get electronics: a beam-break / weight / internal-camera sensor
emits a "one container entered at T" event. Credit requires the app's deposit
(token + photo, within a few seconds) to **correlate with a real sensor event.**
This is the closest thing to RVM-grade assurance for an unattended bin, and it
verifies the *physical act*, not the bottle. Defeats #1, #3, #4 together.

### 5. Ride the serialisation wave  *(future, external)*
As AU producers adopt GS1 Digital Link / serialised 2D codes (driven by DDRS
rollouts), a per-unit code becomes scannable. Design the `Scan` record now so a
future `SerialId` slots in: when present, it's the gold-standard single-use proof;
when absent, fall back to layers 1–4.

## What this means for GoodSort, concretely

- **Don't promise per-bottle uniqueness** in product/marketing — it doesn't exist
  yet on the containers people actually have.
- **Verify the deposit, layered:** image-hash (1) + bin geofence & one-time token
  (2) + velocity caps (3) gets us a genuinely fraud-resistant unattended bin
  **with zero hardware**, reusing systems already in the codebase
  (`ScanTokenService`, `Bin.Lat/Lng`, per-user caps, pending→cleared settlement).
- **Keep credit in `pending` until runner pickup** so the physical container count
  at the depot is the final reconciliation — fraud surfaces as a pending/actual
  mismatch before anyone is paid.
- **Leave a `SerialId` seam** on `Scan` for the serialised-code future.

## Suggested first implementation slice

1. Add `PhotoHash` (perceptual) + `BinId`/`DepositLat`/`DepositLng` to the deposit
   path; reject near-duplicate photos and out-of-geofence confirms.
2. Extend `ScanTokenService` payload to bind `BinId` + issue time; `/confirm`
   enforces single use.
3. Add per-user/per-bin velocity caps alongside the existing vision caps.

All three are server-side, build-verifiable, and need no producer or hardware
dependency. The smart-bin sensor (layer 4) is the follow-on once bin hardware
exists.

## Sources

- Polytag — Digital Deposit Return Scheme explained: https://polytag.io/articles/digital-deposit-return-scheme-explained/
- GS1 in Europe — Deposit Return Schemes packaging activity 2024: https://gs1.eu/wp-content/uploads/2024/06/GS1-in-Europe-Packaging-Activity-2024.pdf
- TOMRA — container markings & barcodes for DRS: https://www.tomra.com/reverse-vending/media-center/feature-articles/deposit-return-systems-container-markings-barcodes
- TOMRA — Deposit Return Schemes FAQ (RVM sensors, bag drop): https://www.tomra.com/reverse-vending/deposit-return-schemes-faq
- The Grocer — the future of DRS could be digital: https://www.thegrocer.co.uk/analysis-and-features/the-future-of-deposit-return-schemes-could-be-digital-heres-why/655632.article
- CDS Vic — scheme integrity & fraud: https://cdsvic.org.au/scheme-integrity
