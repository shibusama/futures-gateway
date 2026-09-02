# -*- coding: utf-8 -*-
"""CTP 前置站点目录（SimNow 仿真 + 实盘预留）。"""
from __future__ import annotations

import json

ACCOUNT_TYPES = [
    {
        "id": "simnow",
        "label": "SimNow 仿真",
        "enabled": True,
        "broker_id": "9999",
        "app_id": "simnow_client_test",
        "auth_code": "0000000000000000",
        "hint": "在上期 SimNow 官网注册仿真账号，BrokerID 固定 9999。",
    },
    {
        "id": "live",
        "label": "实盘 CTP",
        "enabled": False,
        "broker_id": "",
        "hint": "预留：接入期货公司实盘前置（需 AppID / 授权码，由期货公司发放）。",
    },
]

SIMNOW_FRONT_PROFILES = [
    {
        "id": "simnow-7x24",
        "label": "第二套 · 7×24 环境",
        "hours": "全天可用（推荐非交易时段调试）",
        "recommended": True,
        "trade_front": "tcp://182.254.243.31:40001",
        "md_front": "tcp://182.254.243.31:40011",
    },
    {
        "id": "simnow-1-a",
        "label": "第一套 · 前置组 1",
        "hours": "交易时段（日盘约 9:00–15:00；夜盘约 21:00–次日 2:30，依品种而定）",
        "recommended": False,
        "trade_front": "tcp://182.254.243.31:30001",
        "md_front": "tcp://182.254.243.31:30011",
    },
    {
        "id": "simnow-1-b",
        "label": "第一套 · 前置组 2",
        "hours": "交易时段（同上，电信/联通备用线路）",
        "recommended": False,
        "trade_front": "tcp://182.254.243.31:30002",
        "md_front": "tcp://182.254.243.31:30012",
    },
    {
        "id": "simnow-1-c",
        "label": "第一套 · 前置组 3",
        "hours": "交易时段（同上，电信/联通备用线路）",
        "recommended": False,
        "trade_front": "tcp://182.254.243.31:30003",
        "md_front": "tcp://182.254.243.31:30013",
    },
]

LIVE_FRONT_PROFILES: list[dict] = []


def get_catalog() -> dict:
    return {
        "account_types": ACCOUNT_TYPES,
        "simnow_fronts": SIMNOW_FRONT_PROFILES,
        "live_fronts": LIVE_FRONT_PROFILES,
        "default_simnow_profile_id": "simnow-7x24",
    }


def catalog_json() -> str:
    return json.dumps(get_catalog(), ensure_ascii=False)


def find_simnow_profile(profile_id: str | None) -> dict | None:
    if not profile_id:
        return None
    for item in SIMNOW_FRONT_PROFILES:
        if item["id"] == profile_id:
            return item
    return None


def match_simnow_profile(trade_front: str, md_front: str) -> str | None:
    t = (trade_front or "").strip()
    m = (md_front or "").strip()
    for item in SIMNOW_FRONT_PROFILES:
        if item["trade_front"] == t and item["md_front"] == m:
            return item["id"]
    return None


def default_simnow_profile() -> dict:
    for item in SIMNOW_FRONT_PROFILES:
        if item.get("recommended"):
            return item
    return SIMNOW_FRONT_PROFILES[0]


def resolve_fronts(
    account_type: str,
    profile_id: str | None,
    trade_front: str,
    md_front: str,
) -> tuple[str, str, str | None]:
    if account_type == "simnow":
        prof = find_simnow_profile(profile_id)
        if prof:
            return prof["trade_front"], prof["md_front"], prof["id"]
        if trade_front and md_front:
            matched = match_simnow_profile(trade_front, md_front)
            return trade_front.strip(), md_front.strip(), matched
        d = default_simnow_profile()
        return d["trade_front"], d["md_front"], d["id"]
    return (trade_front or "").strip(), (md_front or "").strip(), profile_id
