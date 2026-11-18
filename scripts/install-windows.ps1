$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Require-Command($name, $hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "$name bulunamadı. $hint"
  }
}

Require-Command "node" "Node.js 20+ kurun: https://nodejs.org"
Require-Command "npm" "Node.js ile birlikte gelir."
$nodeVersion = (node -v).TrimStart("v")
if ([version]$nodeVersion -lt [version]"20.0.0") { throw "Node.js 20+ gerekli. Mevcut: $nodeVersion" }

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host ".env oluşturuldu. DATABASE_URL değerini kontrol edin."
}
if (-not (Test-Path "node_modules")) { npm ci }
npx drizzle-kit push
npm run build
Write-Host "Kurulum tamam. Arena-Live-OS.bat ile başlatın."
