# -*- coding: utf-8 -*-
"""Shared desktop shell runtime state and menu actions."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import subprocess

    from .api import DesktopApi
    from .tray import TrayController


class DesktopRuntime:
    def __init__(self) -> None:
        self.quitting = False
        self.window: Any = None
        self.api: DesktopApi | None = None
        self.tray: TrayController | None = None
        self.gateway_proc: subprocess.Popen[bytes] | None = None
        self.spawned = False
        self.port = 8765
        self.host = "127.0.0.1"

    def hide_to_tray(self) -> None:
        if self.window is not None:
            try:
                self.window.hide()
            except Exception:
                pass
        if self.tray is not None:
            self.tray.notify("已隐藏到系统托盘。菜单或托盘选择「退出」可完全关闭。")

    def show_window(self) -> None:
        if self.window is None:
            return
        try:
            self.window.show()
            self.window.restore()
        except Exception:
            pass

    def request_quit(self) -> None:
        self.quitting = True
        if self.tray is not None:
            self.tray.stop()
        if self.window is not None:
            try:
                self.window.destroy()
            except Exception:
                pass

    def on_closing(self, window: Any) -> bool:
        if self.quitting:
            return True
        if self.window is not None:
            try:
                self.window.minimize()
            except Exception:
                pass
        return False

    def show_about(self) -> None:
        if self.window is None:
            return
        try:
            self.window.evaluate_js("document.getElementById('about-btn')?.click()")
        except Exception:
            pass

    def reload_page(self) -> None:
        if self.window is None:
            return
        try:
            self.window.evaluate_js(
                "window.__fgSoftRefresh ? window.__fgSoftRefresh() : location.reload()"
            )
        except Exception:
            pass

    def stop_gateway_now(self) -> int | None:
        """安装更新前调用：同步停掉网关子进程，返回其 PID（供落地脚本兜底等待）。

        更新落地时会把整个安装目录 rename 走再换上新版本；如果网关子进程
        （单独一个 --gateway-internal 进程，加载着同一批 CTP SDK / 运行时 DLL）
        还活着，安装目录里的文件会被占用导致更新失败。这里显式提前停掉它，
        不依赖窗口关闭后 webview 事件循环退出这条间接路径。
        """
        from .app import _find_listener_pid, _is_our_gateway, _kill_pid, stop_gateway

        if self.spawned and self.gateway_proc is not None:
            pid = self.gateway_proc.pid
            try:
                stop_gateway(self.gateway_proc, port=self.port)
            except Exception:
                pass
            self.gateway_proc = None
            self.spawned = False
            return pid

        try:
            listener = _find_listener_pid(self.port)
        except Exception:
            listener = None
        if listener and _is_our_gateway(listener):
            try:
                _kill_pid(listener)
            except Exception:
                pass
            return listener
        return None

    def check_updates(self) -> None:
        try:
            from .updater import check_and_prompt

            if check_and_prompt(gateway_stop=self.stop_gateway_now):
                self.request_quit()
        except Exception:
            pass

    def export_diagnostics(self) -> None:
        from .dialog import show_message
        from .logging import export_diagnostics

        try:
            path = export_diagnostics()
            show_message(f"诊断包已导出：\n{path}", "期界 · 诊断")
        except OSError as exc:
            show_message(f"导出失败：{exc}", "期界 · 诊断", error=True)

    def open_account_setup(self) -> None:
        if self.api is not None:
            self.api.open_account_setup()

    def uninstall_app(self) -> None:
        from .uninstall import run_uninstall

        run_uninstall(after_launch=self.request_quit)
