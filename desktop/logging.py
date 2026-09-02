# -*- coding: utf-8 -*-
"""Gateway log rotation and diagnostic export for desktop builds."""
from __future__ import annotations

import json
import os
import shutil
import time
import zipfile

from app_paths import app_root

LOG_NAME = "gateway.log"
MAX_LOG_BYTES = 2 * 1024 * 1024
KEEP_ROTATED = 3


def log_path() -> str:
    return os.path.join(app_root(), LOG_NAME)


def rotate_if_needed(path: str | None = None) -> None:
    path = path or log_path()
    if not os.path.isfile(path):
        return
    try:
        if os.path.getsize(path) < MAX_LOG_BYTES:
            return
    except OSError:
        return

    oldest = f"{path}.{KEEP_ROTATED}"
    if os.path.isfile(oldest):
        try:
            os.remove(oldest)
        except OSError:
            pass
    for idx in range(KEEP_ROTATED - 1, 0, -1):
        src = f"{path}.{idx}"
        dst = f"{path}.{idx + 1}"
        if os.path.isfile(src):
            try:
                os.replace(src, dst)
            except OSError:
                shutil.copy2(src, dst)
                try:
                    os.remove(src)
                except OSError:
                    pass
    try:
        os.replace(path, f"{path}.1")
    except OSError:
        return
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"\n--- log rotated {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n")


def _redacted_config() -> dict | None:
    cfg_path = os.path.join(app_root(), "config.json")
    if not os.path.isfile(cfg_path):
        return None
    try:
        with open(cfg_path, "r", encoding="utf-8-sig") as f:
            cfg = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
    for acc in cfg.get("accounts") or []:
        if acc.get("password"):
            acc["password"] = "***"
    return cfg


def export_diagnostics() -> str:
    """Create a zip beside the exe; return path or raise OSError."""
    root = app_root()
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out = os.path.join(root, f"FuturesTerminal-diagnostics-{stamp}.zip")

    try:
        from app_version import GITHUB_REPO, __version__
    except ImportError:
        __version__ = "dev"
        GITHUB_REPO = "shibusama/futures-gateway"

    meta = {
        "version": __version__,
        "github": f"https://github.com/{GITHUB_REPO}",
        "exported_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "app_root": root,
    }

    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("meta.json", json.dumps(meta, ensure_ascii=False, indent=2))
        cfg = _redacted_config()
        if cfg is not None:
            zf.writestr("config.redacted.json", json.dumps(cfg, ensure_ascii=False, indent=2))
        for name in [LOG_NAME] + [f"{LOG_NAME}.{i}" for i in range(1, KEEP_ROTATED + 1)]:
            path = os.path.join(root, name)
            if os.path.isfile(path):
                zf.write(path, arcname=name)
    return out
