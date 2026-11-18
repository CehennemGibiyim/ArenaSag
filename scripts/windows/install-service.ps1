$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ServiceName = "ArenaLiveOS"
$Node = (Get-Command node -ErrorAction SilentlyContinue)?.Source
if (-not $Node) { throw "node.exe bulunamadı. Node.js 20+ kurun." }
$Next = Join-Path $Root "node_modules\next\dist\bin\next"
if (-not (Test-Path $Next)) { throw "Next.js bulunamadı. Önce kurulum sihirbazını çalıştırın." }
$envFile = Join-Path $Root ".env"
$envText = if (Test-Path $envFile) { Get-Content $envFile -Raw } else { "" }
$dbLine = ($envText -split "`r?`n" | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1)
$dbUrl = if ($dbLine) { $dbLine.Substring("DATABASE_URL=".Length) } else { "postgresql://postgres:postgres@127.0.0.1:5432/app_db" }
$port = if ($env:PORT) { $env:PORT } else { "3000" }
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssm) {
  & $nssm.Source install $ServiceName $Node "`"$Next`" start"
  & $nssm.Source set $ServiceName AppDirectory $Root
  & $nssm.Source set $ServiceName AppEnvironmentExtra "PORT=$port" "DATABASE_URL=$dbUrl"
  & $nssm.Source set $ServiceName Start SERVICE_AUTO_START
  & $nssm.Source set $ServiceName AppExit Default Restart
  & $nssm.Source start $ServiceName
  Write-Host "ArenaLiveOS servisi NSSM ile kuruldu ve başlatıldı."
} else {
  $action = New-ScheduledTaskAction -Execute $Node -Argument "`"$Next`" start" -WorkingDirectory $Root
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $ServiceName -Action $action -Trigger $trigger -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null
  Start-ScheduledTask -TaskName $ServiceName
  Write-Host "ArenaLiveOS görev zamanlayıcısı kuruldu (NSSM yok). Bilgisayar açılışında çalışır."
}
