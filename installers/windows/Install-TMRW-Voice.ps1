$ErrorActionPreference = 'Stop'
$RepositoryUrl = if ($env:TMRW_PHONE_REPOSITORY_URL) { $env:TMRW_PHONE_REPOSITORY_URL } else { 'https://github.com/luftmenschiv-arch/TMRW-Phone-V3.git' }
$VoiceHome = if ($env:TMRW_VOICE_HOME) { $env:TMRW_VOICE_HOME } else { Join-Path $env:LOCALAPPDATA 'TMRW-Voice' }
$AppDir = Join-Path $VoiceHome 'app'

Write-Host 'Installing TMRW Local Voice for Windows…'
New-Item -ItemType Directory -Force -Path $VoiceHome | Out-Null
if (Test-Path (Join-Path $AppDir '.git')) {
  git -C $AppDir pull --ff-only
} else {
  $Partial = "$AppDir.partial"
  if (Test-Path $Partial) { Remove-Item -LiteralPath $Partial -Recurse -Force }
  git clone --depth 1 $RepositoryUrl $Partial
  Move-Item -LiteralPath $Partial -Destination $AppDir
}

$CurrentTools = Join-Path $VoiceHome 'current\tools'
New-Item -ItemType Directory -Force -Path $CurrentTools | Out-Null
Copy-Item -LiteralPath (Join-Path $AppDir 'voice-manager\tools\extract_voice_profile.py') -Destination $CurrentTools -Force
Copy-Item -LiteralPath (Join-Path $AppDir 'voice-manager\tools\transcribe.py') -Destination $CurrentTools -Force

$TaskName = 'TMRW Voice Manager'
$Node = (Get-Command node).Source
$Server = Join-Path $AppDir 'voice-manager\src\server.mjs'
$Action = New-ScheduledTaskAction -Execute $Node -Argument "`"$Server`"" -WorkingDirectory (Split-Path $Server)
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Days 3650) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description 'Local voice service for TMRW Phone' -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host 'Done. Open TMRW Phone → Settings → Voice.'
