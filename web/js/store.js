/**
 * store.js — 前端状态仓库（纯逻辑，无 DOM）
 * 数据源：本地 CTP 网关经 WebSocket 推送的实时数据。
 */
export const store = {
  conn: "closed",           // closed | connecting | open
  view: "overview",         // overview | detail
  activeAcct: null,         // 当前明细页账户名
  sel: "rb2610",            // 当前选中合约
  tf: "1m",
  qty: 1,
  dir: "buy",
  otype: "market",
  limitPx: "",

  ticks: {},                // symbol -> tick 数据（网关推送，最新一笔）
  lastTicks: {},            // symbol -> 最后一次有效 tick（断流时保留）
  tickHistory: {},          // symbol -> tick 数组（用于聚合 K 线，保留最近 ~300 笔）
  balances: {},             // account -> 资金快照
  positions: {},            // account -> [position...]
  orders: {},               // account -> [order...]
  trades: {},               // account -> [trade...]
  login: {},                // account -> 登录状态
  accounts: [],             // 网关 hello 时返回的账号列表
  barHistory: {},           // symbol_tf -> [{t,o,h,l,c,v}]
  lastShown: [],            // toast 提示防抖
  sumTab: "symbol",         // overview 汇总区：symbol | account
};

const TICK_STORAGE_KEY = "fg_last_ticks";

/** 启动时从 localStorage 恢复上次行情快照 */
export function loadTicksFromStorage() {
  try {
    const raw = localStorage.getItem(TICK_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data && typeof data === "object") {
      store.lastTicks = { ...store.lastTicks, ...data };
    }
  } catch (_) { /* ignore */ }
}

export function saveTicksToStorage() {
  try {
    localStorage.setItem(TICK_STORAGE_KEY, JSON.stringify(store.lastTicks));
  } catch (_) { /* ignore */ }
}

/** 取最新 tick：实时优先，否则用最后一次快照 */
export function getTick(symbol) {
  return store.ticks[symbol] || store.lastTicks[symbol] || null;
}

/** 是否仍在接收实时 tick（2 分钟内有更新） */
export function tickIsLive(symbol) {
  const t = store.ticks[symbol];
  if (!t) return false;
  const ts = t._ts || t._savedAt || 0;
  return ts > 0 && Date.now() - ts < 120000;
}

/** 写入 tick（实时 + 快照 + 持久化） */
export function applyTick(msg) {
  if (!msg?.symbol) return;
  const sym = msg.symbol;
  const now = Date.now();
  const tick = { ...msg, _savedAt: now };
  store.ticks[sym] = tick;
  store.lastTicks[sym] = tick;
  if (!store.tickHistory[sym]) store.tickHistory[sym] = [];
  store.tickHistory[sym].push(tick);
  if (store.tickHistory[sym].length > 2000) store.tickHistory[sym].shift();
  saveTicksToStorage();
}

/** 从网关 hello / 历史 K 线补种子行情（不覆盖更新的快照） */
export function seedTick(symbol, seed) {
  if (!symbol || !seed) return;
  const cur = store.lastTicks[symbol];
  const curTs = cur?._ts || cur?._savedAt || 0;
  const seedTs = seed._ts || seed._savedAt || 0;
  if (cur && curTs >= seedTs) return;
  store.lastTicks[symbol] = { ...seed, symbol, _snapshot: true, _savedAt: seedTs || Date.now() };
  if (!store.ticks[symbol]) store.ticks[symbol] = store.lastTicks[symbol];
  saveTicksToStorage();
}

/** 按合约取最新价 */
export function pxOf(symbol) {
  const t = getTick(symbol);
  const p = t?.price;
  return p && p > 0 && isFinite(p) ? p : 0;
}

/** 合约乘数（估算浮动盈亏；无 tick 时回退网关推送值） */
export function contractMult(symbol) {
  const p = String(symbol || "").replace(/\d+$/, "").toUpperCase();
  const map = {
    RB: 10, HC: 10, I: 100, J: 100, JM: 60, SS: 5,
    CU: 5, AL: 5, ZN: 5, NI: 1, SN: 1, AU: 1000, AG: 15,
    SC: 1000, FU: 10, BU: 10, RU: 10,
    IF: 300, IH: 300, IC: 200, IM: 200,
    M: 10, Y: 10, P: 10, C: 10, A: 10, B: 10,
    CF: 5, SR: 10, TA: 5, MA: 10, FG: 20,
  };
  return map[p] || 10;
}

/** 单笔持仓实时浮动盈亏 */
export function positionLivePnl(p) {
  const px = pxOf(p.symbol);
  if (!(px > 0) || !p.volume) return p.position_profit || 0;
  const dir = String(p.direction).includes("Long") ? 1 : -1;
  const open = p.open_price || px;
  return (px - open) * p.volume * contractMult(p.symbol) * dir;
}

/** 某账户浮动盈亏（持仓按 tick 实时估算 + 已平仓盈亏） */
export function acctFloat(account) {
  const pos = store.positions[account] || [];
  let float = 0;
  pos.forEach((p) => { float += positionLivePnl(p); });
  const b = store.balances[account];
  if (b) float += b.close_profit || 0;
  else if (!pos.length) return 0;
  return float;
}

/** 总权益等聚合 */
export function totals() {
  let equity = 0, avail = 0, margin = 0, float = 0;
  for (const acc of store.accounts) {
    const b = store.balances[acc];
    const liveFloat = acctFloat(acc);
    float += liveFloat;
    if (b) {
      const staleFloat = (b.position_profit || 0) + (b.close_profit || 0);
      const floatDelta = liveFloat - staleFloat;
      equity += (b.balance || 0) + floatDelta;
      avail += (b.available || 0) + floatDelta;
      margin += b.margin || 0;
    }
  }
  return { equity, avail, margin, float };
}

/** 账户登录状态 → 界面文案（ok / md_ok 均视为已登录） */
export function loginBadge(status, hasBalance = false) {
  if (status === "ok" || status === "md_ok" || (hasBalance && status !== "fail" && status !== "disconnected")) {
    return { text: "已登录", ok: true };
  }
  const map = { connecting: "连接中", disconnected: "已断开", fail: "登录失败", closed: "未连接" };
  return { text: map[status] || "未连接", ok: false };
}

/** 合并登录状态：交易 ok 不被行情 md_ok 覆盖 */
export function mergeLoginStatus(prev, next) {
  if (prev === "ok" && next === "md_ok") return "ok";
  return next ?? prev;
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
      map[p.symbol].pnl += positionLivePnl(p);
    });
  }
  return Object.values(map).sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
}

/** 按账户汇总持仓 */
export function accountSummary() {
  return store.accounts.map((acc) => {
    const pos = store.positions[acc] || [];
    let long = 0;
    let short = 0;
    let pnl = 0;
    let margin = 0;
    pos.forEach((p) => {
      const isLong = String(p.direction).includes("Long");
      if (isLong) long += p.volume;
      else short += p.volume;
      pnl += positionLivePnl(p);
      margin += p.margin || 0;
    });
    const b = store.balances[acc];
    if (!pos.length && b) {
      pnl = acctFloat(acc);
      margin = b.margin || 0;
    }
    return { account: acc, long, short, pnl, margin, symbols: pos.length };
  });
}

export function emit(msg) {
  window.dispatchEvent(new CustomEvent("ftd-event", { detail: msg }));
}