# -*- coding: utf-8 -*-
"""Windows title bar dark/light mode (DWM immersive dark mode)."""
from __future__ import annotations

import ctypes
import os
import winreg
from ctypes import wintypes
from typing import Any

DWMWA_USE_IMMERSIVE_DARK_MODE = 20
DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1 = 19

_dwmapi = ctypes.WinDLL("dwmapi", use_last_error=True) if os.name == "nt" else None


def system_prefers_dark() -> bool:
    if os.name != "nt":
        return False
    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
        ) as key:
            value, _ = winreg.QueryValueEx(key, "AppsUseLightTheme")
            return int(value) == 0
    except OSError:
        return False


def _hwnd(window: Any) -> int | None:
    native = getattr(window, "native", None)
    if native is None:
        return None
    try:
        return int(native.Handle.ToInt32())
    except Exception:
        return None


def apply_titlebar_theme(window: Any, *, dark: bool) -> bool:
    """Toggle native Windows caption to dark or light mode."""
    if _dwmapi is None:
        return False
    hwnd = _hwnd(window)
    if hwnd is None:
        return False
    value = ctypes.c_int(1 if dark else 0)
    ok = False
    for attr in (DWMWA_USE_IMMERSIVE_DARK_MODE, DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1):
        try:
            rc = _dwmapi.DwmSetWindowAttribute(
                wintypes.HWND(hwnd),
                wintypes.DWORD(attr),
                ctypes.byref(value),
                ctypes.sizeof(value),
            )
            if rc == 0:
                ok = True
        except OSError:
            pass
    return ok
