# -*- coding: utf-8 -*-
"""Windows 主窗口查找与激活。"""
from __future__ import annotations

import os

_MAIN_TITLE = "期界 · 期货交易终端"


def main_window_exists() -> bool:
    if os.name != "nt":
        return False
    try:
        import ctypes

        hwnd = ctypes.windll.user32.FindWindowW(None, _MAIN_TITLE)
        return bool(hwnd)
    except OSError:
        return False


def activate_main_window() -> bool:
    if os.name != "nt":
        return False
    try:
        import ctypes

        user32 = ctypes.windll.user32
        hwnd = user32.FindWindowW(None, _MAIN_TITLE)
        if not hwnd:
            return False
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        user32.SetForegroundWindow(hwnd)
        return True
    except OSError:
        return False
