# -*- coding: utf-8 -*-
"""Windows system tray integration for PyWebView desktop shell."""
from __future__ import annotations

import os
import threading
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from pystray import Icon


class TrayController:
    def __init__(
        self,
        *,
        on_show: Callable[[], None],
        on_quit: Callable[[], None],
        title: str = "期界 · 期货交易终端",
    ) -> None:
        self._on_show = on_show
        self._on_quit = on_quit
        self._title = title
        self._icon: Icon | None = None
        self._thread: threading.Thread | None = None
        self.active = False

    def _icon_path(self) -> str:
        from app_paths import bundle_root

        for base in (bundle_root(), os.path.dirname(os.path.abspath(__file__))):
            path = os.path.join(base, "assets", "icon.ico")
            if os.path.isfile(path):
                return path
        return ""

    def start(self) -> None:
        if os.name != "nt":
            return
        try:
            import pystray
            from PIL import Image
        except ImportError:
            return

        icon_path = self._icon_path()
        if not icon_path:
            return

        image = Image.open(icon_path)

        menu = pystray.Menu(
            pystray.MenuItem("显示窗口", lambda _icon, _item: self._on_show(), default=True),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("退出", lambda _icon, _item: self._on_quit()),
        )
        self._icon = pystray.Icon("FuturesTerminal", image, self._title, menu)
        self._thread = threading.Thread(target=self._icon.run, daemon=True)
        self._thread.start()
        self.active = True

    def notify(self, message: str, title: str | None = None) -> None:
        if self._icon is None:
            return
        try:
            self._icon.notify(message, title or self._title)
        except Exception:
            pass

    def stop(self) -> None:
        if self._icon is None:
            return
        try:
            self._icon.stop()
        except Exception:
            pass
        self._icon = None
        self.active = False
