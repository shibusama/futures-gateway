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
            self.tray.notify("已隐藏到系统托盘。右键图标选择「退出」可完全关闭。")

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
        if self.tray is not None and self.tray.active:
            self.hide_to_tray()
        elif self.window is not None:
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

    def check_updates(self) -> None:
        try:
            from .updater import check_and_prompt

            if check_and_prompt():
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
