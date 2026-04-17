# End-to-End Dogfood Playbook

**Goal:** Walk the complete user + runner journey with real production data before inviting pilot households.

---

## Prerequisites

- [ ] Your account (knox@tailor.au or knox.hart@tailorco.au) has a household with a council collection day set
- [ ] You've registered as a runner at /runner/signup
- [ ] At least 1 household has scanned some containers (PendingContainers > 0)

## Step-by-step

### Phase 1: Be the household

1. Open thegoodsort.org on your phone
2. Log in → complete onboarding if needed (pick address, bin day, consent, divider)
3. Scan 10–20 containers using the camera (Photo scan → confirm)
4. Go to /household — confirm pending containers + next pickup date are showing
5. The evening before your council bin day, open /household and tap "Bin is on the kerb"

### Phase 2: Be the runner

1. Open /runner/signup and register (if not done)
2. Check the runner marketplace (tab at bottom or /runner)
3. If a run exists for your area → claim it
4. If no run exists:
   - Check /admin/pickups → does it show your household for tomorrow?
   - If yes, the RunGenerationService should generate a run within 5 minutes
   - If still nothing, manually trigger via /admin → "Trigger reminders now" (this tests emails but won't create a run — run generation is separate)
   - As a last resort: POST /api/admin/seed-marketplace was deleted. You can create a run manually by posting to the Runs endpoint via curl (see API below)
5. Once claimed: tap "Start Run" → drive to the address → tap "Arrived"
6. Open the yellow bin → extract cans/bottles → enter actual count → tap "Picked Up"
7. Drive to Tomra Yeerongpilly (201 Montague Rd, West End)
8. Feed containers through the machine or hand over to staff
9. In the app: tap "Delivering" → then "Delivered" / "Complete"
10. As admin: go to /admin → find the run → settle it (or POST /api/marketplace/runs/{id}/settle with auth)

### Phase 3: Verify the loop closed

1. **Runner side:** your Profile.ClearedCents should increase by (containers × perContainerCents)
2. **Household side:** go to /household — PendingContainers should be 0, ClearedCents should reflect the scanned amount
3. **Email:** check inbox — you should have received a "Bin collected ✨" email with your updated balance
4. **Admin:** /admin → stats should show updated cleared earnings, activation should tick up

### Phase 4: Test cashout

1. If ClearedCents ≥ $20 (2000c), tap Cash Out in the account panel
2. Enter BSB + account number + name
3. Check /admin → Export ABA File → download
4. Open the ABA file in a text editor — confirm it has the right payee details

## Quick API reference (for manual steps)

```bash
# Get your profile ID
TOKEN=<your jwt from localStorage goodsort_token>
BASE=https://api.livelyfield-64227152.eastasia.azurecontainerapps.io

# Check your household
curl -s $BASE/api/households -H "Authorization: Bearer $TOKEN" | python -m json.tool

# List available runs
curl -s $BASE/api/marketplace/runs?status=available | python -m json.tool

# Settle a completed run (admin)
curl -s -X POST "$BASE/api/marketplace/runs/{RUN_ID}/settle" -H "Authorization: Bearer $TOKEN"

# Trigger pickup reminders manually
curl -s -X POST "$BASE/api/admin/trigger-pickup-reminders" -H "Authorization: Bearer $TOKEN"

# Check admin stats
curl -s "$BASE/api/admin/stats" -H "Authorization: Bearer $TOKEN"
```

## What to watch for (bugs to catch)

- [ ] Does the scan toast say "+5¢ added to your account" (not "pending")?
- [ ] Does /household show the correct next-pickup date?
- [ ] Does the "Bin is on the kerb" toggle persist after refresh?
- [ ] Does the runner see the household address (not just coordinates)?
- [ ] After settle, does the household email arrive within 2 minutes?
- [ ] After settle, does PendingCents → ClearedCents move correctly?
- [ ] Does the Cash Out button show the motivational hint when < $20?
