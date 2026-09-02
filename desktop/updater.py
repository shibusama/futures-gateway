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


def _download(url: str, dest: str, on_progress=None) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "FuturesTerminal-Updater"})
    last_err: Exception | None = None
    for _attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                total = int(resp.headers.get("Content-Length") or 0)
                read = 0
                chunk_size = 256 * 1024
                with open(dest, "wb") as out:
                    while True:
                        chunk = resp.read(chunk_size)
                        if not chunk:
                            break
                        out.write(chunk)
                        read += len(chunk)
                        if on_progress:
                            on_progress(read, total)
            return
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_err = exc
            if os.path.isfile(dest):
                try:
                    os.remove(dest)
                except OSError:
                    pass
    raise OSError(f"下载失败（已重试 3 次）：{last_err}")


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


def _update_workdir() -> str:
    work = os.path.join(os.environ.get("LOCALAPPDATA", tempfile.gettempdir()), "FuturesTerminal", "update")
    os.makedirs(work, exist_ok=True)
    return work


def _prepare_staging_dir(work: str) -> str:
    staging = os.path.join(work, "staging")
    if os.path.isdir(staging):
        shutil.rmtree(staging, ignore_errors=True)
    os.makedirs(staging, exist_ok=True)
    return staging


def _normalize_staging(staging: str) -> str:
    entries = os.listdir(staging)
    if len(entries) == 1:
        only = os.path.join(staging, entries[0])
        if os.path.isdir(only) and os.path.isfile(os.path.join(only, "FuturesTerminal.exe")):
            return only
    return staging


def _apply_update(staging_dir: str, parent_pid: int | None = None) -> None:
    app = app_root()
    exe_path = os.path.join(app, "FuturesTerminal.exe")
    bat_path = os.path.join(tempfile.gettempdir(), "futures_terminal_apply_update.bat")
    staging = staging_dir.replace('"', "")
    app_q = app.replace('"', "")
    exe_q = exe_path.replace('"', "")
    pid = parent_pid if parent_pid is not None else os.getpid()
    bat = f"""@echo off
chcp 65001 >nul
set PID={pid}
:wait
tasklist /FI "PID eq %PID%" 2>nul | find "%PID%" >nul
if %errorlevel%==0 (
  timeout /t 1 /nobreak >nul
  goto wait
)
robocopy "{staging}" "{app_q}" /E /IS /IT /NFL /NDL /NJH /NJS /R:5 /W:2
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


def download_and_extract(info: dict) -> str:
    from .update_progress import open_download_progress

    work = _update_workdir()
    zip_path = os.path.join(work, "pending.zip")
    staging = _prepare_staging_dir(work)

    progress = open_download_progress(f"期界 · 下载 v{info['version']}")
    try:
        def on_download(read: int, total: int) -> None:
            progress.set_phase("download", read, total)

        _download(info["url"], zip_path, on_progress=on_download)
        progress.set_phase("verify")
        _verify_download(zip_path, info.get("sha256") or "")
        progress.set_phase("extract")
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(staging)
    finally:
        progress.close()

    staging = _normalize_staging(staging)
    if not os.path.isfile(os.path.join(staging, "FuturesTerminal.exe")):
        raise OSError("更新包格式异常：未找到 FuturesTerminal.exe")
    return staging


def run_update(info: dict) -> None:
    staging = download_and_extract(info)
    _apply_update(staging, parent_pid=os.getpid())


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
        f"是否现在下载并安装？\n"
        f"将显示下载进度（约 56 MB），完成后程序会自动退出并重启。{source_hint}\n"
    )
    if notes:
        body += f"\n更新说明：\n{notes}\n"
    if info.get("sha256"):
        body += "\n将校验更新包 SHA256。\n"
    if silent:
        return False
    from .dialog import ask_yes_no, show_message

    if not ask_yes_no(body, "期界 · 检查更新"):
        return False
    try:
        staging = download_and_extract(info)
        _apply_update(staging, parent_pid=os.getpid())
        show_message(
            "更新已下载。\n\n"
            "点击「确定」后程序将退出并完成安装，随后自动重启。\n"
            "请勿手动结束任务管理器中的 FuturesTerminal。",
            "期界 · 更新",
        )
        return True
    except Exception as exc:
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
