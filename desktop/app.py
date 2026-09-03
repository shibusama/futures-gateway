#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
期界 · 桌面版（PyWebView + 现有 Web UI）—— 桌面壳实现（desktop/ 包内）

入口：根目录薄启动器 desktop_app.py（from desktop.app import main）
开发：python desktop_app.py  或  run_desktop.bat
打包：build_desktop_exe.bat  →  dist/FuturesTerminal/FuturesTerminal.exe
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

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


def _loading_url() -> str:
    path = os.path.join(bundle_root(), "web", "loading.html")
    return urllib.parse.urljoin("file:", urllib.request.pathname2url(os.path.abspath(path)))


def start_gateway() -> subprocess.Popen[bytes]:
    from .logging import log_path, rotate_if_needed
    from .win_job import assign_kill_on_job_close

    rotate_if_needed(log_path())
    env = os.environ.copy()
    env["FUTURES_DESKTOP"] = "1"
    env["FUTURES_APP_ROOT"] = app_root()
    env["FUTURES_BUNDLE_ROOT"] = bundle_root()
    log_file_path = log_path()
    log_file = open(log_file_path, "a", encoding="utf-8")
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
    proc = subprocess.Popen(_gateway_cmd(), **kwargs)
    assign_kill_on_job_close(proc)
    return proc


def _find_listener_pid(port: int) -> int | None:
    from gateway.main import _find_listener_pid as find_pid

    return find_pid(port)


def _kill_pid(pid: int) -> bool:
    from gateway.main import _kill_pid as kill_pid

    return kill_pid(pid)


def _process_command_line(pid: int) -> str:
    if pid <= 0:
        return ""
    if os.name == "nt":
        try:
            result = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    f"(Get-CimInstance Win32_Process -Filter 'ProcessId={pid}').CommandLine",
                ],
                capture_output=True,
                text=True,
                timeout=5,
            )
            return (result.stdout or "").strip()
        except (OSError, subprocess.TimeoutExpired):
            return ""
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return f.read().decode("utf-8", errors="replace").replace("\x00", " ")
    except OSError:
        return ""


def _is_our_gateway(pid: int) -> bool:
    cmd = _process_command_line(pid).lower()
    return "gateway.main" in cmd or "--gateway-internal" in cmd


def shutdown_local_gateway(port: int) -> None:
    """结束本机期界网关（子进程或端口监听进程）。"""
    listener = _find_listener_pid(port)
    if listener and _is_our_gateway(listener):
        _kill_pid(listener)


def _cleanup_zombie_gateway(host: str, port: int) -> bool:
    """界面已关、仅网关残留时提示清理。返回 False 表示用户取消启动。"""
    from .dialog import ask_yes_no
    from .win_ui import main_window_exists

    if not port_open(host, port):
        return True
    listener = _find_listener_pid(port)
    if not listener or not _is_our_gateway(listener):
        return True
    if main_window_exists():
        return True
    restart = ask_yes_no(
        "检测到期界后台仍在运行，但主窗口已关闭（残留进程）。\n\n"
        "选择「是」：关闭残留后台并正常启动。\n"
        "选择「否」：取消本次启动。",
        "期界 · 残留进程",
    )
    if not restart:
        return False
    _kill_pid(listener)
    time.sleep(1.0)
    if port_open(host, port):
        from .dialog import show_message

        show_message(
            f"残留进程未能完全关闭，端口 {port} 仍被占用。\n\n请手动结束进程 {listener} 后重试。",
            "期界 · 残留进程",
            error=True,
        )
        return False
    return True


def stop_gateway(proc: subprocess.Popen[bytes], *, port: int | None = None) -> None:
    """Stop gateway subprocess; on Windows CTP may ignore terminate(), so force-kill."""
    pid = proc.pid
    if proc.poll() is None:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/F", "/T"],
                capture_output=True,
                text=True,
            )
        else:
            proc.terminate()
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=3)

    if port is not None:
        listener = _find_listener_pid(port)
        if listener and listener in {pid, proc.pid}:
            _kill_pid(listener)


def _log_path() -> str:
    from .logging import log_path

    return log_path()


def _show_startup_failure(reason: str) -> None:
    from .dialog import format_startup_failure, show_message

    show_message(format_startup_failure(reason, _log_path()), "期界 · 启动失败", error=True)


def _resolve_port_conflict(host: str, port: int) -> str:
    from .dialog import ask_yes_no, show_message

    listener = _find_listener_pid(port)
    if listener is None:
        show_message(
            f"端口 {port} 已被占用，但无法识别占用进程。\n\n"
            "请关闭占用该端口的程序，或在 config.json 中修改 port 后重试。",
            "期界 · 端口占用",
            error=True,
        )
        return "abort"

    if not _is_our_gateway(listener):
        show_message(
            f"端口 {port} 已被其他程序占用（进程 {listener}）。\n\n"
            f"命令行：{_process_command_line(listener) or '未知'}\n\n"
            "期界无法启动。请结束该进程，或修改 config.json 中的 port。",
            "期界 · 端口占用",
            error=True,
        )
        return "abort"

    restart = ask_yes_no(
        f"检测到本机已有期界网关在运行（端口 {port}，进程 {listener}）。\n\n"
        "选择「是」：关闭旧网关并重新启动（推荐）。\n"
        "选择「否」：连接现有网关（退出期界时会一并关闭网关）。",
        "期界 · 端口占用",
    )
    if restart:
        _kill_pid(listener)
        time.sleep(1.5)
        if port_open(host, port):
            show_message(
                f"旧网关未能完全关闭，端口 {port} 仍被占用。\n\n请手动结束进程 {listener} 后重试。",
                "期界 · 端口占用",
                error=True,
            )
            return "abort"
        return "spawn"
    return "attach"


def _ensure_account_config(force_setup: bool = False) -> bool:
    from .dialog import show_message
    from .setup import config_needs_setup, run_setup_wizard

    if not force_setup and not config_needs_setup():
        return True
    if not run_setup_wizard():
        if config_needs_setup():
            show_message(
                "尚未完成 SimNow 账号配置，无法启动。\n\n请重新打开程序并完成首次配置。",
                "期界 · 首次配置",
                error=True,
            )
            return False
    return not config_needs_setup()


def run_gateway_internal() -> int:
    setup_runtime_env()
    from gateway.main import main as gateway_main

    gateway_main()
    return 0


def run_desktop() -> int:
    setup_runtime_env()

    from .single import ensure_single_instance

    if not ensure_single_instance():
        return 0

    force_setup = "--setup" in sys.argv
    if not _ensure_account_config(force_setup=force_setup):
        return 1

    if "--no-update-check" not in sys.argv:
        try:
            from .updater import check_and_prompt

            if check_and_prompt():
                return 0
        except Exception:
            pass

    import webview

    from .api import DesktopApi
    from .logging import rotate_if_needed
    from .menu import build_menu
    from .runtime import DesktopRuntime
    from .tray import TrayController
    from gateway.config import load_config

    rotate_if_needed(_log_path())

    runtime = DesktopRuntime()
    config = load_config()
    bind_host = config.get("host", "127.0.0.1")
    port = int(config.get("port", 8765))
    host = _connect_host(bind_host)
    main_url = f"http://{host}:{port}"
    runtime.host = host
    runtime.port = port

    if not _cleanup_zombie_gateway(host, port):
        return 1

    if port_open(host, port):
        action = _resolve_port_conflict(host, port)
        if action == "abort":
            return 1
        if action == "spawn":
            runtime.gateway_proc = start_gateway()
            runtime.spawned = True
    else:
        runtime.gateway_proc = start_gateway()
        runtime.spawned = True

    api = DesktopApi()

    def reload_gateway_after_config_save() -> None:
        if runtime.spawned and runtime.gateway_proc is not None:
            stop_gateway(runtime.gateway_proc, port=port)
        else:
            listener = _find_listener_pid(port)
            if listener and _is_our_gateway(listener):
                _kill_pid(listener)
                time.sleep(1.0)
        runtime.gateway_proc = start_gateway()
        runtime.spawned = True
        if not wait_for_port(host, port, 90.0):
            raise OSError(f"网关重启后端口 {port} 未就绪")

    window = webview.create_window(
        "期界 · 期货交易终端",
        _loading_url(),
        width=1280,
        height=820,
        min_size=(960, 640),
        js_api=api,
        confirm_close=False,
    )
    api.bind(
        window,
        main_url,
        quit_callback=runtime.request_quit,
        reload_gateway=reload_gateway_after_config_save,
    )
    runtime.window = window
    runtime.api = api
    window.events.closing += runtime.on_closing

    runtime.tray = TrayController(on_show=runtime.show_window, on_quit=runtime.request_quit)
    runtime.tray.start()

    def boot_main_ui() -> None:
        if runtime.spawned:
            if not wait_for_port(host, port):
                code = runtime.gateway_proc.poll() if runtime.gateway_proc else None
                if code is not None:
                    _show_startup_failure(f"网关进程已退出（退出码 {code}）。")
                else:
                    _show_startup_failure("等待网关启动超时。")
                if runtime.gateway_proc is not None:
                    stop_gateway(runtime.gateway_proc, port=port)
                runtime.request_quit()
                return
        try:
            window.load_url(f"{main_url.rstrip('/')}/loading.html")
        except Exception:
            _show_startup_failure("无法打开登录界面，请检查网关是否正常运行。")
            runtime.request_quit()

    threading.Thread(target=boot_main_ui, daemon=True).start()

    try:
        webview.start(menu=build_menu(runtime))
    finally:
        if runtime.tray is not None:
            runtime.tray.stop()
        if runtime.spawned and runtime.gateway_proc is not None:
            stop_gateway(runtime.gateway_proc, port=port)
        if runtime.quitting:
            shutdown_local_gateway(port)

    return 0


def main() -> int:
    if "--check-update" in sys.argv:
        from .updater import check_only

        return check_only()
    if GATEWAY_FLAG in sys.argv:
        return run_gateway_internal()
    return run_desktop()
