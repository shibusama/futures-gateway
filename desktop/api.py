# -*- coding: utf-8 -*-
"""PyWebView JS bridge for the main trading window."""
from __future__ import annotations

import json
import threading


class DesktopApi:
    """Exposed to web UI as pywebview.api when running inside desktop shell."""

    def __init__(self) -> None:
        self._window = None
        self._main_url = ""
        self._quit_callback = None

    def bind(self, window, main_url: str, *, quit_callback=None) -> None:
        self._window = window
        self._main_url = main_url
        self._quit_callback = quit_callback

    def _navigate(self, url: str) -> None:
        """延迟切换当前窗口到 url。

        不要在 JS 桥方法里同步 load_url：方法返回后 pywebview 会在当前页面
        执行返回值回调，若页面已被导航走，旧页面的回调不存在就会抛异常。
        用定时器让返回值先落地，再切页。
        """

        def _go() -> None:
            try:
                self._window.load_url(url)
            except Exception:
                pass

        threading.Timer(0.2, _go).start()

    def get_app_info(self) -> str:
        try:
            from app_version import GITHUB_REPO, __version__
        except ImportError:
            return json.dumps(
                {"desktop": True, "version": "dev", "github": "https://github.com/shibusama/futures-gateway"},
                ensure_ascii=False,
            )
        return json.dumps(
            {
                "desktop": True,
                "version": __version__,
                "github": f"https://github.com/{GITHUB_REPO}",
                "releases": f"https://github.com/{GITHUB_REPO}/releases",
            },
            ensure_ascii=False,
        )

    def get_front_profiles(self) -> str:
        from .setup import SetupApi

        return SetupApi(close_on_save=False).get_front_profiles()

    def go_back(self) -> str:
        if self._window is None or not self._main_url:
            return json.dumps({"ok": False, "msg": "无法返回"}, ensure_ascii=False)
        try:
            self._navigate(self._main_url)
            return json.dumps({"ok": True}, ensure_ascii=False)
        except OSError as exc:
            return json.dumps({"ok": False, "msg": str(exc)}, ensure_ascii=False)

    def get_defaults(self) -> str:
        from .setup import SetupApi

        return SetupApi(close_on_save=False).get_defaults()

    def test_connection(self, payload_json: str) -> str:
        from .setup import SetupApi

        return SetupApi(close_on_save=False).test_connection(payload_json)

    def save_config(self, payload_json: str) -> str:
        from .setup import SetupApi

        api = SetupApi(close_on_save=False)
        raw = api.save_config(payload_json)
        result = json.loads(raw)
        if result.get("ok") and self._window is not None and self._main_url:
            self._navigate(self._main_url)
        return raw

    def check_for_updates(self) -> str:
        try:
            from .updater import check_and_prompt

            if check_and_prompt():
                if self._quit_callback is not None:
                    self._quit_callback()
                elif self._window is not None:
                    try:
                        self._window.destroy()
                    except Exception:
                        pass
                return json.dumps({"ok": True, "msg": "正在下载更新，程序即将退出。"}, ensure_ascii=False)
            return json.dumps({"ok": True, "msg": "已是最新版本，或您选择了稍后更新。"}, ensure_ascii=False)
        except OSError as exc:
            return json.dumps({"ok": False, "msg": str(exc)}, ensure_ascii=False)

    def export_diagnostics(self) -> str:
        from .logging import export_diagnostics

        try:
            path = export_diagnostics()
            return json.dumps({"ok": True, "msg": f"诊断包已导出：{path}", "path": path}, ensure_ascii=False)
        except OSError as exc:
            return json.dumps({"ok": False, "msg": str(exc)}, ensure_ascii=False)

    def open_account_setup(self) -> str:
        if self._window is None:
            return json.dumps({"ok": False, "msg": "窗口不可用"}, ensure_ascii=False)
        if not self._main_url:
            return json.dumps({"ok": False, "msg": "主界面地址未知"}, ensure_ascii=False)
        try:
            # 主窗口已在 http:// 源；WebView2 禁止从 http 跳到 file://，
            # 会显示 ERR_FILE_NOT_FOUND。setup.html 由网关静态服务，走同源即可。
            self._navigate(self._main_url.rstrip("/") + "/setup.html?mode=settings")
            return json.dumps({"ok": True, "msg": "正在打开账号配置…"}, ensure_ascii=False)
        except OSError as exc:
            return json.dumps({"ok": False, "msg": str(exc)}, ensure_ascii=False)
