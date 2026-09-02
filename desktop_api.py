# -*- coding: utf-8 -*-
"""PyWebView JS bridge for the main trading window."""
from __future__ import annotations

import json


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
        from desktop_setup import SetupApi

        return SetupApi(close_on_save=False).get_front_profiles()

    def go_back(self) -> str:
        if self._window is None or not self._main_url:
            return json.dumps({"ok": False, "msg": "无法返回"}, ensure_ascii=False)
        try:
            self._window.load_url(self._main_url)
            return json.dumps({"ok": True}, ensure_ascii=False)
        except OSError as exc:
            return json.dumps({"ok": False, "msg": str(exc)}, ensure_ascii=False)

    def get_defaults(self) -> str:
        from desktop_setup import SetupApi

        return SetupApi(close_on_save=False).get_defaults()

    def test_connection(self, payload_json: str) -> str:
        from desktop_setup import SetupApi

        return SetupApi(close_on_save=False).test_connection(payload_json)

    def save_config(self, payload_json: str) -> str:
        from desktop_setup import SetupApi

        api = SetupApi(close_on_save=False)
        raw = api.save_config(payload_json)
        result = json.loads(raw)
        if result.get("ok") and self._window is not None and self._main_url:
            try:
                self._window.load_url(self._main_url)
            except Exception:
                pass
        return raw

    def check_for_updates(self) -> str:
        try:
            from desktop_updater import check_and_prompt

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
        from desktop_logging import export_diagnostics

        try:
            path = export_diagnostics()
            return json.dumps({"ok": True, "msg": f"诊断包已导出：{path}", "path": path}, ensure_ascii=False)
        except OSError as exc:
            return json.dumps({"ok": False, "msg": str(exc)}, ensure_ascii=False)

    def open_account_setup(self) -> str:
        if self._window is None:
            return json.dumps({"ok": False, "msg": "窗口不可用"}, ensure_ascii=False)
        try:
            from desktop_setup import _setup_html_url

            self._window.load_url(_setup_html_url(settings=True))
            return json.dumps({"ok": True, "msg": "请在配置页修改并保存。"}, ensure_ascii=False)
        except OSError as exc:
            return json.dumps({"ok": False, "msg": str(exc)}, ensure_ascii=False)
