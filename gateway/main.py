# -*- coding: utf-8 -*-
"""
futures-gateway 入口：
1. 读取 config.json（不存在则生成模板）
2. 启动多账号 CTP（SimNow）连接
3. 启动 aiohttp Web 服务（前端 + WebSocket）
"""
import os
import socket
import subprocess
import time

from .config import load_config
from .account_mgr import AccountManager
from .server import run_server


def _port_is_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind((host, port))
            return True
        except OSError as exc:
            if exc.errno in (10048, 48, 98):
                return False
            raise


def _find_listener_pid(port: int) -> int | None:
    """查找监听指定端口的进程 PID（Windows netstat）。"""
    try:
        out = subprocess.check_output(["netstat", "-ano"], text=True, errors="replace")
    except (OSError, subprocess.CalledProcessError):
        return None
    suffix = f":{port}"
    for line in out.splitlines():
        if "LISTENING" not in line or suffix not in line:
            continue
        parts = line.split()
        if len(parts) < 5 or not parts[1].endswith(suffix):
            continue
        try:
            pid = int(parts[-1])
        except ValueError:
            continue
        if pid > 0 and pid != os.getpid():
            return pid
    return None


def _kill_pid(pid: int) -> bool:
    if pid <= 0 or pid == os.getpid():
        return False
    if os.name == "nt":
        r = subprocess.run(
            ["taskkill", "/PID", str(pid), "/F"],
            capture_output=True,
            text=True,
        )
        return r.returncode == 0
    try:
        os.kill(pid, 15)
        return True
    except OSError:
        return False


def _ensure_port_free(host: str, port: int) -> None:
    """启动前确保 Web 端口可用；若被旧网关占用则自动结束该进程。"""
    if _port_is_free(host, port):
        return

    pid = _find_listener_pid(port)
    if pid:
        print(f" [提示] 端口 {port} 已被进程 {pid} 占用，正在关闭旧实例…")
        if _kill_pid(pid):
            time.sleep(1.5)
            if _port_is_free(host, port):
                print(" [提示] 旧实例已关闭，继续启动。")
                return

    url = f"http://{host}:{port}"
    print(f"\n [错误] 端口 {port} 仍被占用，无法启动。")
    print(f"        · 若已有网关在跑，可直接访问：{url}")
    print("        · 或手动结束占用该端口的进程后再试")
    raise SystemExit(1)


def main():
    config = load_config()
    host = config.get("host", "127.0.0.1")
    port = int(config.get("port", 8765))
    _ensure_port_free(host, port)

    print("=" * 56)
    print(" futures-gateway · 本地 CTP(SimNow) 网关")
    print("=" * 56)
    print(f" 网页地址  : http://{host}:{port}")
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