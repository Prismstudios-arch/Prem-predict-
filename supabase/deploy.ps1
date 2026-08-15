# Deploy the Edge Functions and set their secrets - SETUP.md Group D.
#
#   .\supabase\install-cli.ps1      once
#   fill in supabase\.env.deploy    once
#   .\supabase\deploy.ps1           whenever a function changes
#
# No browser login and no Docker. Authentication is a Supabase access token
# read from .env.deploy, and functions are bundled server-side with --use-api.
#
# THE FOUR THINGS THAT GO WRONG, ALL SILENTLY, ALL CHECKED BELOW
#
#   1. Run from app/ instead of the repo root. The CLI never finds
#      supabase/config.toml, so revenuecat-webhook deploys with JWT
#      verification ON. RevenueCat then gets 401 on every delivery and writes
#      nothing to the logs, because the gateway rejects before the function
#      runs. The app shows a paywall to someone who has paid.
#   2. Pass the appl_ SDK key where the sk_ secret key belongs. Both are "the
#      RevenueCat key" in conversation; only one can read a subscriber.
#   3. A short webhook secret. It is the only thing between a stranger with the
#      URL and granting themselves premium via curl.
#   4. Docker not installed, which without --use-api is a hard stop on Windows.

$ErrorActionPreference = 'Stop'

$ProjectRef = 'wqrpvvrbgaotcozdyvoi'
$Root       = Split-Path -Parent $PSScriptRoot
$EnvFile    = Join-Path $PSScriptRoot '.env.deploy'

Set-Location $Root
if (-not (Test-Path (Join-Path $Root 'supabase\config.toml'))) {
    throw "supabase\config.toml not found. Run this from the repo root."
}

# --- locate the CLI ---------------------------------------------------------
$Cli = Join-Path $env:LOCALAPPDATA 'supabase-cli\supabase.exe'
if (-not (Test-Path $Cli)) {
    $onPath = Get-Command supabase -ErrorAction SilentlyContinue
    if ($onPath) {
        $Cli = $onPath.Source
    } else {
        throw "Supabase CLI not found. Run .\supabase\install-cli.ps1 first."
    }
}

# --- read config ------------------------------------------------------------
if (-not (Test-Path $EnvFile)) {
    throw "Missing $EnvFile. Copy supabase\.env.deploy.example to supabase\.env.deploy and fill it in."
}

$values = @{}
foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $k, $v = $line -split '=', 2
    $values[$k.Trim()] = $v.Trim().Trim('"')
}

$accessToken   = $values['SUPABASE_ACCESS_TOKEN']
$webhookSecret = $values['REVENUECAT_WEBHOOK_SECRET']
$rcSecretKey   = $values['REVENUECAT_SECRET_KEY']

if ([string]::IsNullOrWhiteSpace($accessToken)) {
    throw "SUPABASE_ACCESS_TOKEN is empty in $EnvFile. Create one at https://supabase.com/dashboard/account/tokens"
}
if ([string]::IsNullOrWhiteSpace($webhookSecret)) {
    throw "REVENUECAT_WEBHOOK_SECRET is empty in $EnvFile."
}
if ($webhookSecret.Length -lt 24) {
    throw "REVENUECAT_WEBHOOK_SECRET is only $($webhookSecret.Length) characters. Use at least 24 - it is the only thing standing between a stranger with the URL and granting themselves premium."
}
if ([string]::IsNullOrWhiteSpace($rcSecretKey)) {
    throw "REVENUECAT_SECRET_KEY is empty in $EnvFile."
}
if ($rcSecretKey.StartsWith('appl_')) {
    throw "REVENUECAT_SECRET_KEY starts with 'appl_', which is the PUBLIC SDK key already in app/eas.json. You need the SECRET key: RevenueCat -> Project settings -> API keys. It starts with 'sk_'."
}
if (-not $rcSecretKey.StartsWith('sk_')) {
    Write-Warning "REVENUECAT_SECRET_KEY does not start with 'sk_'. Continuing, but check you have the secret key and not the SDK key."
}

# Every CLI command reads this, so no `supabase login` and no browser.
$env:SUPABASE_ACCESS_TOKEN = $accessToken

# --- deploy -----------------------------------------------------------------
# --use-api bundles on Supabase's side. Without it the CLI needs Docker, which
# is not installed here and is a large dependency for two small functions.
Write-Host "`nDeploying revenuecat-webhook (JWT verification off, per config.toml)..." -ForegroundColor Cyan
& $Cli functions deploy revenuecat-webhook --project-ref $ProjectRef --use-api
if ($LASTEXITCODE -ne 0) { throw 'Deploy of revenuecat-webhook failed.' }

Write-Host "`nDeploying sync-entitlement (JWT verification on)..." -ForegroundColor Cyan
& $Cli functions deploy sync-entitlement --project-ref $ProjectRef --use-api
if ($LASTEXITCODE -ne 0) { throw 'Deploy of sync-entitlement failed.' }

# --- secrets ----------------------------------------------------------------
Write-Host "`nSetting secrets..." -ForegroundColor Cyan
& $Cli secrets set "REVENUECAT_WEBHOOK_SECRET=$webhookSecret" --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { throw 'Failed to set REVENUECAT_WEBHOOK_SECRET.' }

& $Cli secrets set "REVENUECAT_SECRET_KEY=$rcSecretKey" --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { throw 'Failed to set REVENUECAT_SECRET_KEY.' }

# --- what to do next --------------------------------------------------------
Write-Host "`n============================================================" -ForegroundColor Green
Write-Host " Deployed. Now paste these into RevenueCat:" -ForegroundColor Green
Write-Host " Integrations -> Webhooks -> + New" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Webhook URL"
Write-Host "  https://$ProjectRef.supabase.co/functions/v1/revenuecat-webhook"
Write-Host ""
Write-Host "  Authorization header"
Write-Host "  Bearer $webhookSecret"
Write-Host ""
Write-Host "  Environment:  Sandbox AND Production"
Write-Host ""
Write-Host "Then: RevenueCat -> Entitlements must have one called exactly" -ForegroundColor Yellow
Write-Host "'premium', with both products attached. That is a DIFFERENT object" -ForegroundColor Yellow
Write-Host "from the Offering you also named 'premium'. The app reads the" -ForegroundColor Yellow
Write-Host "Entitlement; an Offering with no Entitlement sells and unlocks nothing." -ForegroundColor Yellow
