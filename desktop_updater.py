# -*- coding: utf-8 -*-
"""Check GitHub Releases and apply full-folder updates for PyWebView desktop."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile

from app_paths import app_root, is_frozen
from app_version import GITHUB_REPO, RELEASE_TAG_PREFIX, UPDATE_ASSET_NAME, __version__


def parse_version(text: str) -> tuple[int, ...]:
    m = re.search(r"(\d+(?:\.\d+)*)", text or "")
    if not m:
        return (0,)
    return tuple(int(x) for x in m.group(1).split("."))


def current_version() -> tuple[int, ...]:
    return parse_version(__version__)


def _api_url() -> str:
    return f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"


def _fetch_latest_release() -> dict | None:
    req = urllib.request.Request(
        _api_url(),
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "FuturesTerminal-Updater",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None


def _pick_asset(release: dict) -> dict | None:
    for asset in release.get("assets") or []:
        if asset.get("name") == UPDATE_ASSET_NAME:
            return asset
    return None


def find_update() -> dict | None:
    """Return {version, tag, url, notes} if a newer release exists."""
    if not is_frozen():
        return None
    release = _fetch_latest_release()
    if not release:
        return None
    tag = release.get("tag_name") or ""
    if RELEASE_TAG_PREFIX and not tag.startswith(RELEASE_TAG_PREFIX):
        return None
    remote_ver = parse_version(tag)
    if remote_ver <= current_version():
        return None
    asset = _pick_asset(release)
    if not asset or not asset.get("browser_download_url"):
        return None
    ver_label = ".".join(str(x) for x in remote_ver)
    return {
        "version": ver_label,
        "tag": tag,
        "url": asset["browser_download_url"],
        "notes": (release.get("body") or "").strip(),
    }


def _message_box(text: str, title: str, yes_no: bool = True) -> bool:
    if os.name != "nt":
        print(title, text)
        return False
    import ctypes

    flags = 0x00000024 if yes_no else 0x00000040  # MB_YESNO|MB_ICONQUESTION or MB_ICONINFORMATION
    rc = ctypes.windll.user32.MessageBoxW(None, text, title, flags)
    return rc == 6  # IDYES


def _download(url: str, dest: str) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "FuturesTerminal-Updater"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(dest, "wb") as out:
        shutil.copyfileobj(resp, out)


def _apply_update(staging_dir: str) -> None:
    app = app_root()
    exe_path = os.path.join(app, "FuturesTerminal.exe")
    bat_path = os.path.join(tempfile.gettempdir(), "futures_terminal_apply_update.bat")
    staging = staging_dir.replace('"', "")
    app_q = app.replace('"', "")
    exe_q = exe_path.replace('"', "")
    bat = f"""@echo off
chcp 65001 >nul
timeout /t 2 /nobreak >nul
robocopy "{staging}" "{app_q}" /E /IS /IT /NFL /NDL /NJH /NJS /R:2 /W:1
if %ERRORLEVEL% GEQ 8 exit /b 1
start "" "{exe_q}"
del "%~f0"
"""
    with open(bat_path, "w", encoding="utf-8") as f:
        f.write(bat)
    subprocess.Popen(
        ["cmd.exe", "/c", bat_path],
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        close_fds=True,
    )


def run_update(info: dict) -> None:
    work = os.path.join(os.environ.get("LOCALAPPDATA", tempfile.gettempdir()), "FuturesTerminal", "update")
    os.makedirs(work, exist_ok=True)
    zip_path = os.path.join(work, "pending.zip")
    staging = os.path.join(work, "staging")
    if os.path.isdir(staging):
        shutil.rmtree(staging, ignore_errors=True)
    os.makedirs(staging, exist_ok=True)

    _download(info["url"], zip_path)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(staging)

    # zip may contain a top-level FuturesTerminal/ folder
    entries = os.listdir(staging)
    if len(entries) == 1:
        only = os.path.join(staging, entries[0])
        if os.path.isdir(only) and os.path.isfile(os.path.join(only, "FuturesTerminal.exe")):
            staging = only

    _apply_update(staging)


def check_and_prompt(silent: bool = False) -> bool:
    """
    If update available, prompt user. Returns True when app should exit (update scheduled).
    """
    if "--no-update-check" in sys.argv:
        return False
    info = find_update()
    if not info:
        return False
    notes = info["notes"]
    if len(notes) > 280:
        notes = notes[:280] + "…"
    body = (
        f"发现新版本 v{info['version']}（当前 v{__version__}）。\n\n"
        f"是否现在下载并安装？安装时会自动重启程序。\n"
    )
    if notes:
        body += f"\n更新说明：\n{notes}\n"
    if silent:
        return False
    if not _message_box(body, "期界 · 检查更新", yes_no=True):
        return False
    try:
        run_update(info)
        _message_box("正在更新，程序即将退出并自动重启。", "期界 · 更新", yes_no=False)
        return True
    except OSError as exc:
        _message_box(f"更新失败：{exc}", "期界 · 更新", yes_no=False)
        return False


def check_only() -> int:
    info = find_update()
    if not info:
        print(f"已是最新版本 v{__version__}")
        return 0
    print(f"有新版本 v{info['version']}（当前 v{__version__}）")
    print(f"下载：{info['url']}")
    return 1
