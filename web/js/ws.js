/**
 * ws.js — 与本地网关的 WebSocket 连接管理。
 * 连接 ws://127.0.0.1:8765/ws（与网关 config.json host/port 对应；页面本身由网关静态服务托管）。
 */
import { store, emit, mergeLoginStatus, applyTick, seedTick, loadTicksFromStorage } from "./store.js";
import { getWatchlistCodes } from "./symbols.js";

loadTicksFromStorage();

function touchAccountLink(account, status) {
  if (!account) return;
  const now = Date.now();
  const ok = status === "ok" || status === "md_ok";
  if (!store.accountLinkAt[account]) store.accountLinkAt[account] = { trade: null, md: null };
  const slot = status === "md_ok" ? "md" : "trade";
  store.accountLinkAt[account][slot] = { at: now, ok };
}

let ws = null;
let retryTimer = null;
let balancePollTimer = null;
let reconnectDelay = 3000;
const RECONNECT_BASE = 3000;
const RECONNECT_MAX = 15000;

function stopBalancePolling() {
  clearInterval(balancePollTimer);
  balancePollTimer = null;
}

function needsBalanceSync() {
  return store.accounts.some((acc) => {
    const login = store.login[acc];
    return (login === "ok" || login === "md_ok") && !store.balances[acc];
  });
}

function ensureBalancePolling() {
  if (balancePollTimer || !needsBalanceSync()) return;
  let attempts = 0;
  const tick = () => {
    if (store.conn !== "open" || !needsBalanceSync()) {
      stopBalancePolling();
      return;
    }
    attempts += 1;
    send({ cmd: "query" });
    if (attempts >= 8) stopBalancePolling();
  };
  tick();
  balancePollTimer = setInterval(tick, 2500);
}

function teardownSocket() {
  clearTimeout(retryTimer);
  retryTimer = null;
  stopBalancePolling();
  if (!ws) return;
  ws.onopen = null;
  ws.onmessage = null;
  ws.onerror = null;
  ws.onclose = null;
  try {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(1000, "page refresh");
    }
  } catch (_) { /* ignore */ }
  ws = null;
}

export function connect() {
  teardownSocket();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/ws`;
  store.conn = "connecting";
  emit({ type: "conn", status: "connecting" });

  try {
    ws = new WebSocket(url);
  } catch (e) {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    const reconnected = store.wasConnected;
    store.conn = "open";
    store.gatewayLinkAt = Date.now();
    store.reconnectAttempt = 0;
    reconnectDelay = RECONNECT_BASE;
    store.wasConnected = true;
    emit({ type: "conn", status: "open", reconnected });
    send({ cmd: "status" });
    send({ cmd: "query" });
    send({ cmd: "subscribe", symbols: getWatchlistCodes() });
    ensureBalancePolling();
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }
    handle(msg);
  };

  ws.onclose = () => {
    const hadConnection = store.wasConnected;
    store.conn = "closed";
    store.reconnectAttempt += 1;
    emit({ type: "conn", status: "closed", attempt: store.reconnectAttempt, hadConnection });
    checkAuthAndMaybeRedirect();
    scheduleReconnect();
  };

  ws.onerror = () => { /* onclose 会触发重连 */ };
}

function scheduleReconnect() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(RECONNECT_MAX, Math.round(reconnectDelay * 1.4));
}

/** 服务端明确表示“未认证”（如会话失效/被登出）时，停止重连并跳登录页。 */
async function checkAuthAndMaybeRedirect() {
  try {
    const res = await fetch("/api/session", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.authenticated === false) {
      const dest = location.pathname + location.search || "/";
      const safe = dest.startsWith("/") && !dest.startsWith("//") ? dest : "/";
      location.replace(`/login.html?next=${encodeURIComponent(safe)}`);
    }
  } catch (_) {
    /* 网关不可达：保持自动重连 */
  }
}

/** 处理网关推来的各类事件，写入 store 并广播渲染 */
function handle(msg) {
  const type = msg.type;
  const account = msg.account;

  if (type === "system") {
    if (msg.cmd === "query_ok") {
      for (const acc of store.accounts) {
        store.positions[acc] = [];
        store.trades[acc] = [];
      }
      emit({ type: "system", data: msg });
      return;
    }
    if (msg.cmd === "cancel_result" || msg.cmd === "order_result") {
      const data = msg.data || {};
      emit({
        type: "toast",
        msg: data.ok ? (data.msg || "操作已提交") : (data.msg || "操作失败"),
      });
      return;
    }
    if (msg.cmd === "subscribe_result") {
      const data = msg.data || {};
      if (!data.ok && data.msg) emit({ type: "toast", msg: data.msg });
      return;
    }
    if (msg.cmd === "hello" || msg.cmd === "status") {
      const data = msg.data || {};
      if (data.accounts && data.accounts.length) {
        store.accounts = data.accounts;
        // 从 last_states 恢复登录状态
        data.last_states = data.last_states || {};
        for (const acc of store.accounts) {
          const st = data.last_states[acc] || {};
          const login = st.login;
          store.login[acc] = (login === "md_ok" && st.balance) ? "ok" : (login || null);
          if (store.login[acc] === "ok" || store.login[acc] === "md_ok") {
            touchAccountLink(acc, store.login[acc]);
          }
          if (st.balance) store.balances[acc] = st.balance;
          if (st.positions && st.positions.length) store.positions[acc] = st.positions;
          if (st.trades && st.trades.length) store.trades[acc] = st.trades;
        }
        if (data.last_ticks) {
          Object.entries(data.last_ticks).forEach(([sym, tick]) => seedTick(sym, tick));
        }
      }
      emit({ type: "system", data });
      ensureBalancePolling();
    }
    return;
  }

  // account 相关的实时事件
  if (type === "login") {
    store.login[account] = mergeLoginStatus(store.login[account], msg.status);
    touchAccountLink(account, msg.status);
    emit({ type: "login", account, status: store.login[account], msg: msg.msg });
    if (msg.status === "ok" && !store.balances[account]) {
      ensureBalancePolling();
    }
    return;
  }
  if (type === "balance") {
    store.balances[account] = msg;
    if (!needsBalanceSync()) stopBalancePolling();
    emit({ type: "balance", account });
    return;
  }
  if (type === "tick") {
    applyTick(msg);
    emit({ type: "tick", symbol: msg.symbol });
    return;
  }
  if (type === "position") {
    if (!store.positions[account]) store.positions[account] = [];
    // 用 symbol+direction 去重（同一合约多空各一条）
    const key = `${msg.symbol}_${msg.direction}`;
    let list = store.positions[account].filter((p) => !(`${p.symbol}_${p.direction}` === key));
    if (msg.volume > 0) list.push(msg);
    store.positions[account] = list;
    emit({ type: "position", account });   // 每收到就渲染，不依赖 is_last（分页可能不触发 is_last）
    return;
  }
  if (type === "order") {
    if (!store.orders[account]) store.orders[account] = [];
    // 用 OrderSysID/OrderRef 去重，最新在前
    store.orders[account] = [
      msg,
      ...store.orders[account].filter((o) => !(o.order_sys_id && o.order_sys_id === msg.order_sys_id)),
    ].slice(0, 100);
    emit({ type: "order", account });
    return;
  }
  if (type === "trade") {
    if (!store.trades[account]) store.trades[account] = [];
    const key = `${msg.trade_id || ""}|${msg.symbol}|${msg.time || ""}|${msg.volume || 0}`;
    store.trades[account] = [
      msg,
      ...store.trades[account].filter(
        (t) => `${t.trade_id || ""}|${t.symbol}|${t.time || ""}|${t.volume || 0}` !== key,
      ),
    ].slice(0, 500);
    emit({ type: "trade", account });
    return;
  }
  if (type === "error") {
    emit({ type: "error", msg: msg.msg || "未知错误" });
    return;
  }
}

/** 刷新 WebSocket（F5 / 刷新按钮用，不整页 reload） */
export function reconnect() {
  teardownSocket();
  store.conn = "closed";
  connect();
}

window.addEventListener("beforeunload", () => {
  teardownSocket();
});

export function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

/** 下单指令 → 网关 */
export function sendOrder({ account, symbol, direction, offset, price, volume }) {
  send({ cmd: "order", account, symbol, direction, offset, price, volume });
}

/** 撤单指令 → 网关 */
export function sendCancel({ account, order_sys_id, symbol, exchange }) {
  send({ cmd: "cancel", account, order_sys_id, symbol, exchange });
}

/** 订阅自选合约行情 */
export function sendSubscribe(symbols) {
  send({ cmd: "subscribe", symbols });
}

/** 请求网关刷新所有账号数据 */
export function requestQuery() {
  send({ cmd: "query" });
}