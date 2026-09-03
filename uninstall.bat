@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  期界 · 卸载（绿色版）
echo ============================================
echo.
echo 请先退出期界（含系统托盘），再按任意键继续...
pause >nul
taskkill /F /IM FuturesTerminal.exe >nul 2>&1
timeout /t 2 /nobreak >nul
set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
start "" /min cmd /c "timeout /t 2 /nobreak >nul & rd /s /q \"%HERE%\" & msg * 期界已卸载。 & exit"
echo 卸载程序已在后台运行，本窗口即将关闭...
timeout /t 2 /nobreak >nul
