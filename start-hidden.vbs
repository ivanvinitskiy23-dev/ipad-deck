' Hidden launcher for iPad Deck Hub — always one fresh instance
Option Explicit
Dim sh, fso, dir, script, cmd, wmi, procs, p, pythonw
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
script = dir & "\server.py"
pythonw = "C:\Users\Qwiqly\AppData\Local\Programs\Python\Python312\pythonw.exe"
If Not fso.FileExists(pythonw) Then pythonw = "pythonw.exe"

' Kill stale hub processes first (fixes "нет связи" after hung pythonw)
On Error Resume Next
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set procs = wmi.ExecQuery("Select ProcessId, CommandLine From Win32_Process Where Name='python.exe' OR Name='pythonw.exe'")
For Each p In procs
  If InStr(1, LCase(p.CommandLine & ""), "server.py", 1) > 0 Then
    wmi.Get("Win32_Process.Handle='" & p.ProcessId & "'").Terminate
  End If
Next
On Error GoTo 0

WScript.Sleep 600
sh.CurrentDirectory = dir
cmd = """" & pythonw & """ """ & script & """"
sh.Run cmd, 0, False
