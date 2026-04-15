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
