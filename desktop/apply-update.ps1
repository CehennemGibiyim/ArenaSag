param([Parameter(Mandatory = $true)][string]$Installer)

# Çalışan uygulamanın kapanmasını bekler, yeni kurulumu sessizce uygular ve başlatır.
$ErrorActionPreference = "SilentlyContinue"
Start-Sleep -Seconds 2

if (-not (Test-Path $Installer)) { exit 1 }

# Yalnızca Arena Radar süreçlerini kapat; diğer node işlemlerine dokunma.
$stateDir = Join-Path $env:LOCALAPPDATA "ArenaRadar"
$pidFile = Join-Path $stateDir "radar.pid"
if (Test-Path $pidFile) {
  $radarPid = (Get-Content $pidFile -Raw).Trim()
  if ($radarPid -match '^\d+$') { Stop-Process -Id ([int]$radarPid) -Force }
}

Start-Process -FilePath $Installer -ArgumentList "/S" -Wait
$launcher = Join-Path $env:LOCALAPPDATA "Programs\Arena Radar\ArenaRadar.bat"
if (Test-Path $launcher) { Start-Process -FilePath $launcher }
