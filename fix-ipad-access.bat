@echo off
:: Run as Administrator — hard-fix iPad LAN access to Deck Hub
cd /d "%~dp0"
set PORT=8787

echo.
echo === iPad Deck: fix tablet access ===
echo.

echo [1/6] Ethernet -^> Private network...
powershell -NoProfile -Command "try { Get-NetConnectionProfile | ForEach-Object { Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private -ErrorAction SilentlyContinue; Write-Host ('  ' + $_.InterfaceAlias + ' = Private') } } catch { Write-Host $_.Exception.Message }"

echo.
echo [2/6] Kill stuck listeners on 8080/8787...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8080 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8787 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe' OR Name='pythonw.exe'\" | Where-Object { $_.CommandLine -match 'server\\.py' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host ('  killed ' + $_.ProcessId) }"

echo.
echo [3/6] Firewall rules for port %PORT% + pythonw...
netsh advfirewall firewall delete rule name="iPad Deck Hub" >nul 2>&1
netsh advfirewall firewall delete rule name="iPad Deck Hub 8080" >nul 2>&1
netsh advfirewall firewall delete rule name="iPad Deck Hub 8787" >nul 2>&1
netsh advfirewall firewall delete rule name="iPad Deck pythonw" >nul 2>&1

netsh advfirewall firewall add rule name="iPad Deck Hub 8787" dir=in action=allow protocol=TCP localport=%PORT% profile=private,domain,public enable=yes
netsh advfirewall firewall add rule name="iPad Deck pythonw" dir=in action=allow program="C:\Users\Qwiqly\AppData\Local\Programs\Python\Python312\pythonw.exe" profile=private,domain,public enable=yes

echo.
echo [4/6] Allow ping (optional)...
netsh advfirewall firewall delete rule name="iPad Deck ICMPv4" >nul 2>&1
netsh advfirewall firewall add rule name="iPad Deck ICMPv4" dir=in action=allow protocol=icmpv4:8,any profile=private,domain,public enable=yes >nul 2>&1

echo.
echo [5/6] Restart hub...
cscript //nologo "%~dp0restart-hub.vbs"
timeout /t 2 /nobreak >nul

echo.
echo [6/6] Local check...
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -Uri 'http://192.168.0.247:8787/api/ping' -UseBasicParsing -TimeoutSec 4; Write-Host ('  Hub OK ' + $r.Content) } catch { Write-Host ('  Hub FAIL: ' + $_.Exception.Message) }"

echo.
echo ============================================
echo  On iPad open EXACTLY this (http, not https):
echo.
echo    http://192.168.0.247:8787/
echo.
echo  Old :8080 may be a dead zombie — do NOT use it.
echo  Close the Safari tab fully, then open the new URL.
echo ============================================
echo.
pause
