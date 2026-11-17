@echo off
rem ============================================================
rem  Menu de bancada da PLC32 (projeto principal, pasta firmware/)
rem    1 - Gravar firmware de ESCUTA (so recebe o RS485)
rem    2 - Monitorar serial (com log em scripts\logs)
rem    3 - Gravar escuta e monitorar
rem    4 - Gravar firmware de PRODUCAO (MQTT + sensores + RTU)
rem    5 - Sair
rem  Abra pelo escuta.vbs (duplo clique) ou direto.
rem ============================================================
setlocal
set "PASTA=%~dp0"
for %%I in ("%~dp0..") do set "RAIZ=%%~fI"
set "PIO=C:\pio\penv\Scripts\platformio.exe"
if not exist "%PIO%" set "PIO=%USERPROFILE%\.platformio\penv\Scripts\platformio.exe"
set "PLATFORMIO_CORE_DIR=C:\pio"

:menu
cls
echo ============================================
echo   PLC32 - bancada
echo ============================================
echo   1 - Gravar ESCUTA (so recebe o RS485)
echo   2 - Monitorar serial (com log)
echo   3 - Gravar ESCUTA e monitorar
echo   4 - Gravar PRODUCAO (MQTT + sensores + RTU)
echo   5 - Sair
echo ============================================
set "OP="
set /p OP=Escolha:

if "%OP%"=="1" call :gravar escuta & goto menu
if "%OP%"=="2" call :monitor & goto menu
if "%OP%"=="3" (
  call :gravar escuta
  if not errorlevel 1 call :monitor
  goto menu
)
if "%OP%"=="4" call :gravar plc32 & goto menu
if "%OP%"=="5" goto fim
goto menu

:porta
rem Porta da PLC32 (CH340 ou CP210) que existe e esta OK agora
set "PORTA="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$n=[System.IO.Ports.SerialPort]::GetPortNames(); $p=(Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match 'CH340|CP210' -and $_.Status -eq 'OK' } | ForEach-Object { if ($_.Name -match '\((COM\d+)\)') { $Matches[1] } } | Where-Object { $n -contains $_ } | Select-Object -First 1); if ($p) { $p }"`) do set "PORTA=%%P"
if "%PORTA%"=="" (
  echo.
  echo PLC32 nao encontrada pela USB. Verifique o cabo e a alimentacao.
  pause
  exit /b 1
)
echo Porta da PLC32: %PORTA%
exit /b 0

:gravar
rem %1 = escuta ou plc32. Grava pelo projeto principal (RAIZ).
call :porta
if errorlevel 1 exit /b 1
echo.
echo Gravando %1 em %PORTA% ...
pushd "%RAIZ%"
"%PIO%" run -e %1 -t upload --upload-port %PORTA%
set "ERR=%errorlevel%"
popd
if not "%ERR%"=="0" (
  echo.
  echo FALHA na gravacao. Se aparecer "Connecting", segure o botao BOOT e tente de novo.
  pause
  exit /b 1
)
echo Gravacao de %1 concluida. A PLC32 reiniciou.
pause
exit /b 0

:monitor
call :porta
if errorlevel 1 exit /b 1
echo.
echo Monitorando %PORTA%. Ctrl+C para sair. Log em scripts\logs.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PASTA%monitor_serial.ps1" -Porta %PORTA%
echo.
pause
exit /b 0

:fim
endlocal
exit /b 0
