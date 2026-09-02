# -*- coding: utf-8 -*-
"""Windows single-instance guard for packaged desktop app."""
from __future__ import annotations

import os
import sys

_MUTEX_NAME = "Global\\FuturesTerminal.SingleInstance.v1"


def ensure_single_instance() -> bool:
    """Return False if another instance is already running."""
    if os.name != "nt" or "--gateway-internal" in sys.argv:
        return True
    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.CreateMutexW(None, False, _MUTEX_NAME)
        already = kernel32.GetLastError() == 183  # ERROR_ALREADY_EXISTS
        if already:
            ctypes.windll.user32.MessageBoxW(
                None,
                "期界桌面版已在运行中。",
                "期界 · 期货交易终端",
                0x00000040,
            )
            return False
        # keep handle alive for process lifetime
        globals()["_INSTANCE_MUTEX"] = handle
        return True
    except OSError:
        return True
