@echo off
cd /d "%~dp0"
echo ============================================
echo  期界 · 桌面版 (PyWebView + 现有 Web UI)
echo ============================================
echo.

if exist ".venv\Scripts\pip.exe" goto :have_project_venv
if exist "C:\Users\13191\fg-venv\Scripts\python.exe" goto :have_external_venv

echo [first run] creating virtual environment and installing dependencies...
python -m venv .venv
if not exist ".venv\Scripts\pip.exe" (
    echo.
    echo [ERROR] failed to create .venv here. Use an ASCII path venv, e.g. C:\Users\13191\fg-venv
    pause
    exit /b 1
)
set "PY=%~dp0.venv\Scripts\python.exe"
"%PY%" -m pip install --upgrade pip
"%PY%" -m pip install -r requirements.txt
goto :run

:have_project_venv
set "PY=%~dp0.venv\Scripts\python.exe"
goto :run

:have_external_venv
set "PY=C:\Users\13191\fg-venv\Scripts\python.exe"

:run
if not exist "config.json" (
    echo [hint] config.json not found - will be created from example on first run.
)
echo [preflight] cleaning up leftover 期界 processes (if any)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'python.exe' -or $_.Name -eq 'pythonw.exe') -and ($_.CommandLine -match 'desktop_app\.py|gateway\.main|--gateway-internal') } | ForEach-Object { Write-Host ('  kill PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
timeout /t 1 /nobreak >nul
"%PY%" desktop_app.py
if errorlevel 1 pause
