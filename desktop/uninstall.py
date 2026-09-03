# -*- coding: utf-8 -*-
"""Uninstall helpers for Inno Setup installs and portable (zip) builds."""
from __future__ import annotations

import glob
import os
import subprocess
import sys
import tempfile
import textwrap

from app_paths import app_root, is_frozen

# installer/FuturesTerminal.iss AppId
_INNO_UNINSTALL_KEY = "{A7B3C9E1-4F2D-4A8B-9C1E-Desktop-PyWebView}_is1"


def _parse_uninstall_cmd(raw: str) -> list[str]:
    raw = (raw or "").strip()
    if not raw:
        return []
    if raw.startswith('"'):
        end = raw.find('"', 1)
        if end > 0:
            exe = raw[1:end]
            rest = raw[end + 1 :].strip()
            return [exe] + ([rest] if rest else [])
    parts = raw.split(" ", 1)
    return [parts[0]] + ([parts[1]] if len(parts) > 1 else [])


def find_inno_uninstaller() -> str | None:
    """Return path to Inno unins*.exe if this app was installed via Setup."""
    root = app_root()
    for pattern in ("unins*.exe", "Uninstall*.exe"):
        for path in sorted(glob.glob(os.path.join(root, pattern))):
            if os.path.isfile(path):
                return path

    if os.name != "nt":
        return None

    try:
        import winreg
    except ImportError:
        return None

    sub = rf"Software\Microsoft\Windows\CurrentVersion\Uninstall\{_INNO_UNINSTALL_KEY}"
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        try:
            with winreg.OpenKey(hive, sub) as key:
                cmd, _ = winreg.QueryValueEx(key, "UninstallString")
        except OSError:
            continue
        parts = _parse_uninstall_cmd(str(cmd))
        if parts and os.path.isfile(parts[0]):
            return parts[0]
    return None


def _portable_uninstall_bat(app_dir: str) -> str:
    """Batch script in TEMP: wait for exe exit, then remove install dir."""
    app_dir = os.path.abspath(app_dir)
    return textwrap.dedent(
        f"""\
        @echo off
        chcp 65001 >nul
        set "APP={app_dir}"
        :wait
        tasklist /FI "IMAGENAME eq FuturesTerminal.exe" 2>nul | find /I "FuturesTerminal.exe" >nul
        if not errorlevel 1 (
            timeout /t 1 /nobreak >nul
            goto wait
        )
        rd /s /q "%APP%" 2>nul
        if exist "%APP%" (
            msg * 期界部分文件未能删除，请手动删除文件夹：%APP%
        ) else (
            msg * 期界已卸载。
        )
        del /f /q "%~f0" 2>nul
        """
    )


def launch_portable_uninstall() -> None:
    """Schedule deletion of the portable app folder after this process exits."""
    app_dir = app_root()
    fd, bat_path = tempfile.mkstemp(suffix=".bat", prefix="fg-uninstall-")
    os.close(fd)
    with open(bat_path, "w", encoding="utf-8") as f:
        f.write(_portable_uninstall_bat(app_dir))
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    subprocess.Popen(["cmd", "/c", bat_path], creationflags=flags, close_fds=True)


def launch_inno_uninstall(uninstaller: str) -> None:
    """Start Inno uninstall wizard (non-silent; config.json kept by default)."""
    subprocess.Popen([uninstaller], close_fds=True)


def run_uninstall(*, after_launch) -> bool:
    """
    Confirm and start uninstall. ``after_launch`` is called after the uninstaller
    is spawned (typically request_quit). Returns True if uninstall was started.
    """
    from .dialog import ask_yes_no, show_message

    if not is_frozen():
        show_message(
            "开发模式无法卸载。\n\n请直接删除项目目录，或使用 build 产出的安装包/绿色版。",
            "期界 · 卸载",
        )
        return False

    inno = find_inno_uninstaller()
    if inno:
        if not ask_yes_no(
            "将打开卸载向导，从本机移除期界。\n\n"
            "· SimNow 账号配置（config.json）默认保留\n"
            "· 程序会先退出再卸载\n\n"
            "是否继续？",
            "期界 · 卸载",
        ):
            return False
        launch_inno_uninstall(inno)
        after_launch()
        return True

    if not ask_yes_no(
        "当前为绿色版（zip），将删除整个程序文件夹：\n\n"
        f"{app_root()}\n\n"
        "· config.json 会一并删除（含账号密码）\n"
        "· 程序会先退出再删除\n\n"
        "是否继续？",
        "期界 · 卸载",
    ):
        return False
    launch_portable_uninstall()
    after_launch()
    return True
