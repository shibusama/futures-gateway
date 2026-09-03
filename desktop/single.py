# -*- coding: utf-8 -*-
"""Windows single-instance guard for packaged desktop app."""
from __future__ import annotations

import os
import sys

_MUTEX_NAME = "Global\\FuturesTerminal.SingleInstance.v1"


def ensure_single_instance() -> bool:
    """Return False if another UI instance is already running (and try to activate it)."""
    if os.name != "nt" or "--gateway-internal" in sys.argv:
        return True
    try:
        import ctypes

        from .win_ui import activate_main_window

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.CreateMutexW(None, False, _MUTEX_NAME)
        already = kernel32.GetLastError() == 183  # ERROR_ALREADY_EXISTS
        if already:
            activated = activate_main_window()
            msg = (
                "期界已在运行，已尝试切换到现有窗口。"
                if activated
                else "期界已在运行中。若看不到窗口，请在任务栏点击期界图标，"
                "或在任务管理器中结束 FuturesTerminal 后重试。"
            )
            ctypes.windll.user32.MessageBoxW(
                None,
                msg,
                "期界 · 期货交易终端",
                0x00000040,
            )
            return False
        globals()["_INSTANCE_MUTEX"] = handle
        return True
    except OSError:
        return True
