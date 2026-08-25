# Rebuild the app from this checkout, silently reinstall, and relaunch — the
# same flow as Settings -> "Rebuild & relaunch", runnable from any terminal.
#
#   powershell -ExecutionPolicy Bypass -File scripts\reinstall-local.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\reinstall-local.ps1 -SkipBuild
#
# -SkipBuild installs whatever installer dist\ already holds for the current
# package.json version instead of rebuilding first.
param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

if (-not $SkipBuild) {
  npm install
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
  npm run dist
  if ($LASTEXITCODE -ne 0) { throw 'build failed' }
}

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$installer = Join-Path $repo "dist\tm-agent-monitor-$version-x64.exe"
if (-not (Test-Path $installer)) { throw "installer not found: $installer" }

# Close the running app so the installer never fights locked files. A graceful
# close lets it run its final history flush; force only what ignores that.
$running = Get-Process 'TaylorMade Agents' -ErrorAction SilentlyContinue
if ($running) {
  $running | ForEach-Object { $_.CloseMainWindow() | Out-Null }
  if (-not ($running | Wait-Process -Timeout 8 -ErrorAction SilentlyContinue)) {
    Get-Process 'TaylorMade Agents' -ErrorAction SilentlyContinue | Stop-Process -Force
  }
}

# The same arguments electron-updater passes the NSIS installer on
# quitAndInstall({ isSilent: true, isForceRunAfter: true }): `--updated` marks
# an in-place update, `/S` is silent, `--force-run` starts the app afterwards
# as the user — so this script never needs to know the install directory.
Write-Host "Installing v$version silently..."
Start-Process -FilePath $installer -ArgumentList '--updated', '/S', '--force-run' -Wait
Write-Host "Reinstalled v$version; the installer relaunched the app."
