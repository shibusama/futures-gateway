@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  futures-gateway · 本地 CTP (SimNow) 网关
echo ============================================
echo.
if not exist ".venv" (
    echo [首次运行] 创建虚拟环境并安装依赖...
    python -m venv .venv
    call .venv\Scripts\activate.bat
    pip install -r requirements.txt
) else (
    call .venv\Scripts\activate.bat
)
echo.
if not exist "config.json" (
    echo [提示] 未发现 config.json，已从示例模板生成。
    echo        请编辑 config.json 填入 SimNow 资金账号和密码后重启。
)
python -m gateway.main
pause