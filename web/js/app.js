/**
 * app.js — 应用入口：装配 store / ws / ui 模块，绑定事件，响应网关推送。
 */
import { store, totals, emit } from "./store.js";
import { connect, sendOrder, sendCancel, sendSubscribe } from "./ws.js";
import { fetchBarHistory } from "./history.js";
import { renderOverview } from "./ui_overview.js";
import { renderDetail, rerenderChart, selectSymbol, refreshDetailLive } from "./ui_detail.js";
import { bindChartHover } from "./chart.js";
import { initOfflineDemo, isOfflineMode } from "./offline.js";
import { initTheme, toggleTheme } from "./theme.js";
import { bindAboutDialog } from "./about.js";
import { addWatchlistSymbol, removeWatchlistSymbol } from "./symbols.js";

/* ---------- 视图切换 ---------- */
function showView(v) {
  store.view = v;
  document.getElementById("view-overview").style.display = v === "overview" ? "block" : "none";
  document.getElementById("view-detail").style.display = v === "detail" ? "block" : "none";
  document.getElementById("nav-overview").className = "nt" + (v === "overview" ? " active" : "");
  document.getElementById("nav-detail").className = "nt" + (v === "detail" ? " active" : "");
  render();
}

/* ---------- 渲染入口 ---------- */
function render() {
  renderHeader(store.conn);
  if (store.view === "overview") renderOverview();
  else renderDetail();
}

function renderHeader(conn) {
  const badge = document.getElementById("conn-badge");
  badge.textContent = conn === "open" ? "CTP 已连接"
    : conn === "connecting" ? (store.reconnectAttempt ? `重连中 (${store.reconnectAttempt})` : "连接中")
    : conn === "offline" ? "UI 对比"
    : store.reconnectAttempt ? `已断开 · 重连 ${store.reconnectAttempt}` : "未连接";
  badge.className = "demo-badge " + (conn === "open" ? " ok" : conn === "connecting" ? " wait" : conn === "offline" ? " wait" : " err");

  const banner = document.getElementById("conn-banner");
  if (banner) {
    if (conn === "open") {
      banner.hidden = true;
      banner.textContent = "";
    } else if (conn === "connecting" && store.wasConnected) {
      banner.hidden = false;
      banner.textContent = `与网关断开，正在重连…（第 ${store.reconnectAttempt || 1} 次）`;
    } else if (conn === "closed" && store.wasConnected) {
      banner.hidden = false;
      banner.textContent = `与网关断开，正在自动重连…（第 ${store.reconnectAttempt || 1} 次）`;
    } else {
      banner.hidden = conn !== "closed";
      banner.textContent = conn === "closed" ? "未连接到本地网关，请确认 FuturesTerminal 或 gateway 已启动" : "";
    }
  }
  document.getElementById("clock").textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  // 顶部聚合条
  if (store.view === "overview") {
    const t = totals();
    const cls = (v) => (v >= 0 ? "up" : "down");
    const n = (v) => (t.hasBalance ? fmtN(v) : "—");
    document.getElementById("acct-strip").innerHTML = `
      <div class="acct-item"><span>总权益</span><b class="${t.hasBalance ? cls(t.equity) : ""}">${n(t.equity)}</b></div>
      <div class="acct-item"><span>可用资金</span><b>${n(t.avail)}</b></div>
      <div class="acct-item"><span>浮动盈亏</span><b class="${t.hasBalance ? cls(t.float) : ""}">${n(t.float)}</b></div>
      <div class="acct-item"><span>占用保证金</span><b>${n(t.margin)}</b></div>`;
  } else {
    const b = store.balances[store.activeAcct];
    document.getElementById("acct-strip").innerHTML = b
      ? `<div class="acct-item"><span>该账户权益</span><b>${fmtN(b.balance)}</b></div>
         <div class="acct-item"><span>可用</span><b>${fmtN(b.available)}</b></div>`
      : `<div class="acct-item"><span>该账户</span><b>—</b></div>`;
  }
}
function fmtN(v) { return Number(v || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 }); }

/* ---------- 事件 ---------- */
function bindEvents() {
  document.getElementById("nav-overview").addEventListener("click", () => showView("overview"));
  document.getElementById("nav-detail").addEventListener("click", () => showView("detail"));
  document.getElementById("back-btn").addEventListener("click", () => showView("overview"));
  document.getElementById("theme-toggle").addEventListener("click", () => toggleTheme());

  // 概览汇总 Tab
  document.getElementById("sum-tab-symbol").addEventListener("click", () => { store.sumTab = "symbol"; render(); });
  document.getElementById("sum-tab-account").addEventListener("click", () => { store.sumTab = "account"; render(); });

  // 按账户汇总行 → 下钻
  document.getElementById("sum-body-account").addEventListener("click", (e) => {
    const row = e.target.closest("[data-acct]");
    if (row) { store.activeAcct = row.getAttribute("data-acct"); showView("detail"); }
  });

  // 概览账户行 → 下钻
  document.getElementById("acct-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (btn) { store.activeAcct = btn.getAttribute("data-view"); showView("detail"); }
  });

  // 行情列表选合约 / 移除
  document.getElementById("watchlist").addEventListener("click", (e) => {
    const removeBtn = e.target.closest("[data-remove]");
    if (removeBtn) {
      e.stopPropagation();
      const code = removeBtn.getAttribute("data-remove");
      const res = removeWatchlistSymbol(code);
      if (!res.ok) { toast(res.msg); return; }
      if (store.sel.toLowerCase() === code.toLowerCase()) {
        store.sel = res.codes[0];
      }
      if (store.conn === "open") sendSubscribe(res.codes);
      toast(`已移除 ${code}`);
      render();
      return;
    }
    const b = e.target.closest(".wl-row");
    if (!b) return;
    const code = b.getAttribute("data-code");
    if (code === store.sel) return;
    document.querySelectorAll("#watchlist .wl-item.active").forEach((r) => r.classList.remove("active"));
    b.closest(".wl-item")?.classList.add("active");
    selectSymbol(code);
  });

  document.getElementById("wl-add-btn").addEventListener("click", () => {
    const input = document.getElementById("wl-add-input");
    const raw = input.value.trim();
    if (!raw) { toast("请输入合约代码"); return; }
    const res = addWatchlistSymbol(raw);
    if (!res.ok) { toast(res.msg); return; }
    input.value = "";
    if (store.conn === "open") sendSubscribe(res.codes);
    toast(res.msg);
    render();
  });
  document.getElementById("wl-add-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("wl-add-btn").click();
  });

  // 周期切换
  document.getElementById("tf-tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tf");
    if (b) {
      store.tf = b.getAttribute("data-tf");
      delete store.barHistory[`${store.sel}_${store.tf}`];
      fetchBarHistory(store.sel, store.tf);
      rerenderChart();
    }
  });

  // 下单面板
  document.getElementById("dir-buy").addEventListener("click", () => { store.dir = "buy"; render(); });
  document.getElementById("dir-sell").addEventListener("click", () => { store.dir = "sell"; render(); });
  document.getElementById("qty-minus").addEventListener("click", () => { store.qty = Math.max(1, store.qty - 1); render(); });
  document.getElementById("qty-plus").addEventListener("click", () => { store.qty = Math.min(999, store.qty + 1); render(); });
  document.getElementById("qty-input").addEventListener("change", (e) => { store.qty = Math.max(1, parseInt(e.target.value, 10) || 1); render(); });
  document.getElementById("otype-market").addEventListener("click", () => { store.otype = "market"; render(); });
  document.getElementById("otype-limit").addEventListener("click", () => {
    store.otype = "limit";
    const t = store.ticks[store.sel];
    if (t) document.getElementById("limit-input").value = t.price.toFixed(1);
    render();
  });
  document.getElementById("limit-input").addEventListener("change", (e) => { store.limitPx = e.target.value; });

  // 下单
  document.getElementById("submit-btn").addEventListener("click", () => {
    const account = store.activeAcct;
    if (!account) { toast("请先在概览页选择账户"); return; }
    if (store.conn !== "open") { toast("网关未连接"); return; }
    const tick = store.ticks[store.sel];
    if (!tick) { toast("暂无该合约行情"); return; }
    const price = store.otype === "market" ? (store.dir === "buy" ? (tick.ask1 || tick.price) : (tick.bid1 || tick.price)) : parseFloat(store.limitPx);
    if (!isFinite(price)) { toast("请输入有效价格"); return; }
    sendOrder({
      account, symbol: store.sel, direction: store.dir, offset: "open",
      price, volume: store.qty,
    });
    toast(`已发送 ${store.dir === "buy" ? "买入开多" : "卖出开空"} ${store.qty} 手 委托`);
  });

  // 持仓/委托页签
  document.getElementById("tab-pos").addEventListener("click", () => { store.tab = "pos"; render(); });
  document.getElementById("tab-ord").addEventListener("click", () => { store.tab = "ord"; render(); });

  // 撤单
  document.getElementById("tables").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cancel-order]");
    if (!btn) return;
    const account = store.activeAcct;
    if (!account) { toast("请先选择账户"); return; }
    if (store.conn !== "open") { toast("网关未连接"); return; }
    const orderSysId = btn.getAttribute("data-cancel-order");
    const symbol = btn.getAttribute("data-symbol");
    const exchange = btn.getAttribute("data-exchange");
    if (!orderSysId) { toast("缺少报单编号，无法撤单"); return; }
    sendCancel({ account, order_sys_id: orderSysId, symbol, exchange });
    toast(`撤单已发送：${symbol}`);
  });

  // K线悬停（Lightweight Charts 内置十字光标）
  bindChartHover(document.getElementById("chart-container"), () => {
    if (store.view === "detail") rerenderChart();
  });
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(text) {
  const t = document.getElementById("toast");
  t.textContent = text;
  t.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = "none"; }, 3000);
}

/* ---------- 网关推送 → 渲染 ---------- */
let tickRaf = null;
function onTickFrame() {
  tickRaf = null;
  if (store.view === "detail") {
    refreshDetailLive();
  } else {
    renderHeader("open");
    renderOverview();
  }
}
window.addEventListener("ftd-event", (e) => {
  const d = e.detail;
  if (d.type === "conn") {
    renderHeader(d.status);
    if (d.status === "open" && d.reconnected) toast("已重新连接到网关");
    else if (d.status === "closed" && d.hadConnection) toast("与网关断开，正在自动重连…");
  }
  else if (d.type === "system" || d.type === "login" || d.type === "balance" || d.type === "position" || d.type === "history") {
    render();
  } else if (d.type === "tick") {
    if (!tickRaf) tickRaf = requestAnimationFrame(onTickFrame);
  } else if (d.type === "order" || d.type === "trade") {
    if (store.view === "detail") renderDetail();
  } else if (d.type === "error") {
    toast(d.msg);
  } else if (d.type === "toast") {
    toast(d.msg);
  }
});

/* ---------- 启动 ---------- */
bindEvents();
bindAboutDialog();
initTheme();

if (isOfflineMode()) {
  initOfflineDemo();
  render();
  const foot = document.querySelector(".foot");
  if (foot) foot.textContent = "UI 对比模式 · 演示数据 · 不连接 Python 网关 · 不构成投资建议";
} else {
  connect();
}

window.addEventListener("theme-change", () => {
  if (store.view === "detail") rerenderChart();
  render();
});

// 时钟
setInterval(() => {
  document.getElementById("clock").textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
}, 1000);