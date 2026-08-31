# -*- coding: utf-8 -*-
"""
futures-gateway 入口：
1. 读取 config.json（不存在则生成模板）
2. 启动多账号 CTP（SimNow）连接
3. 启动 aiohttp Web 服务（前端 + WebSocket）
"""
import threading

from .config import load_config
from .account_mgr import AccountManager
from .server import run_server


def main():
    config = load_config()
    print("=" * 56)
    print(" futures-gateway · 本地 CTP(SimNow) 网关")
    print("=" * 56)
    print(f" 网页地址  : http://{config.get('host','127.0.0.1')}:{config.get('port',8765)}")
    print(f" 配置账号  : {len(config.get('accounts', []))} 个")

    mgr = AccountManager(config)
    result = mgr.start()
    if not result.get("ok"):
        print(f" [启动提示] {result.get('msg', '')}")
        print(" 请先编辑 config.json 填写 SimNow 资金账号/密码，再重启。")

    try:
        run_server(mgr, config)
    except KeyboardInterrupt:
        print("\n 已停止。")


if __name__ == "__main__":
    main()