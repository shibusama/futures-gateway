# -*- coding: utf-8 -*-
"""历史 K 线（akshare · 新浪数据源，SimNow 合约代码通用）。"""
import time

_cache = {}  # (symbol, period) -> (ts, bars)
CACHE_TTL = 90  # 秒


def fetch_bars(symbol: str, period: str = "1m") -> list:
    """
    拉取历史 OHLCV。
    period: 1m | 5m | 1d
    返回: [{t, o, h, l, c, v}, ...]  t 为毫秒时间戳
    """
    sym = (symbol or "").upper()
    if not sym:
        return []

    cache_key = (sym, period)
    now = time.time()
    cached = _cache.get(cache_key)
    if cached and now - cached[0] < CACHE_TTL:
        return cached[1]

    try:
        import akshare as ak
        import pandas as pd
    except ImportError:
        return []

    bars = []
    try:
        if period == "1d":
            df = ak.futures_zh_daily_sina(symbol=sym)
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
            df = ak.futures_zh_minute_sina(symbol=sym, period=p)
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
        print(f" [历史K线] {sym} {period} 拉取失败: {exc}")
        return cached[1] if cached else []

    _cache[cache_key] = (now, bars)
    return bars
