# Install the Supabase CLI on Windows without npm.
#
# WHY NOT npx
#
# `npx supabase@latest` fails on this machine with:
#
#     No matching Supabase CLI binary package found for win32-x64
#
# The npm package is a thin shim that pulls the real binary from a
# platform-specific optionalDependency, and npm has a long-standing bug where
# optional deps are skipped or cached wrong - after which the shim throws
# instead of falling back. Supabase's own docs say a global npm install is not
# supported and point Windows users at Scoop.
#
# Rather than add Scoop as a dependency, this fetches the same binary that
# Scoop and npm would, straight from the project's GitHub releases, into
# %LOCALAPPDATA%\supabase-cli. No admin rights, nothing on PATH, nothing to
# uninstall - delete the folder and it is gone.

$ErrorActionPreference = 'Stop'

$Dir = Join-Path $env:LOCALAPPDATA 'supabase-cli'
$Exe = Join-Path $Dir 'supabase.exe'

if (Test-Path $Exe) {
    $current = & $Exe --version
    Write-Host "Supabase CLI $current already installed at $Exe" -ForegroundColor Green
    return
}

# Resolve the latest release rather than pinning: this is a CLI talking to a
# hosted API, and a pinned old client is the thing that breaks, not the reverse.
Write-Host 'Looking up the latest Supabase CLI release...'
$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/supabase/cli/releases/latest' -UseBasicParsing
$tag = $release.tag_name

$arch = if ([Environment]::Is64BitOperatingSystem) { 'amd64' } else { 'arm64' }
$asset = $release.assets | Where-Object { $_.name -eq "supabase_$($tag.TrimStart('v'))_windows_$arch.zip" } | Select-Object -First 1
if (-not $asset) {
    throw "No windows_$arch .zip asset in release $tag. See https://github.com/supabase/cli/releases"
}

New-Item -ItemType Directory -Force $Dir | Out-Null
$zip = Join-Path $env:TEMP 'supabase_cli.zip'

Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB)) MB)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
Expand-Archive -Path $zip -DestinationPath $Dir -Force
Remove-Item $zip -Force

$installed = & $Exe --version
Write-Host "Installed Supabase CLI $installed to $Exe" -ForegroundColor Green
