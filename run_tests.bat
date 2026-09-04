@echo off
rem 一键跑全部单测：前端 node --test + 后端 python unittest
cd /d "%~dp0"
echo [1/2] 前端单测 (node --test)
pushd web
call node --test
popd
if errorlevel 1 exit /b 1
echo.
echo [2/2] 后端单测 (python -m unittest)
python -m unittest discover -s backend_tests -v
