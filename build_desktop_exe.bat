@echo off
cd /d "%~dp0"
echo ============================================
echo  Build FuturesTerminal.exe (PyWebView)
echo ============================================
echo.

if exist ".venv\Scripts\pip.exe" (
    set "PY=%~dp0.venv\Scripts\python.exe"
) else if exist "C:\Users\13191\fg-venv\Scripts\python.exe" (
    set "PY=C:\Users\13191\fg-venv\Scripts\python.exe"
) else (
    set "PY=python"
)

"%PY%" -m pip install -q pyinstaller pywebview -r requirements.txt
if errorlevel 1 (
    echo [ERROR] pip install failed
    pause
    exit /b 1
)

"%PY%" -m PyInstaller --noconfirm FuturesTerminal.spec
if errorlevel 1 (
    echo [ERROR] PyInstaller build failed
    pause
    exit /b 1
)

if not exist "config.json" if exist "config.json.example" (
    copy /Y "config.json.example" "dist\FuturesTerminal\config.json.example" >nul
)

echo.
echo Done. Run:
echo   dist\FuturesTerminal\FuturesTerminal.exe
echo.
echo Put config.json next to the exe (copy from config.json.example).
if not defined BUILD_NO_PAUSE pause
