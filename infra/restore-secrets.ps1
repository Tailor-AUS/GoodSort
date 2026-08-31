# azd postdeploy hook (Windows). Delegates to restore-secrets.sh — it does not
# reimplement it.
#
# It used to be a parallel implementation, and it silently rotted. It stopped
# receiving commits at #8 while the .sh went on to gain #18, #25 and #26, so on
# Windows `azd deploy` did the opposite of what the repo documents:
#
#   * it wrote ACS_CONNECTION_STRING as a plaintext env var, undoing #26, which
#     had moved it to a container-app secret referenced by secretref;
#   * it had no goodsort-comm guard, so it restored whatever it was handed;
#   * it PATCHed tailor-app's tailor-prod-comm linkedDomains with a hardcoded
#     array containing thegoodsort.org — re-creating the exact coupling #25
#     removed, and assigning the array wholesale, which is what
#     scripts/ensure-acs-domain-linked.sh warns never to do because it clobbers
#     tailor-app's own domains.
#
# None of that was visible. Nothing builds, lints or tests a .ps1; CI never runs
# it; the GitHub deploy path uses `az acr build` and never touches it. It
# executes only on a manual `azd deploy` from Windows, and it printed
# "Env vars restored." and "Done." whichever branch it took. Two files sitting
# side by side in a directory listing look like siblings, not like one being
# three security fixes behind the other.
#
# So there is one implementation now, the same way there is one ACS link
# implementation. This file exists solely because azure.yaml routes Windows to
# pwsh.

$ErrorActionPreference = "Stop"

$script = Join-Path $PSScriptRoot "restore-secrets.sh"
if (-not (Test-Path $script)) {
    Write-Error "restore-secrets.sh not found next to this script at $script."
    exit 1
}

# Git for Windows ships bash; azd itself does not. Fail loudly rather than
# quietly doing something different from the Linux path — a postdeploy hook that
# half-runs is how the drift above started.
$bash = (Get-Command bash -ErrorAction SilentlyContinue)?.Source
if (-not $bash) {
    foreach ($candidate in @("$env:ProgramFiles\Git\bin\bash.exe", "${env:ProgramFiles(x86)}\Git\bin\bash.exe")) {
        if (Test-Path $candidate) { $bash = $candidate; break }
    }
}
if (-not $bash) {
    Write-Error @"
bash was not found, so infra/restore-secrets.sh cannot run.

This hook deliberately does not reimplement it: the reimplementation went three
security fixes stale without anyone noticing. Install Git for Windows (which
provides bash), or run the script yourself:

    bash infra/restore-secrets.sh
"@
    exit 1
}

Write-Host "Delegating to restore-secrets.sh via $bash ..."

# Hand it a POSIX path; git bash does not accept C:\... as a script argument.
$posix = ($script -replace '\', '/') -replace '^([A-Za-z]):', '/$1'
& $bash -lc "'$posix'"
exit $LASTEXITCODE
