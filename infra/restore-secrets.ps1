# azd postdeploy hook (Windows): re-apply production env vars onto the api
# Container App. See restore-secrets.sh for rationale.

$ErrorActionPreference = "Stop"

$required = @(
  "JWT_SECRET", "TAILOR_VISION_API_KEY", "TAILOR_VISION_API_URL",
  "ACS_CONNECTION_STRING", "ACS_EMAIL_SENDER",
  "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_KEY", "AZURE_OPENAI_DEPLOYMENT",
  "GOODSORTDB_CONNECTION_STRING"
)

$missing = @()
foreach ($k in $required) {
  if (-not [Environment]::GetEnvironmentVariable($k)) { $missing += $k }
}
if ($missing.Count -gt 0) {
  Write-Error "Missing azd env vars: $($missing -join ', ')`nSet them with: azd env set <NAME> <VALUE>"
  exit 1
}

$rg = "rg-GoodSort"
$app = "api"
Write-Host "Restoring env vars on $app in $rg..."

$jwt   = [Environment]::GetEnvironmentVariable("JWT_SECRET")
$tvKey = [Environment]::GetEnvironmentVariable("TAILOR_VISION_API_KEY")
$tvUrl = [Environment]::GetEnvironmentVariable("TAILOR_VISION_API_URL")
$acs   = [Environment]::GetEnvironmentVariable("ACS_CONNECTION_STRING")
$acsSend = [Environment]::GetEnvironmentVariable("ACS_EMAIL_SENDER")
$oaiEnd = [Environment]::GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT")
$oaiKey = [Environment]::GetEnvironmentVariable("AZURE_OPENAI_KEY")
$oaiDep = [Environment]::GetEnvironmentVariable("AZURE_OPENAI_DEPLOYMENT")
$db     = [Environment]::GetEnvironmentVariable("GOODSORTDB_CONNECTION_STRING")

az containerapp update -n $app -g $rg `
  --set-env-vars `
    "JWT_SECRET=$jwt" `
    "TAILOR_VISION_API_KEY=$tvKey" `
    "TAILOR_VISION_API_URL=$tvUrl" `
    "ACS_CONNECTION_STRING=$acs" `
    "ACS_EMAIL_SENDER=$acsSend" `
    "AZURE_OPENAI_ENDPOINT=$oaiEnd" `
    "AZURE_OPENAI_KEY=$oaiKey" `
    "AZURE_OPENAI_DEPLOYMENT=$oaiDep" `
    "ConnectionStrings__goodsortdb=$db" `
  --output none

Write-Host "Env vars restored."

# Optional: ABA bank-settlement details. Only needed to generate cash-out payout
# files; the API fails loud at file-generation time if unset. See infra/aba-settlement.md.
$abaArgs = @()
foreach ($k in @("ABA_USER_ID","ABA_TRACE_BSB","ABA_TRACE_ACCOUNT","ABA_BANK_CODE","ABA_USER_NAME","ABA_REMITTER","CASHOUT_MAX_CENTS")) {
  $v = [Environment]::GetEnvironmentVariable($k)
  if ($v) { $abaArgs += "$k=$v" }
}
if ($abaArgs.Count -gt 0) {
  Write-Host "Applying settlement vars: $(($abaArgs | ForEach-Object { $_.Split('=')[0] }) -join ', ')"
  az containerapp update -n $app -g $rg --set-env-vars $abaArgs --output none
}

# Re-link thegoodsort.org to ACS (keeps getting unlinked by M365 DNS changes)
Write-Host "Re-linking thegoodsort.org email domain to ACS..."
$commId = "/subscriptions/5745cb5e-8c39-470f-ab6f-8a5897b7f9af/resourceGroups/rg-tailor-app-prod/providers/Microsoft.Communication/communicationServices/tailor-prod-comm"
$body = '{"properties":{"linkedDomains":["/subscriptions/5745cb5e-8c39-470f-ab6f-8a5897b7f9af/resourceGroups/rg-tailor-app-prod/providers/Microsoft.Communication/emailServices/tailor-prod-email/domains/AzureManagedDomain","/subscriptions/5745cb5e-8c39-470f-ab6f-8a5897b7f9af/resourceGroups/rg-tailor-app-prod/providers/Microsoft.Communication/emailServices/tailor-prod-email/domains/tailor.au","/subscriptions/5745cb5e-8c39-470f-ab6f-8a5897b7f9af/resourceGroups/rg-tailor-app-prod/providers/Microsoft.Communication/emailServices/tailor-prod-email/domains/thegoodsort.org"]}}'
try { az rest --method patch --url "$commId`?api-version=2023-04-01" --body $body --output none 2>$null } catch { Write-Host "WARNING: ACS domain re-link failed (non-fatal)" }
Write-Host "Done."
