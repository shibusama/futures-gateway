# -*- coding: utf-8 -*-
"""First-run setup wizard for PyWebView desktop (SimNow account config)."""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.parse
import urllib.request

from app_paths import app_root, bundle_root
from gateway.config import config_path, ensure_config, load_config, normalize, save_config as write_config

PLACEHOLDER_MARKERS = (
    "请填写",
    "请输入",
    "placeholder",
    "your_",
    "xxx",
    "example",
)

DEFAULT_FRONTS = {
    "trade_front": "tcp://182.254.243.31:30001",
    "md_front": "tcp://182.254.243.31:30011",
}


def _is_placeholder(value: str) -> bool:
    text = (value or "").strip().lower()
    if not text:
        return True
    return any(marker in text for marker in PLACEHOLDER_MARKERS)


def config_needs_setup(cfg: dict | None = None) -> bool:
    path = config_path()
    if not os.path.isfile(path):
        return True
    if cfg is None:
        try:
            cfg = load_config()
        except (json.JSONDecodeError, OSError, TypeError):
            return True
    accounts = cfg.get("accounts") or []
    if not accounts:
        return True
    for acc in accounts:
        uid = (acc.get("user_id") or "").strip()
        pwd = (acc.get("password") or "").strip()
        if _is_placeholder(uid) or _is_placeholder(pwd):
            return True
    return False


def _setup_html_url() -> str:
    path = os.path.join(bundle_root(), "web", "setup.html")
    return urllib.parse.urljoin("file:", urllib.request.pathname2url(os.path.abspath(path)))


def _account_from_payload(data: dict) -> dict:
    return normalize(
        {
            "host": "127.0.0.1",
            "port": 8765,
            "flow_dir": "flow",
            "accounts": [
                {
                    "name": (data.get("name") or "SimNow一号").strip() or "SimNow一号",
                    "user_id": (data.get("user_id") or "").strip(),
                    "password": data.get("password") or "",
                    "broker_id": (data.get("broker_id") or "9999").strip() or "9999",
                    "trade_front": (data.get("trade_front") or DEFAULT_FRONTS["trade_front"]).strip(),
                    "md_front": (data.get("md_front") or DEFAULT_FRONTS["md_front"]).strip(),
                }
            ],
        }
    )["accounts"][0]


def test_account_connection(acc_cfg: dict, timeout: float = 28.0) -> dict:
    from gateway.ctp import CtpGateway

    events: list[dict] = []
    lock = threading.Lock()

    def on_event(event: dict) -> None:
        with lock:
            events.append(event)

    flow_dir = os.path.join(app_root(), "flow", "_setup_test")
    gw = CtpGateway(acc_cfg, on_event, flow_dir)
    threading.Thread(target=gw.connect, daemon=True).start()

    deadline = time.time() + timeout
    while time.time() < deadline:
        with lock:
            snapshot = list(events)
        for event in snapshot:
            if event.get("type") != "login":
                continue
            status = event.get("status")
            if status == "ok":
                return {"ok": True, "msg": event.get("msg") or "SimNow 登录成功"}
            if status == "fail":
                return {"ok": False, "msg": event.get("msg") or "登录失败"}
        time.sleep(0.25)
    return {"ok": False, "msg": "连接超时，请检查账号、密码、网络或 SimNow 前置地址"}


class SetupApi:
    """PyWebView JS bridge for setup.html."""

    def __init__(self) -> None:
        self.completed = False
        self._window = None

    def get_defaults(self) -> str:
        ensure_config()
        try:
            cfg = load_config()
            acc = (cfg.get("accounts") or [{}])[0]
        except (json.JSONDecodeError, OSError, TypeError):
            acc = {}
        payload = {
            "name": acc.get("name") or "SimNow一号",
            "user_id": "" if _is_placeholder(acc.get("user_id", "")) else acc.get("user_id", ""),
            "password": "",
            "broker_id": acc.get("broker_id") or "9999",
            "trade_front": acc.get("trade_front") or DEFAULT_FRONTS["trade_front"],
            "md_front": acc.get("md_front") or DEFAULT_FRONTS["md_front"],
        }
        return json.dumps(payload, ensure_ascii=False)

    def test_connection(self, payload_json: str) -> str:
        try:
            data = json.loads(payload_json or "{}")
        except json.JSONDecodeError:
            return json.dumps({"ok": False, "msg": "表单数据无效"}, ensure_ascii=False)
        acc = _account_from_payload(data)
        if _is_placeholder(acc.get("user_id", "")) or not (acc.get("password") or "").strip():
            return json.dumps({"ok": False, "msg": "请先填写资金账号和密码"}, ensure_ascii=False)
        result = test_account_connection(acc)
        return json.dumps(result, ensure_ascii=False)

    def save_config(self, payload_json: str) -> str:
        try:
            data = json.loads(payload_json or "{}")
        except json.JSONDecodeError:
            return json.dumps({"ok": False, "msg": "表单数据无效"}, ensure_ascii=False)
        acc = _account_from_payload(data)
        if _is_placeholder(acc.get("user_id", "")) or not (acc.get("password") or "").strip():
            return json.dumps({"ok": False, "msg": "请先填写资金账号和密码"}, ensure_ascii=False)
        cfg = normalize(
            {
                "host": "127.0.0.1",
                "port": 8765,
                "flow_dir": "flow",
                "accounts": [acc],
            }
        )
        try:
            write_config(cfg)
        except OSError as exc:
            return json.dumps({"ok": False, "msg": f"保存失败：{exc}"}, ensure_ascii=False)
        self.completed = True
        if self._window is not None:
            try:
                self._window.destroy()
            except Exception:
                pass
        return json.dumps({"ok": True, "msg": "配置已保存"}, ensure_ascii=False)


def run_setup_wizard() -> bool:
    import webview

    api = SetupApi()
    window = webview.create_window(
        "期界 · 首次配置",
        _setup_html_url(),
        width=560,
        height=680,
        resizable=False,
        js_api=api,
    )
    api._window = window
    webview.start()
    return api.completed
