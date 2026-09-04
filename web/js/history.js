/**
 * history.js — 从网关拉取历史 K 线（新浪期货分钟/日线）
 */
import { store, emit, seedTick } from "./store.js";
import { isOfflineMode } from "./offline.js";

const inflight = new Set();

const TICK_SIZES = {
  rb2610: 1, cu2611: 10, au2612: 0.02, ag2612: 1,
  sc2609: 0.1, IF2609: 0.2, m2609: 1, i2609: 0.5,
};

export function historyKey(symbol, tf) {
  return `${symbol}_${tf}`;
}

function seedFromBars(symbol, bars) {
  if (!bars?.length) return;
  const last = bars[bars.length - 1];
  const ts = last.t || Date.now();
  const tsz = TICK_SIZES[symbol] || 1;
  seedTick(symbol, {
    price: last.c,
    // 涨跌基准应为前一收盘，而非当日开盘
    pre_close: bars.length >= 2 ? bars[bars.length - 2].c : last.o,
    open: last.o,
    high: last.h,
    low: last.l,
    bid1: last.c - tsz,
    ask1: last.c + tsz,
    bidv1: 1,
    askv1: 1,
    _ts: ts,
    _fromHistory: true,
  });
}

/** 异步拉取历史 K 线，完成后触发 history 事件 */
export function fetchBarHistory(symbol, tf = store.tf) {
  const key = historyKey(symbol, tf);
  if (inflight.has(key)) return Promise.resolve(store.barHistory[key] || []);
  inflight.add(key);
  return fetch(`/api/bars?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(tf)}`)
    .then((r) => r.json())
    .then((data) => {
      if (data.ok && Array.isArray(data.bars)) {
        store.barHistory[key] = data.bars;
        seedFromBars(symbol, data.bars);
        emit({ type: "history", symbol, tf, count: data.bars.length });
      } else {
        store.barHistory[key] = store.barHistory[key] || [];
      }
      return store.barHistory[key] || [];
    })
    .catch(() => [])
    .finally(() => inflight.delete(key));
}
