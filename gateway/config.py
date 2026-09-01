# -*- coding: utf-8 -*-
"""配置文件读取。首次运行时若 config.json 不存在，则以 config.json.example 为模板生成。"""
import json
import os
import shutil

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
EXAMPLE_PATH = os.path.join(BASE_DIR, "config.json.example")

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
    if not os.path.exists(CONFIG_PATH):
        if os.path.exists(EXAMPLE_PATH):
            shutil.copyfile(EXAMPLE_PATH, CONFIG_PATH)
        else:
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(DEFAULT_CONFIG, f, ensure_ascii=False, indent=2)
    return CONFIG_PATH


def load_config():
    path = ensure_config()
    with open(path, "r", encoding="utf-8-sig") as f:
        cfg = json.load(f)
    return normalize(cfg)


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