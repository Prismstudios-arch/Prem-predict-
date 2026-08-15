# Deploy the Edge Functions and set their secrets — SETUP.md Group D, D1 and D2.
#
# Everything here could be typed by hand. It is a script because the two things
# that go wrong are both silent:
#
#   - Running it from app/ instead of the repo root, so the CLI never finds
#     supabase/config.toml and deploys the webhook with JWT verification ON.
#     RevenueCat then gets 401 forever and nothing appears in the logs.
#   - Setting REVENUECAT_SECRET_KEY to the appl_ SDK key instead of the sk_
#     secret key. sync-entitlement then 502s on every call.
#
# Both are checked below.
#
# WHAT YOU DO FIRST
#
#   1. npx supabase@latest login          (opens a browser, click Authorize)
#   2. Create supabase\.env.deploy — see .env.deploy.example next to this file
#   3. .\supabase\deploy.ps1              (from the repo root)
#
# .env.deploy is gitignored by the `.env.*` rule at the top of .gitignore.

$ErrorActionPreference = 'Stop'

$ProjectRef = 'wqrpvvrbgaotcozdyvoi'
$Root       = Split-Path -Parent $PSScriptRoot
$EnvFile    = Join-Path $PSScriptRoot '.env.deploy'

# --- run from the repo root, whatever directory you invoked this from -------
Set-Location $Root
if (-not (Test-Path (Join-Path $Root 'supabase\config.toml'))) {
    throw "supabase\config.toml not found. This must run from the repo root."
}

# --- read the two values ----------------------------------------------------
if (-not (Test-Path $EnvFile)) {
    throw "Missing $EnvFile. Copy supabase\.env.deploy.example to supabase\.env.deploy and fill it in."
}

$values = @{}
foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $k, $v = $line -split '=', 2
    $values[$k.Trim()] = $v.Trim().Trim('"')
}

$webhookSecret = $values['REVENUECAT_WEBHOOK_SECRET']
$rcSecretKey   = $values['REVENUECAT_SECRET_KEY']

if ([string]::IsNullOrWhiteSpace($webhookSecret)) {
    throw "REVENUECAT_WEBHOOK_SECRET is empty in $EnvFile."
}
if ($webhookSecret.Length -lt 24) {
    throw "REVENUECAT_WEBHOOK_SECRET is only $($webhookSecret.Length) characters. Use at least 24 — this is the only thing standing between a stranger and granting themselves premium."
}
if ([string]::IsNullOrWhiteSpace($rcSecretKey)) {
    throw "REVENUECAT_SECRET_KEY is empty in $EnvFile."
}
if ($rcSecretKey.StartsWith('appl_')) {
    throw "REVENUECAT_SECRET_KEY starts with 'appl_', which is the PUBLIC SDK key already in eas.json. You need the SECRET key from RevenueCat -> Project settings -> API keys; it starts with 'sk_'."
}
if (-not $rcSecretKey.StartsWith('sk_')) {
    Write-Warning "REVENUECAT_SECRET_KEY does not start with 'sk_'. Continuing, but check it is the secret key and not the SDK key."
}

# --- deploy -----------------------------------------------------------------
Write-Host "`nDeploying revenuecat-webhook (JWT verification off, per config.toml)..." -ForegroundColor Cyan
npx supabase@latest functions deploy revenuecat-webhook --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { throw "Deploy of revenuecat-webhook failed." }

Write-Host "`nDeploying sync-entitlement (JWT verification on)..." -ForegroundColor Cyan
npx supabase@latest functions deploy sync-entitlement --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { throw "Deploy of sync-entitlement failed." }

# --- secrets ----------------------------------------------------------------
Write-Host "`nSetting secrets..." -ForegroundColor Cyan
npx supabase@latest secrets set "REVENUECAT_WEBHOOK_SECRET=$webhookSecret" --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { throw "Failed to set REVENUECAT_WEBHOOK_SECRET." }

npx supabase@latest secrets set "REVENUECAT_SECRET_KEY=$rcSecretKey" --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { throw "Failed to set REVENUECAT_SECRET_KEY." }

# --- what to do next --------------------------------------------------------
Write-Host "`nDone. Now paste these two into RevenueCat -> Integrations -> Webhooks -> + New:" -ForegroundColor Green
Write-Host ""
Write-Host "  Webhook URL"
Write-Host "  https://$ProjectRef.supabase.co/functions/v1/revenuecat-webhook"
Write-Host ""
Write-Host "  Authorization header"
Write-Host "  Bearer $webhookSecret"
Write-Host ""
Write-Host "  Environment: Sandbox AND Production"
Write-Host ""
Write-Host "Then check RevenueCat -> Entitlements has one called exactly 'premium'" -ForegroundColor Yellow
Write-Host "with both products attached. That is a different object from the" -ForegroundColor Yellow
Write-Host "Offering you also named 'premium', and it is the one the app reads." -ForegroundColor Yellow
