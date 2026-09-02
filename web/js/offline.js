/**
 * offline.js — 纯静态 UI 对比模式（不连 Python 网关 / WebSocket）
 * 用法：http://127.0.0.1:5173/?offline=1
 */
import { store, emit, seedTick } from "./store.js";

export function isOfflineMode() {
  return new URLSearchParams(location.search).has("offline");
}

export function initOfflineDemo() {
  store.conn = "offline";
  store.accounts = ["SimNow一号", "SimNow二号"];
  store.activeAcct = "SimNow一号";
  store.login = { "SimNow一号": "ok", "SimNow二号": "ok" };

  store.balances["SimNow一号"] = {
    account: "208427",
    balance: 5536519,
    available: 3736649,
    margin: 1800000,
    position_profit: 6330,
    close_profit: 0,
  };
  store.balances["SimNow二号"] = {
    account: "212893",
    balance: 49706981,
    available: 48137169,
    margin: 1567000,
    position_profit: -75925,
    close_profit: 0,
  };

  store.positions["SimNow一号"] = [
    { symbol: "AP610", direction: "Long", volume: 10, avail: 10, open_price: 8010, position_profit: 1200, margin: 82000 },
    { symbol: "CF609", direction: "Long", volume: 18, avail: 18, open_price: 13800, position_profit: 5130, margin: 95000 },
  ];
  store.positions["SimNow二号"] = [
    { symbol: "CJ609", direction: "Short", volume: 11, avail: 11, open_price: 10250, position_profit: -8200, margin: 76000 },
    { symbol: "FG609", direction: "Long", volume: 6, avail: 6, open_price: 1180, position_profit: -1800, margin: 42000 },
  ];

  const now = Date.now();
  const ticks = [
    ["rb2610", 3123, 3143, 3146, 3149, 3107],
    ["cu2611", 78540, 78600, 78700, 78800, 78400],
    ["au2612", 568.5, 567.2, 569.0, 570.1, 566.8],
    ["ag2612", 8120, 8100, 8150, 8180, 8080],
    ["IF2609", 3850.2, 3842.0, 3855.0, 3862.0, 3838.0],
  ];
  ticks.forEach(([sym, price, pre, open, high, low]) => {
    seedTick(sym, {
      price,
      pre_close: pre,
      open,
      high,
      low,
      bid1: price - 1,
      ask1: price + 1,
      bidv1: 12,
      askv1: 8,
      _ts: now,
    });
  });

  // 演示 K 线（离线模式无 /api/bars）
  const bars = [];
  let px = 3140;
  for (let i = 60; i >= 0; i--) {
    const t = now - i * 60000;
    const o = px;
    const c = px + (Math.random() - 0.5) * 8;
    const h = Math.max(o, c) + Math.random() * 4;
    const l = Math.min(o, c) - Math.random() * 4;
    bars.push({ t, o, h, l, c, v: 800 + Math.floor(Math.random() * 400) });
    px = c;
  }
  store.barHistory["rb2610_1m"] = bars;
  store.barHistory["rb2610_5m"] = bars.filter((_, i) => i % 5 === 0);
  store.barHistory["rb2610_1d"] = bars.filter((_, i) => i % 15 === 0);

  emit({ type: "conn", status: "offline" });
  emit({ type: "system" });
}
