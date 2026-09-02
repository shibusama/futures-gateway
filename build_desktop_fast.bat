@echo off
REM 快速打包：跳过 pip / 图标生成，仅 PyInstaller（约 1~2 分钟）
REM 发版请用 build_desktop_release.bat
cd /d "%~dp0"
set BUILD_SKIP_PIP=1
set BUILD_SKIP_ASSETS=1
set BUILD_NO_PAUSE=1
call "%~dp0build_desktop_exe.bat"
