/**
 * candles.js — 历史 + 实时 tick 聚合成 K 线数据（不依赖图表库）。
 *
 * 历史 K 线来自新浪实盘；盘口 tick 来自 SimNow 仿真。两路价格经常差几十点，
 * 不能无条件拼在同一根蜡烛上，否则末根会变成假阳/假高开。
 */
import { store } from "./store.js";
import { historyKey } from "./history.js";
import { symbolMeta } from "./symbols.js";

const DISPLAY_SLOTS = 500;

function tfBucketMs(tf) {
  if (tf === "5m") return 5 * 60000;
  if (tf === "1d") return 24 * 3600000;
  return 60000;
}

function overlayTolerance(symbol, px) {
  const tick = symbolMeta(symbol)?.tick || 1;
  return Math.max(Math.abs(px) * 0.0015, tick * 8);
}

/** 仅当仿真价仍落在当前这根未完成的新浪 K 线上、且价格接近时，才用 tick 改收盘价。 */
export function shouldOverlayLive(symbol, livePx) {
  if (!(livePx > 0)) return false;
  const history = store.barHistory[historyKey(symbol, store.tf)] || [];
  if (!history.length) return false;
  const last = history[history.length - 1];
  const bucket = tfBucketMs(store.tf);
  if (Math.floor(last.t / bucket) !== Math.floor(Date.now() / bucket)) return false;
  return Math.abs(livePx - last.c) <= overlayTolerance(symbol, last.c);
}

function buildLiveCandles(symbol) {
  const hist = store.tickHistory[symbol];
  if (!hist || !hist.length) return [];

  const bucketMs = tfBucketMs(store.tf);
  const buckets = {};
  let prevCumVol = null;

  hist.forEach((t) => {
    const px = t.price;
    if (!px || !isFinite(px) || px <= 0) return;
    const ts = t._ts || Date.now();
    const key = Math.floor(ts / bucketMs) * bucketMs;
    if (!buckets[key]) {
      buckets[key] = { t: key, o: px, h: px, l: px, c: px, v: 0 };
    }
    const b = buckets[key];
    b.h = Math.max(b.h, px);
    b.l = Math.min(b.l, px);
    b.c = px;

    const cum = t.volume || 0;
    if (prevCumVol != null && cum > prevCumVol) {
      b.v += cum - prevCumVol;
    } else if (prevCumVol == null || cum === prevCumVol) {
      b.v += 1;
    }
    prevCumVol = cum;
  });

  return Object.values(buckets).sort((a, b) => a.t - b.t);
}

export function buildCandles(symbol) {
  const key = historyKey(symbol, store.tf);
  const history = store.barHistory[key] || [];
  const live = buildLiveCandles(symbol);
  if (!history.length) {
    return live.slice(-DISPLAY_SLOTS);
  }

  const map = new Map();
  history.forEach((b) => map.set(b.t, { ...b }));

  const lastHist = history[history.length - 1];
  const bucket = tfBucketMs(store.tf);
  const nowBucket = Math.floor(Date.now() / bucket) * bucket;
  const tol = overlayTolerance(symbol, lastHist.c);

  live.forEach((b) => {
    // 已走完的历史分钟一律不动；否则 SimNow 价会把连续几根实盘 K 拉成通天柱
    if (b.t !== nowBucket || store.tf === "1d") return;
    const prev = map.get(b.t);
    if (prev) {
      if (Math.abs(b.c - prev.c) > tol) return;
      const h = Math.max(prev.h, b.c);
      const l = Math.min(prev.l, b.c);
      if (h - l > tol * 2) return;
      map.set(b.t, {
        ...prev,
        c: b.c,
        h,
        l,
        v: Math.max(prev.v || 0, b.v || 0),
      });
      return;
    }
    if (b.t < lastHist.t) return;
    if (Math.abs((b.o || b.c) - lastHist.c) > tol && Math.abs(b.c - lastHist.c) > tol) return;
    map.set(b.t, { ...b });
  });

  return Array.from(map.values())
    .sort((a, b) => a.t - b.t)
    .slice(-DISPLAY_SLOTS);
}
