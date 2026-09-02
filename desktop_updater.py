# -*- coding: utf-8 -*-
"""Check public manifest / GitHub Releases and apply verified desktop updates."""
from __future__ import annotations

import hashlib
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
from app_version import (
    GITHUB_REPO,
    RELEASE_TAG_PREFIX,
    UPDATE_ASSET_NAME,
    UPDATE_MANIFEST_URL,
    __version__,
)


def parse_version(text: str) -> tuple[int, ...]:
    m = re.search(r"(\d+(?:\.\d+)*)", text or "")
    if not m:
        return (0,)
    return tuple(int(x) for x in m.group(1).split("."))


def current_version() -> tuple[int, ...]:
    return parse_version(__version__)


def _fetch_json(url: str, timeout: float = 12.0) -> dict | None:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "FuturesTerminal-Updater",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError, ValueError):
        return None


def _api_url() -> str:
    return f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"


def _pick_asset(release: dict) -> dict | None:
    for asset in release.get("assets") or []:
        if asset.get("name") == UPDATE_ASSET_NAME:
            return asset
    return None


def _info_from_manifest(data: dict) -> dict | None:
    version = (data.get("version") or "").strip()
    url = (data.get("url") or "").strip()
    if not version or not url:
        return None
    remote_ver = parse_version(version)
    if remote_ver <= current_version():
        return None
    return {
        "version": ".".join(str(x) for x in remote_ver),
        "tag": data.get("tag") or f"{RELEASE_TAG_PREFIX}{version}",
        "url": url,
        "sha256": (data.get("sha256") or "").strip().lower(),
        "notes": (data.get("notes") or "").strip(),
        "source": "manifest",
    }


def _info_from_github(release: dict) -> dict | None:
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
        "sha256": "",
        "notes": (release.get("body") or "").strip(),
        "source": "github",
    }


def find_update() -> dict | None:
    """Return update info if a newer release exists."""
    if not is_frozen():
        return None

    manifest_url = (UPDATE_MANIFEST_URL or os.environ.get("FUTURES_UPDATE_MANIFEST_URL") or "").strip()
    if manifest_url:
        manifest = _fetch_json(manifest_url)
        if manifest:
            info = _info_from_manifest(manifest)
            if info:
                return info

    release = _fetch_json(_api_url())
    if not release:
        return None
    return _info_from_github(release)


def _download(url: str, dest: str) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "FuturesTerminal-Updater"})
    with urllib.request.urlopen(req, timeout=180) as resp, open(dest, "wb") as out:
        shutil.copyfileobj(resp, out)


def _sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest().lower()


def _verify_download(path: str, expected: str) -> None:
    if not expected:
        return
    actual = _sha256_file(path)
    if actual != expected.lower():
        raise OSError(f"更新包校验失败（SHA256 不匹配）。\n期望：{expected}\n实际：{actual}")


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
    _verify_download(zip_path, info.get("sha256") or "")

    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(staging)

    entries = os.listdir(staging)
    if len(entries) == 1:
        only = os.path.join(staging, entries[0])
        if os.path.isdir(only) and os.path.isfile(os.path.join(only, "FuturesTerminal.exe")):
            staging = only

    _apply_update(staging)


def check_and_prompt(silent: bool = False) -> bool:
    """If update available, prompt user. Returns True when app should exit."""
    if "--no-update-check" in sys.argv:
        return False
    info = find_update()
    if not info:
        return False
    notes = info["notes"]
    if len(notes) > 280:
        notes = notes[:280] + "…"
    source_hint = ""
    if info.get("source") == "manifest":
        source_hint = "\n（更新源：公开清单）"
    body = (
        f"发现新版本 v{info['version']}（当前 v{__version__}）。\n\n"
        f"是否现在下载并安装？安装时会自动重启程序。{source_hint}\n"
    )
    if notes:
        body += f"\n更新说明：\n{notes}\n"
    if info.get("sha256"):
        body += "\n将校验更新包 SHA256。\n"
    if silent:
        return False
    from desktop_dialog import ask_yes_no, show_message

    if not ask_yes_no(body, "期界 · 检查更新"):
        return False
    try:
        run_update(info)
        show_message("正在更新，程序即将退出并自动重启。", "期界 · 更新")
        return True
    except OSError as exc:
        show_message(f"更新失败：{exc}", "期界 · 更新", error=True)
        return False


def check_only() -> int:
    info = find_update()
    if not info:
        print(f"已是最新版本 v{__version__}")
        return 0
    print(f"有新版本 v{info['version']}（当前 v{__version__}）")
    print(f"来源：{info.get('source', 'unknown')}")
    print(f"下载：{info['url']}")
    if info.get("sha256"):
        print(f"SHA256：{info['sha256']}")
    return 1
