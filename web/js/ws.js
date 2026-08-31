/**
 * ws.js — 与本地网关的 WebSocket 连接管理。
 * 连接 ws://127.0.0.1:8765/ws（与网关 config.json host/port 对应；页面本身由网关静态服务托管）。
 */
import { store, emit } from "./store.js";

let ws = null;
let retryTimer = null;
let reconnectDelay = 3000;

export function connect() {
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
    store.conn = "open";
    emit({ type: "conn", status: "open" });
    send({ cmd: "status" });
    send({ cmd: "query" });
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }
    handle(msg);
  };

  ws.onclose = () => {
    store.conn = "closed";
    emit({ type: "conn", status: "closed" });
    scheduleReconnect();
  };

  ws.onerror = () => { /* onclose 会触发重连 */ };
}

function scheduleReconnect() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, reconnectDelay);
}

/** 处理网关推来的各类事件，写入 store 并广播渲染 */
function handle(msg) {
  const type = msg.type;
  const account = msg.account;

  if (type === "system") {
    if (msg.cmd === "hello" || msg.cmd === "status") {
      const data = msg.data || {};
      if (data.accounts && data.accounts.length) {
        store.accounts = data.accounts;
        // 从 last_states 恢复登录状态
        data.last_states = data.last_states || {};
        for (const acc of store.accounts) {
          store.login[acc] = (data.last_states[acc] && data.last_states[acc].login) || null;
        }
      }
      emit({ type: "system", data });
    }
    return;
  }

  // account 相关的实时事件
  if (type === "login") {
    store.login[account] = msg.status;
    emit({ type: "login", account, status: msg.status, msg: msg.msg });
    return;
  }
  if (type === "balance") {
    store.balances[account] = msg;
    emit({ type: "balance", account });
    return;
  }
  if (type === "tick") {
    store.ticks[msg.symbol] = msg;
    emit({ type: "tick", symbol: msg.symbol });
    return;
  }
  if (type === "position") {
    if (!store.positions[account]) store.positions[account] = [];
    const list = store.positions[account].filter((p) => !(p.symbol === msg.symbol && p.direction === msg.direction));
    if (msg.volume > 0) list.push(msg);
    store.positions[account] = list;
    if (msg.is_last) emit({ type: "position", account });
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
    store.trades[account] = [msg, ...store.trades[account]].slice(0, 100);
    emit({ type: "trade", account });
    return;
  }
  if (type === "error") {
    emit({ type: "error", msg: msg.msg || "未知错误" });
    return;
  }
}

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

/** 请求网关刷新所有账号数据 */
export function requestQuery() {
  send({ cmd: "query" });
}