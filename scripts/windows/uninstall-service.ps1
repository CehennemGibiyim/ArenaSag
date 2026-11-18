$ErrorActionPreference = "SilentlyContinue"
$ServiceName = "ArenaLiveOS"
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssm) { & $nssm.Source stop $ServiceName; & $nssm.Source remove $ServiceName confirm }
Unregister-ScheduledTask -TaskName $ServiceName -Confirm:$false
Write-Host "ArenaLiveOS arka plan görevi kaldırıldı."
