@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
set BUILD_NO_PAUSE=1
title 期界 · 正在打包...
echo.
echo  这个窗口会显示完整打包过程（PyInstaller 约 5-10 分钟）
echo  请勿关闭，完成后按任意键退出
echo.
call "%~dp0build_desktop_release.bat"
echo.
echo ============================================
if errorlevel 1 (
  echo  打包失败，请把上面的报错截图发给我
) else (
  echo  打包完成！
  echo  dist\FuturesTerminal\FuturesTerminal.exe
  echo  dist\FuturesTerminal-win64.zip
  if exist "dist\installer\FuturesTerminal-Setup-1.0.11.exe" echo  dist\installer\FuturesTerminal-Setup-1.0.11.exe
)
echo ============================================
pause
