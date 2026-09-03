@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
echo ============================================
echo  Build FuturesTerminal release (exe + zip + setup)
echo ============================================
echo.

if exist ".venv\Scripts\pip.exe" (
    set "PY=%~dp0.venv\Scripts\python.exe"
) else if exist "C:\Users\13191\fg-venv\Scripts\python.exe" (
    set "PY=C:\Users\13191\fg-venv\Scripts\python.exe"
) else (
    set "PY=python"
)

"%PY%" -c "from app_version import __version__; print(__version__)" > "%TEMP%\fg_appver.txt"
set /p APP_VER=<"%TEMP%\fg_appver.txt"
echo Version: !APP_VER!
echo.

set "BUILD_NO_PAUSE=1"
echo.
echo Tip: daily dev builds can use build_desktop_fast.bat ^(skip pip/zip/setup^)
echo.
call "%~dp0build_desktop_exe.bat"
if errorlevel 1 exit /b 1

set "DIST=dist\FuturesTerminal"
set "ZIP=dist\FuturesTerminal-win64.zip"
if not exist "%DIST%\FuturesTerminal.exe" (
    echo [ERROR] missing %DIST%\FuturesTerminal.exe
    exit /b 1
)

echo Creating %ZIP% ...
powershell -NoProfile -Command "if (Test-Path '%ZIP%') { Remove-Item '%ZIP%' -Force }; Compress-Archive -Path '%DIST%\*' -DestinationPath '%ZIP%' -Force"
if errorlevel 1 (
    echo [ERROR] failed to create zip
    exit /b 1
)

echo.
echo SHA256 for update manifest:
certutil -hashfile "%ZIP%" SHA256 | findstr /v "hash"
echo Paste into update_manifest.json when hosting updates publicly.
echo.

set "ISCC="
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if exist "C:\Program Files\Inno Setup 6\ISCC.exe" set "ISCC=C:\Program Files\Inno Setup 6\ISCC.exe"

if defined ISCC (
    echo Building installer with Inno Setup ...
    "%ISCC%" /DMyAppVersion="!APP_VER!" "%~dp0installer\FuturesTerminal.iss"
    if errorlevel 1 (
        echo [ERROR] Inno Setup failed
        exit /b 1
    )
    echo.
    echo Installer: dist\installer\FuturesTerminal-Setup-!APP_VER!.exe
) else (
    echo [hint] Inno Setup not found — skipped .exe installer. Install from:
    echo        https://jrsoftware.org/isinfo.php
    echo        Then re-run this script for FuturesTerminal-Setup-!APP_VER!.exe
)

echo.
echo Artifacts:
echo   dist\FuturesTerminal\FuturesTerminal.exe
echo   %ZIP%
if exist "dist\installer\FuturesTerminal-Setup-!APP_VER!.exe" (
    echo   dist\installer\FuturesTerminal-Setup-!APP_VER!.exe
)
echo.
echo Publish to GitHub Release ^(manual^):
echo   git tag desktop-v!APP_VER!
echo   git push origin desktop-v!APP_VER!
echo   gh release create desktop-v!APP_VER! "%ZIP%" "dist\installer\FuturesTerminal-Setup-!APP_VER!.exe" --title "Desktop v!APP_VER!"
echo.
echo Publish to Aliyun OSS ^(国内加速, see docs/oss-release-setup.md^):
echo   pip install oss2
echo   python scripts/publish_oss_release.py --notes "更新说明"
echo.
pause
