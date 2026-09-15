# install-local-tick.ps1 — register the fallback tick on this Windows machine (Task Scheduler).
#
#   powershell -ExecutionPolicy Bypass -File tools\install-local-tick.ps1            install / update
#   powershell -ExecutionPolicy Bypass -File tools\install-local-tick.ps1 -Remove    remove
#
# Runs `node tools/tick-local.mjs` every 15 minutes, whether or not anyone is signed in, and
# whenever the machine wakes. tick-local.mjs itself decides whether there is anything to do
# (only when GitHub's runner has gone quiet), so this is safe to leave on for ever.
# Nick, 2026-09-15: make sure these problems do not happen again - see tools/tick-local.mjs.
param([switch]$Remove)
$name = 'Chatterbox AgentOS local tick'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$node = (Get-Command node).Source
if ($Remove) { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue; Write-Host "removed: $name"; exit 0 }
$action  = New-ScheduledTaskAction -Execute $node -Argument 'tools\tick-local.mjs' -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 40) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "installed: $name - every 15 min, node $node, cwd $root"
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State
