' tick-hidden.vbs - run the local tick with NO console window.
'
' Nick, 2026-09-18: "why is my terminal always opening". Task Scheduler launched node.exe
' directly as an interactive task, so every 15 minutes a console window popped up for the
' tick. wscript.exe is a windowless host: it starts node hidden (window style 0) and waits,
' so the task's time limit and single-instance rule still apply to the tick itself.
'
'   wscript.exe //B //Nologo tools\tick-hidden.vbs "C:\Program Files\nodejs\node.exe" [tick args]
'
' The working directory is set by the scheduled task (the repo root); node inherits it.
Option Explicit
Dim sh, node, extra, i
Set sh = CreateObject("WScript.Shell")
If WScript.Arguments.Count < 1 Then WScript.Quit 2
node = WScript.Arguments(0)
extra = ""
For i = 1 To WScript.Arguments.Count - 1
  extra = extra & " " & WScript.Arguments(i)
Next
WScript.Quit sh.Run("""" & node & """ tools\tick-local.mjs" & extra, 0, True)
