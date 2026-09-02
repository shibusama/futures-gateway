# -*- coding: utf-8 -*-
"""配置文件读取。首次运行时若 config.json 不存在，则以 config.json.example 为模板生成。"""
import json
import os
import shutil

from app_paths import app_root, bundle_root


def base_dir() -> str:
    return os.environ.get("FUTURES_APP_ROOT") or app_root()


def config_path() -> str:
    return os.path.join(base_dir(), "config.json")


def example_path() -> str:
    bundled = os.path.join(bundle_root(), "config.json.example")
    if os.path.isfile(bundled):
        return bundled
    return os.path.join(base_dir(), "config.json.example")


BASE_DIR = base_dir()
CONFIG_PATH = config_path()
EXAMPLE_PATH = example_path()

DEFAULT_CONFIG = {
    "host": "127.0.0.1",
    "port": 8765,
    "accounts": [
        {
            "name": "SimNow一号",
            "user_id": "请输入资金账号",
            "password": "请输入密码",
            "broker_id": "9999",
            "trade_front": "tcp://180.168.146.187:10101",
            "md_front": "tcp://180.168.146.187:10111"
        }
    ]
}


def ensure_config():
    """若 config.json 不存在，从示例模板生成一份占位配置。"""
    path = config_path()
    ex = example_path()
    if not os.path.exists(path):
        if os.path.exists(ex):
            shutil.copyfile(ex, path)
        else:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(DEFAULT_CONFIG, f, ensure_ascii=False, indent=2)
    return path


def load_config():
    path = ensure_config()
    with open(path, "r", encoding="utf-8-sig") as f:
        cfg = json.load(f)
    return normalize(cfg)


def save_config(cfg: dict) -> None:
    """Write config.json next to the app (exe dir when packaged)."""
    path = config_path()
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(normalize(cfg), f, ensure_ascii=False, indent=2)


def normalize(cfg):
    """补齐缺失字段，避免用户手改配置时漏一项导致崩溃。"""
    cfg.setdefault("host", "127.0.0.1")
    cfg.setdefault("port", 8765)
    cfg.setdefault("accounts", [])
    for acc in cfg["accounts"]:
        acc.setdefault("broker_id", "9999")
        acc.setdefault("trade_front", "tcp://180.168.146.187:10101")
        acc.setdefault("md_front", "tcp://180.168.146.187:10111")
    return cfg