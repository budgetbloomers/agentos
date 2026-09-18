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
# NO WINDOW (Nick, 2026-09-18: "why is my terminal always opening"). An interactive task that
# runs node.exe directly opens a console window every 15 minutes. wscript.exe is a windowless
# host: tools\tick-hidden.vbs starts node with window style 0 and waits for it, so nothing
# appears on screen and the time limit / single-instance rule still cover the tick itself.
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$action  = New-ScheduledTaskAction -Execute $wscript -Argument ('//B //Nologo tools\tick-hidden.vbs "' + $node + '"') -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 40) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "installed: $name - every 15 min, hidden (wscript), node $node, cwd $root"
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State
