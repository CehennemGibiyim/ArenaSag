param([string]$Repo = $env:ARENA_GITHUB_REPO, [switch]$Force)
$ErrorActionPreference = "Stop"
if (-not $Repo) { $Repo = "CehennemGibiyim/Arena" }
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root
$current = (Get-Content (Join-Path $Root "version.json") -Raw | ConvertFrom-Json).version
Write-Host "Mevcut sürüm: $current"
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "ArenaLiveOS-Updater"; "Accept" = "application/vnd.github+json" }
$latest = $release.tag_name.TrimStart("v")
if (-not $Force -and ([version]$latest -le [version]$current)) { Write-Host "Güncelleme yok. En son sürüm: $latest"; exit 0 }
$asset = $release.assets | Where-Object { $_.name -match "Arena-Live-OS-windows\.zip$" } | Select-Object -First 1
if (-not $asset) { throw "Release içinde Arena-Live-OS-windows.zip bulunamadı." }
$zip = Join-Path $env:TEMP $asset.name
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip
$sumAsset = $release.assets | Where-Object { $_.name -match "SHA256SUMS\.txt$" } | Select-Object -First 1
if ($sumAsset) {
  $sumFile = Join-Path $env:TEMP $sumAsset.name
  Invoke-WebRequest -Uri $sumAsset.browser_download_url -OutFile $sumFile
  $expected = (Get-Content $sumFile | Where-Object { $_ -match [regex]::Escape($asset.name) } | ForEach-Object { ($_ -split '\s+')[0] } | Select-Object -First 1)
  $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expected -and $actual -ne $expected.ToLowerInvariant()) { throw "SHA256 doğrulaması başarısız." }
  Write-Host "SHA256 doğrulandı."
}
$backupEnv = Join-Path $env:TEMP "arena-env-backup.txt"
if (Test-Path ".env") { Copy-Item ".env" $backupEnv -Force }
$service = Get-Service "ArenaLiveOS" -ErrorAction SilentlyContinue
if ($service) { Stop-Service "ArenaLiveOS" -Force -ErrorAction SilentlyContinue }
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
$extract = Join-Path $env:TEMP "arena-update"
if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $extract -Force
$source = Get-ChildItem $extract -Directory | Select-Object -First 1
if (-not $source) { $source = Get-Item $extract }
Copy-Item "$($source.FullName)\*" $Root -Recurse -Force
if (Test-Path $backupEnv) { Copy-Item $backupEnv ".env" -Force }
npm ci
npx drizzle-kit push
npm run build
if ($service) { Start-Service "ArenaLiveOS" } else { Write-Host "Servis yok; Arena-Live-OS.bat ile başlatın." }
Write-Host "Güncelleme tamamlandı: $latest"
