@echo off
cd /d "%~dp0"
echo.
echo  Web UI 对比模式（不连 Python 网关）
echo  浏览器将打开: http://127.0.0.1:5173/?offline=1
echo  按 Ctrl+C 停止
echo.
start "" "http://127.0.0.1:5173/?offline=1"
python -m http.server 5173
