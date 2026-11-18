param([switch]$NoBrowser, [switch]$CheckUpdate)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if ($CheckUpdate) {
  try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/update/status" -TimeoutSec 5
    if ($status.updateAvailable) {
      Write-Host "Yeni sürüm mevcut: $($status.latestVersion). Güncelleme için Arena-Update.bat çalıştırın."
    }
  } catch { }
}
if (-not (Test-Path "node_modules")) { npm ci }
if (-not (Test-Path ".next")) { npm run build }
$port = if ($env:PORT) { $env:PORT } else { "3000" }
if (-not $NoBrowser) { Start-Process "http://localhost:$port" }
npm run start
