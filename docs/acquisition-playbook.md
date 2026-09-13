# The Good Sort — First Organic User Acquisition Playbook

**Goal:** Secure the first organic collecting household and container scans in Brisbane to unlock the first collection run.

---

## 1. The Core Value Proposition

> **"Scan, sort, skip the depot."**  
> Scan eligible cans and bottles at home. Earn 5¢ sorting credit each. When our suburb hits enough containers for one driver trip (~1,000 containers), bag out on recycling night — we pick them up from the kerb and take them to the refund point. No depot queues. No driving with sticky cans.

---

## 2. Priority Corridor: Moorooka / Yeronga / Yeerongpilly

This corridor is selected because:
- High proportion of standalone residential houses with kerbside collection.
- Directly adjacent to the primary refund depot (**TOMRA Yeerongpilly / West End**).
- Minimises driver distance for the first run.

---

## 3. Distribution Channels & Ready-to-Post Copy

### Channel A: Local Community Noticeboards (Facebook Groups / Nextdoor / Street WhatsApp)
**Target:** *Moorooka Community Noticeboard*, *Yeronga & Surrounds Community*, *Annerley Local*, *Stephens / Tarragindi Community*

**Post Copy:**
```text
Hey neighbours! 👋

If you drink soft drink cans, beer bottles, or kombucha bottles and hate queuing up at the Containers for Change depot on weekends:

A few of us are using a local Brisbane service called The Good Sort (https://thegoodsort.org/brisbane/moorooka).

Here is how it works:
1. You scan eligible cans/bottles using your phone camera (you earn 5¢ credit for each one).
2. Sort them into your own bags at home (cans in one, plastic bottles in another, glass in a third).
3. Once our suburb has enough containers for a driver run, we bag them out on recycling night, and a local runner collects them from the kerb and handles the refund point trip.

You get paid 5¢ per container without having to load dirty bottles in your car or wait in machine lines.

Start scanning here: https://thegoodsort.org/brisbane/moorooka
```

---

### Channel B: Reddit (`r/brisbane`)
**Title:** Built an app to get your Containers for Change 10¢ bottles collected from your kerb in Brisbane (The Good Sort)

**Post Body:**
```text
Hey Brisbane!

Like a lot of households, we end up with bags of cans and bottles cluttering up the garage because nobody wants to spend Saturday morning queuing at the TOMRA depot or dealing with broken machines.

We launched The Good Sort (https://thegoodsort.org) to solve this:
- Point your phone camera at a can/bottle to scan it (instant 5¢ sorting credit per container).
- Keep them sorted in bags by material at home.
- When your suburb scans enough containers for one driver trip (~1,000 containers), we schedule a volume pickup from your kerb on your recycling night.
- A local driver picks up the bags and takes them through the refund point.

It’s currently live to start scanning across Brisbane suburbs. You can look up your suburb and start scanning today at:
https://thegoodsort.org

Feedback and bug reports are hugely appreciated!
```

---

### Channel C: Letterbox Drop / Coffee Shop Community Board (One-Page Flyer)
- Heading: **Skip the depot line. Get 5¢ per can from your kerb.**
- Bullet points:
  - 1. Scan at home on your phone
  - 2. Bag by stream (aluminium, PET, glass)
  - 3. We collect from your kerbside
- URL: `thegoodsort.org/brisbane/moorooka`

---

## 4. What Happens Once They Scan?

1. User captures container image on `thegoodsort.org/scan`.
2. Vision model classifies material + eligibility and quotes 5¢ credit.
3. User enters email + verifies OTP.
4. User enters address -> attaches to their suburb.
5. Container count increments on the suburb board.
6. The moment the suburb unlocks volume, `SendOpsStreetReady` alerts Knox at `knox@tailor.au` to schedule the driver pickup!
