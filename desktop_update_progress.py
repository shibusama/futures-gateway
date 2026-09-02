# -*- coding: utf-8 -*-
"""Thread-hosted download progress UI for desktop updates."""
from __future__ import annotations

import queue
import threading


class _NullProgress:
    def set_phase(self, phase: str, read: int = 0, total: int = 0) -> None:
        pass

    def close(self) -> None:
        pass


class ProgressController:
    """Run tkinter progress window on a dedicated thread (safe with pywebview)."""

    def __init__(self, title: str) -> None:
        self._q: queue.Queue = queue.Queue()
        self._ready = threading.Event()
        self._thread = threading.Thread(target=self._run, args=(title,), daemon=True)
        self._thread.start()
        self._ready.wait(timeout=10)

    def _run(self, title: str) -> None:
        from desktop_download_progress import DownloadProgressDialog

        try:
            dlg = DownloadProgressDialog(title)
        except Exception:
            self._ready.set()
            return
        self._dlg = dlg
        self._ready.set()
        self._poll()
        try:
            dlg._root.mainloop()
        except Exception:
            pass

    def _poll(self) -> None:
        try:
            while True:
                item = self._q.get_nowait()
                if item is None:
                    self._dlg.close()
                    self._dlg._root.quit()
                    return
                self._dlg.set_phase(*item)
        except queue.Empty:
            pass
        except Exception:
            return
        try:
            self._dlg._root.after(80, self._poll)
        except Exception:
            pass

    def set_phase(self, phase: str, read: int = 0, total: int = 0) -> None:
        self._q.put((phase, read, total))

    def close(self) -> None:
        self._q.put(None)
        if self._thread.is_alive():
            self._thread.join(timeout=8)


def open_download_progress(title: str = "期界 · 下载更新"):
    try:
        return ProgressController(title)
    except Exception:
        return _NullProgress()
