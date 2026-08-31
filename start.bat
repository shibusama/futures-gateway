@echo off
cd /d "%~dp0"
echo ============================================
echo  futures-gateway - Local CTP (SimNow) Gateway
echo ============================================
echo.

rem ---- locate python environment (priority order) ----
rem 1) complete project-local .venv (pip.exe present means complete)
rem 2) pre-installed external venv: C:\Users\13191\fg-venv
rem 3) create .venv on the fly

if exist ".venv\Scripts\pip.exe" goto :have_project_venv
if exist "C:\Users\13191\fg-venv\Scripts\python.exe" goto :have_external_venv

echo [first run] creating virtual environment and installing dependencies...
python -m venv .venv
if not exist ".venv\Scripts\pip.exe" (
    echo.
    echo [ERROR] failed to create .venv here. Known Windows issue:
    echo         ensurepip fails when the path contains non-ASCII chars.
    echo         Create a venv manually at an ASCII path, for example:
    echo         python -m venv C:\Users\13191\fg-venv
    echo         C:\Users\13191\fg-venv\Scripts\pip install -r requirements.txt
    echo         then rerun this script.
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
    echo [hint] config.json not found - generated from the example template.
    echo        edit config.json with your SimNow user_id / password and restart.
)
"%PY%" -m gateway.main
pause
