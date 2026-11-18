param(
  [string]$Title = "Arena Radar",
  [string]$Message = ""
)

# Windows bildirim balonu — harici modül gerektirmez.
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $icon = New-Object System.Windows.Forms.NotifyIcon
  $icon.Icon = [System.Drawing.SystemIcons]::Information
  $icon.BalloonTipTitle = $Title
  $icon.BalloonTipText = $Message
  $icon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
  $icon.Visible = $true
  $icon.ShowBalloonTip(10000)
  Start-Sleep -Seconds 11
  $icon.Visible = $false
  $icon.Dispose()
} catch {
  # Bildirim gösterilemezse sessizce çık; uygulama günlüğüne yazılır.
}
