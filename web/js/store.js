/**
 * store.js — 前端状态仓库（纯逻辑，无 DOM）
 * 数据源：本地 CTP 网关经 WebSocket 推送的实时数据。
 */
export const store = {
  conn: "closed",           // closed | connecting | open
  view: "overview",         // overview | detail
  activeAcct: null,         // 当前明细页账户名
  sel: "rb2510",            // 当前选中合约
  tf: "1m",
  qty: 1,
  dir: "buy",
  otype: "market",
  limitPx: "",

  ticks: {},                // symbol -> tick 数据（网关推送）
  balances: {},             // account -> 资金快照
  positions: {},            // account -> [position...]
  orders: {},               // account -> [order...]
  trades: {},               // account -> [trade...]
  login: {},                // account -> 登录状态
  accounts: [],             // 网关 hello 时返回的账号列表
  lastShown: [],            // toast 提示防抖
};

/** 按合约取最新价 */
export function pxOf(symbol) {
  const t = store.ticks[symbol];
  return t ? t.price : 0;
}

/** 某账户浮动盈亏（可能缺少乘数信息，按网关推送为准；这里只做现货级估算展示用） */
export function acctFloat(account) {
  const pos = store.positions[account] || [];
  let float = 0;
  pos.forEach((p) => {
    const px = pxOf(p.symbol);
    if (px > 0) {
      const dir = String(p.direction).includes("Long") ? 1 : -1; // 兼容 'Long'/'Short'
      float += (px - (p.open_price || px)) * p.volume * dir;
    }
  });
  return float;
}

/** 总权益等聚合 */
export function totals() {
  let equity = 0, avail = 0, margin = 0, float = 0;
  for (const acc of store.accounts) {
    const b = store.balances[acc];
    if (b) {
      equity += b.balance || 0;
      avail += b.available || 0;
      margin += b.margin || 0;
      float += (b.position_profit || 0) + (b.close_profit || 0);
    } else {
      float += acctFloat(acc);
    }
  }
  return { equity, avail, margin, float };
}

/** 跨账户按品种汇总 */
export function symbolSummary() {
  const map = {};
  for (const acc of store.accounts) {
    (store.positions[acc] || []).forEach((p) => {
      if (!map[p.symbol]) map[p.symbol] = { symbol: p.symbol, long: 0, short: 0, pnl: 0 };
      const isLong = String(p.direction).includes("Long");
      if (isLong) map[p.symbol].long += p.volume;
      else map[p.symbol].short += p.volume;
      map[p.symbol].pnl += (p.position_profit || 0);
    });
  }
  return Object.values(map).sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
}

export function emit(msg) {
  window.dispatchEvent(new CustomEvent("ftd-event", { detail: msg }));
}