# -*- coding: utf-8 -*-
"""Native application menu for PyWebView desktop."""
from __future__ import annotations

from typing import TYPE_CHECKING

from webview.menu import Menu, MenuAction, MenuSeparator

if TYPE_CHECKING:
    from .runtime import DesktopRuntime


def build_menu(runtime: "DesktopRuntime") -> list[Menu]:
    return [
        Menu(
            "文件",
            [
                MenuAction("隐藏到托盘", runtime.hide_to_tray),
                MenuSeparator(),
                MenuAction("退出", runtime.request_quit),
            ],
        ),
        Menu(
            "帮助",
            [
                MenuAction("关于", runtime.show_about),
                MenuAction("检查更新", runtime.check_updates),
                MenuAction("导出诊断包", runtime.export_diagnostics),
                MenuSeparator(),
                MenuAction("账号配置", runtime.open_account_setup),
            ],
        ),
    ]
