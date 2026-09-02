# -*- coding: utf-8 -*-
"""Native dialogs and log helpers for the desktop shell."""
from __future__ import annotations

import os


def show_message(text: str, title: str = "期界 · 期货交易终端", *, error: bool = False) -> None:
    if os.name != "nt":
        print(f"{title}\n{text}")
        return
    import ctypes

    # MB_SYSTEMMODAL：置顶，避免被 PyWebView 主窗口挡住
    flags = 0x00001000 | (0x00000010 if error else 0x00000040)
    ctypes.windll.user32.MessageBoxW(None, text, title, flags)


def ask_yes_no(text: str, title: str = "期界 · 期货交易终端") -> bool:
    if os.name != "nt":
        print(f"{title}\n{text}")
        return False
    import ctypes

    rc = ctypes.windll.user32.MessageBoxW(None, text, title, 0x00001000 | 0x00000024)
    return rc == 6


def read_log_tail(path: str, max_lines: int = 18, max_chars: int = 1200) -> str:
    if not os.path.isfile(path):
        return "（日志文件尚未生成）"
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except OSError as exc:
        return f"（无法读取日志：{exc}）"
    tail = "".join(lines[-max_lines:]).strip()
    if not tail:
        return "（日志为空）"
    if len(tail) > max_chars:
        tail = "…" + tail[-max_chars:]
    return tail


def format_startup_failure(reason: str, log_path: str) -> str:
    tail = read_log_tail(log_path)
    return (
        f"{reason}\n\n"
        f"请检查 config.json 中的 SimNow 账号与密码是否正确。\n"
        f"详细日志：\n{log_path}\n\n"
        f"最近日志：\n{tail}"
    )
