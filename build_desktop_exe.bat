@echo off
setlocal enabledelayedexpansion
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

if not exist ".build" mkdir ".build"

REM --- pip：依赖未变则跳过（BUILD_SKIP_PIP=1 强制跳过）---
set "DO_PIP=1"
if defined BUILD_SKIP_PIP set "DO_PIP=0"
if "!DO_PIP!"=="1" if exist ".build\requirements.stamp" (
    fc /b "requirements.txt" ".build\requirements.stamp" >nul 2>&1
    if not errorlevel 1 (
        set "DO_PIP=0"
        echo [skip] requirements.txt unchanged
    )
)
if "!DO_PIP!"=="1" (
    echo Installing dependencies...
    "%PY%" -m pip install -q pyinstaller pywebview -r requirements.txt
    if errorlevel 1 (
        echo [ERROR] pip install failed
        pause
        exit /b 1
    )
    copy /y "requirements.txt" ".build\requirements.stamp" >nul
)

REM --- 图标 / 版本信息：BUILD_SKIP_ASSETS=1 或文件已新则跳过 ---
if defined BUILD_SKIP_ASSETS (
    echo [skip] icon and version_info generation
) else (
    set "GEN_ICON=1"
    if exist "assets\icon.ico" (
        for %%A in ("scripts\generate_icon.py") do set "ICON_SRC=%%~tA"
        for %%B in ("assets\icon.ico") do set "ICON_DST=%%~tB"
        if "!ICON_DST!" geq "!ICON_SRC!" set "GEN_ICON=0"
    )
    if "!GEN_ICON!"=="1" (
        "%PY%" scripts\generate_icon.py
    ) else (
        echo [skip] assets\icon.ico up to date
    )

    set "GEN_VER=1"
    if exist "version_info.txt" (
        for %%A in ("app_version.py") do set "VER_SRC=%%~tA"
        for %%B in ("version_info.txt") do set "VER_DST=%%~tB"
        if "!VER_DST!" geq "!VER_SRC!" set "GEN_VER=0"
    )
    if "!GEN_VER!"=="1" (
        "%PY%" scripts\generate_version_info.py
    ) else (
        echo [skip] version_info.txt up to date
    )
)

echo Running PyInstaller...
"%PY%" -m PyInstaller --noconfirm FuturesTerminal.spec
if errorlevel 1 (
    echo [ERROR] PyInstaller build failed
    pause
    exit /b 1
)

if not exist "config.json" if exist "config.json.example" (
    copy /Y "config.json.example" "dist\FuturesTerminal\config.json.example" >nul
)
if exist "uninstall.bat" (
    copy /Y "uninstall.bat" "dist\FuturesTerminal\uninstall.bat" >nul
)

echo.
echo Done. Run:
echo   dist\FuturesTerminal\FuturesTerminal.exe
echo.
echo Fast rebuild: build_desktop_fast.bat
echo Full release: build_desktop_release.bat
if not defined BUILD_NO_PAUSE pause
