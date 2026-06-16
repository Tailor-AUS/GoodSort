# ABA payout file — settlement configuration

GoodSort pays sorters and runners by generating an **ABA file** (the Australian
Banking Association batch-transfer format) from pending cash-out requests, which is
then uploaded to the business bank. `CashoutService.GenerateAbaFile()` builds it.

## ⚠️ Why this needs configuring before the first cash-out

The file's **descriptive (type 0)** and **detail (type 1)** records embed the
*source-of-funds* (debit) account — the GoodSort business account the money comes
*from*. These used to be hardcoded placeholders (`062-000` / `12345678`) that the
bank **will reject**.

The code now reads them from configuration and **fails loud** (throws, so the admin
ABA-export endpoint returns an error) if the critical ones are missing or blank —
it will never silently emit a file the bank bounces.

## Required environment variables

| Var | Required | Meaning | Example |
|-----|----------|---------|---------|
| `ABA_USER_ID` | **yes** | APCA User Identification Number issued by your bank | `301500` |
| `ABA_TRACE_BSB` | **yes** | BSB of the source-of-funds (debit) account, with hyphen | `032-000` |
| `ABA_TRACE_ACCOUNT` | **yes** | Account number of the source-of-funds account | `123456` |
| `ABA_BANK_CODE` | no (`WBC`) | 3-letter bank mnemonic | `WBC`, `CBA`, `NAB`, `ANZ` |
| `ABA_USER_NAME` | no | Preferred name on the file (≤26 chars) | `THE GOOD SORT PTY LTD` |
| `ABA_REMITTER` | no | Remitter shown on payee statements (≤16 chars) | `THE GOOD SORT` |
| `CASHOUT_MAX_CENTS` | no (`500000`) | Single cash-out ceiling, in cents | `500000` ($5,000) |

> The **APCA User ID** is not the same as your account number. Ask your bank's
> business banking / transaction-banking team for your "direct entry user ID"
> (a.k.a. APCA number) — it's required to lodge ABA files. Westpac (`WBC`) issues a
> 6-digit one.

## How to set them

These are runtime Container App env vars. Because `azd deploy` strips anything not
in the Aspire manifest, set them via the azd environment so the `restore-secrets`
postdeploy hook re-applies them (it already includes them, optionally):

```bash
azd env set ABA_USER_ID "301500"
azd env set ABA_TRACE_BSB "032-000"
azd env set ABA_TRACE_ACCOUNT "123456"
# optional overrides
azd env set ABA_BANK_CODE "WBC"
azd env set ABA_USER_NAME "THE GOOD SORT PTY LTD"
azd env set ABA_REMITTER "THE GOOD SORT"
azd up   # or rerun the postdeploy hook
```

Or set them directly on the Container App for a quick test:

```bash
az containerapp update -n api -g rg-GoodSort \
  --set-env-vars "ABA_USER_ID=301500" "ABA_TRACE_BSB=032-000" "ABA_TRACE_ACCOUNT=123456"
```

## Verify

After setting them, the admin ABA-export endpoint should return a valid file
instead of throwing. Confirm the type-0 record shows your real user id/name and
the type-1 records carry the correct trace BSB + account.

## Still open (not code-fixable)

- **Payee BSB/account stored unencrypted at rest.** `CashoutRequest.Bsb` /
  `.AccountNumber` are plaintext in Azure SQL. Encrypt at rest (Always Encrypted /
  TDE column encryption keyed by Key Vault). See `infra/secrets-keyvault.md`.
