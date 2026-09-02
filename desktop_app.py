#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
期界 · 桌面版（PyWebView + 现有 Web UI）

开发：python desktop_app.py  或  run_desktop.bat
打包：build_desktop_exe.bat  →  dist/FuturesTerminal/FuturesTerminal.exe
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time

from app_paths import app_root, bundle_root, setup_runtime_env

ROOT = app_root()
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

GATEWAY_FLAG = "--gateway-internal"
LOG_NAME = "gateway.log"


def _connect_host(bind_host: str) -> str:
    if bind_host in ("0.0.0.0", "::"):
        return "127.0.0.1"
    return bind_host


def port_open(host: str, port: int, timeout: float = 0.4) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def wait_for_port(host: str, port: int, seconds: float = 90.0) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if port_open(host, port):
            return True
        time.sleep(0.25)
    return False


def _gateway_cmd() -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, GATEWAY_FLAG]
    return [sys.executable, "-m", "gateway.main"]


def start_gateway() -> subprocess.Popen[bytes]:
    env = os.environ.copy()
    env["FUTURES_DESKTOP"] = "1"
    env["FUTURES_APP_ROOT"] = app_root()
    env["FUTURES_BUNDLE_ROOT"] = bundle_root()
    log_path = os.path.join(app_root(), LOG_NAME)
    log_file = open(log_path, "a", encoding="utf-8")
    log_file.write(f"\n--- gateway start {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n")
    log_file.flush()
    kwargs: dict = {
        "cwd": app_root(),
        "env": env,
        "stdout": log_file,
        "stderr": subprocess.STDOUT,
    }
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    return subprocess.Popen(_gateway_cmd(), **kwargs)


def stop_gateway(proc: subprocess.Popen[bytes]) -> None:
    if proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=3)


def run_gateway_internal() -> int:
    setup_runtime_env()
    from gateway.main import main as gateway_main

    gateway_main()
    return 0


def run_desktop() -> int:
    setup_runtime_env()

    from desktop_single import ensure_single_instance

    if not ensure_single_instance():
        return 0

    if "--no-update-check" not in sys.argv:
        try:
            from desktop_updater import check_and_prompt

            if check_and_prompt():
                return 0
        except Exception:
            pass

    import webview

    from gateway.config import load_config

    config = load_config()
    bind_host = config.get("host", "127.0.0.1")
    port = int(config.get("port", 8765))
    host = _connect_host(bind_host)
    url = f"http://{host}:{port}"

    gateway_proc: subprocess.Popen[bytes] | None = None
    spawned = False

    if not port_open(host, port):
        gateway_proc = start_gateway()
        spawned = True
        if not wait_for_port(host, port):
            code = gateway_proc.poll()
            log_hint = os.path.join(app_root(), LOG_NAME)
            if code is not None:
                print(f"网关启动失败（退出码 {code}）。详见 {log_hint}")
            else:
                print(f"等待网关超时。详见 {log_hint}")
            stop_gateway(gateway_proc)
            return 1

    window = webview.create_window(
        "期界 · 期货交易终端",
        url,
        width=1280,
        height=820,
        min_size=(960, 640),
    )

    try:
        webview.start()
    finally:
        if spawned and gateway_proc is not None:
            stop_gateway(gateway_proc)

    return 0


def main() -> int:
    if "--check-update" in sys.argv:
        from desktop_updater import check_only

        return check_only()
    if GATEWAY_FLAG in sys.argv:
        return run_gateway_internal()
    return run_desktop()


if __name__ == "__main__":
    raise SystemExit(main())
