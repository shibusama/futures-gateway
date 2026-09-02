# -*- coding: utf-8 -*-
"""Native download progress window for desktop updates (Windows + tkinter)."""
from __future__ import annotations


class _NullProgress:
    def set_phase(self, phase: str, read: int = 0, total: int = 0) -> None:
        pass

    def close(self) -> None:
        pass


class DownloadProgressDialog:
    """Small always-on-top window with determinate progress bar."""

    def __init__(self, title: str = "期界 · 下载更新") -> None:
        import tkinter as tk
        from tkinter import ttk

        self._tk = tk
        self._root = tk.Tk()
        self._root.title(title)
        self._root.geometry("440x130")
        self._root.resizable(False, False)
        self._root.protocol("WM_DELETE_WINDOW", lambda: None)
        try:
            self._root.attributes("-topmost", True)
        except tk.TclError:
            pass

        self._root.update_idletasks()
        sw = self._root.winfo_screenwidth()
        sh = self._root.winfo_screenheight()
        w, h = 440, 130
        self._root.geometry(f"{w}x{h}+{(sw - w) // 2}+{(sh - h) // 2}")

        frame = ttk.Frame(self._root, padding=16)
        frame.pack(fill="both", expand=True)

        self._title = ttk.Label(frame, text="正在准备下载…", font=("Segoe UI", 10))
        self._title.pack(anchor="w")

        self._bar = ttk.Progressbar(frame, mode="determinate", maximum=100)
        self._bar.pack(fill="x", pady=(10, 6))

        self._detail = ttk.Label(frame, text="", font=("Segoe UI", 9))
        self._detail.pack(anchor="w")

        self._root.update()

    def set_phase(self, phase: str, read: int = 0, total: int = 0) -> None:
        if phase == "download":
            self._title.config(text="正在下载更新包…")
            if total > 0:
                self._bar.stop()
                self._bar.config(mode="determinate", maximum=100)
                pct = min(100.0, read * 100.0 / total)
                self._bar["value"] = pct
                self._detail.config(
                    text=f"{_mb(read):.1f} / {_mb(total):.1f} MB（{pct:.0f}%）"
                )
            else:
                self._bar.config(mode="indeterminate")
                self._bar.start(12)
                self._detail.config(text=f"已下载 {_mb(read):.1f} MB")
        elif phase == "verify":
            self._bar.stop()
            self._bar.config(mode="indeterminate")
            self._bar.start(10)
            self._title.config(text="正在校验更新包…")
            self._detail.config(text="SHA256 校验中，请稍候")
        elif phase == "extract":
            self._bar.stop()
            self._bar.config(mode="indeterminate")
            self._bar.start(10)
            self._title.config(text="正在解压更新包…")
            self._detail.config(text="即将自动重启程序")
        else:
            self._title.config(text=phase)
        self._root.update_idletasks()
        self._root.update()

    def close(self) -> None:
        try:
            self._bar.stop()
            self._root.destroy()
        except Exception:
            pass


def open_download_progress(title: str = "期界 · 下载更新"):
    """Return a progress dialog, or a no-op stub if tkinter is unavailable."""
    try:
        return DownloadProgressDialog(title)
    except Exception:
        return _NullProgress()


def _mb(n: int) -> float:
    return (n or 0) / (1024 * 1024)
