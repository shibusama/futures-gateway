# -*- coding: utf-8 -*-
"""Resolve install dir vs PyInstaller bundle dir."""
from __future__ import annotations

import os
import sys


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def app_root() -> str:
    """Writable dir: config.json / flow/ live next to the exe when packaged."""
    if is_frozen():
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def bundle_root() -> str:
    """Read-only bundled assets (web/, etc.)."""
    if is_frozen():
        return getattr(sys, "_MEIPASS", app_root())
    return app_root()


def setup_runtime_env() -> None:
    os.environ["FUTURES_APP_ROOT"] = app_root()
    os.environ["FUTURES_BUNDLE_ROOT"] = bundle_root()
    if is_frozen():
        os.chdir(app_root())
