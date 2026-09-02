# -*- coding: utf-8 -*-
"""历史 K 线：直连新浪期货 JSONP（不依赖 akshare / pandas，桌面打包可用）。"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime

_cache: dict[tuple[str, str], tuple[float, list]] = {}
CACHE_TTL = 90

_JSONP_RE = re.compile(r"=\((.*)\)\s*;?\s*$", re.S)
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Referer": "https://finance.sina.com.cn/",
    "Accept": "*/*",
}


def fetch_bars(symbol: str, period: str = "1m") -> list:
    """
    拉取历史 OHLCV。
    period: 1m | 5m | 1d
    返回: [{t, o, h, l, c, v}, ...]  t 为毫秒时间戳
    """
    sym = (symbol or "").upper()
    if not sym:
        return []
    if period not in ("1m", "5m", "1d"):
        period = "1m"

    cache_key = (sym, period)
    now = time.time()
    cached = _cache.get(cache_key)
    if cached and now - cached[0] < CACHE_TTL:
        return cached[1]

    bars: list = []
    try:
        bars = _fetch_sina(sym, period)
    except Exception as exc:
        print(f" [历史K线] {sym} {period} 拉取失败: {exc}")
        bars = cached[1] if cached else []

    if bars:
        _cache[cache_key] = (now, bars)
        return bars

    fallback = _fetch_akshare(sym, period)
    if fallback:
        _cache[cache_key] = (now, fallback)
        return fallback

    _cache[cache_key] = (now, bars)
    return cached[1] if cached else bars


def _fetch_sina(symbol: str, period: str) -> list:
    if period == "1d":
        url = (
            "https://stock2.finance.sina.com.cn/futures/api/jsonp.php/"
            f"var%20_{symbol}=/InnerFuturesNewService.getDailyKLine?symbol={symbol}"
        )
    else:
        minutes = "5" if period == "5m" else "1"
        url = (
            "https://stock2.finance.sina.com.cn/futures/api/jsonp.php/"
            f"var%20_{symbol}_{minutes}=/InnerFuturesNewService.getFewMinLine"
            f"?symbol={symbol}&type={minutes}"
        )
    raw = _http_get(url)
    rows = _parse_jsonp(raw)
    if not isinstance(rows, list):
        return []
    bars = []
    for row in rows:
        bar = _row_to_bar(row)
        if bar:
            bars.append(bar)
    bars.sort(key=lambda b: b["t"])
    return bars


def _row_to_bar(row) -> dict | None:
    try:
        if isinstance(row, dict):
            dt_raw = str(row.get("d") or row.get("datetime") or row.get("date") or "")
            o, h, l, c = row.get("o"), row.get("h"), row.get("l"), row.get("c")
            v = row.get("v") or 0
        elif isinstance(row, (list, tuple)) and len(row) >= 6:
            dt_raw = str(row[0])
            o, h, l, c, v = row[1], row[2], row[3], row[4], row[5]
        else:
            return None
        ts = _parse_dt_ms(dt_raw)
        if ts is None:
            return None
        return {
            "t": ts,
            "o": float(o),
            "h": float(h),
            "l": float(l),
            "c": float(c),
            "v": float(v or 0),
        }
    except (TypeError, ValueError):
        return None


def _parse_dt_ms(text: str) -> int | None:
    text = (text or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return int(datetime.strptime(text, fmt).timestamp() * 1000)
        except ValueError:
            continue
    return None


def _parse_jsonp(text: str):
    text = (text or "").strip()
    match = _JSONP_RE.search(text)
    payload = match.group(1) if match else text
    return json.loads(payload)


def _http_get(url: str) -> str:
    req = urllib.request.Request(url, headers=_HEADERS)
    with urllib.request.urlopen(req, timeout=12) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _fetch_akshare(symbol: str, period: str) -> list:
    """开发环境若已安装 akshare，作为新浪直连失败时的后备。"""
    try:
        import akshare as ak
        import pandas as pd
    except ImportError:
        return []
    bars = []
    try:
        if period == "1d":
            df = ak.futures_zh_daily_sina(symbol=symbol)
            for _, row in df.iterrows():
                ts = int(pd.Timestamp(row["date"]).timestamp() * 1000)
                bars.append({
                    "t": ts,
                    "o": float(row["open"]),
                    "h": float(row["high"]),
                    "l": float(row["low"]),
                    "c": float(row["close"]),
                    "v": float(row.get("volume", 0) or 0),
                })
        else:
            p = "5" if period == "5m" else "1"
            df = ak.futures_zh_minute_sina(symbol=symbol, period=p)
            for _, row in df.iterrows():
                ts = int(pd.Timestamp(row["datetime"]).timestamp() * 1000)
                bars.append({
                    "t": ts,
                    "o": float(row["open"]),
                    "h": float(row["high"]),
                    "l": float(row["low"]),
                    "c": float(row["close"]),
                    "v": float(row.get("volume", 0) or 0),
                })
    except Exception as exc:
        print(f" [历史K线] akshare 后备失败 {symbol} {period}: {exc}")
        return []
    return bars
