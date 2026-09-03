/**
 * app.js — 应用入口：装配 store / ws / ui 模块，绑定事件，响应网关推送。
 */
import { store, totals, emit } from "./store.js";
import { connect, sendOrder, sendCancel, sendSubscribe, requestQuery } from "./ws.js";
import { fetchBarHistory } from "./history.js";
import { renderOverview } from "./ui_overview.js";
import { renderDetail, rerenderChart, selectSymbol, refreshDetailLive } from "./ui_detail.js";
import { renderTrade, selectTradeSymbol, refreshTradeLive } from "./ui_trade.js";
import { initOfflineDemo, isOfflineMode } from "./offline.js";
import { initTheme, toggleTheme } from "./theme.js";
import { bindAboutDialog } from "./about.js";
import { addWatchlistSymbol, removeWatchlistSymbol } from "./symbols.js";
import { resolveOffset, orderPrice, orderActionLabel, batchClosePositions, batchReversePositions, batchRolloverPositions, batchExercisePositions, batchSelfHedgePositions, defaultRolloverTarget } from "./order.js";
import { selectedPositions, togglePosSelection, setAllPosSelection, addPositionsToCombo } from "./positions.js";

/* ---------- 视图切换 ---------- */
function showView(v) {
  store.view = v;
  document.getElementById("view-overview").style.display = v === "overview" ? "block" : "none";
  document.getElementById("view-trade").style.display = v === "trade" ? "block" : "none";
  document.getElementById("view-detail").style.display = v === "detail" ? "block" : "none";
  document.getElementById("nav-overview").className = "nt" + (v === "overview" ? " active" : "");
  document.getElementById("nav-trade").className = "nt" + (v === "trade" ? " active" : "");
  document.getElementById("nav-detail").className = "nt" + (v === "detail" ? " active" : "");
  render();
}

/* ---------- 渲染入口 ---------- */
function render() {
  renderHeader(store.conn);
  if (store.view === "overview") renderOverview();
  else if (store.view === "trade") renderTrade();
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

function submitOrderFlow({ account, symbol, direction, offsetMode, qtyOverride }) {
  if (!account) { toast("请先选择账户"); return; }
  if (store.conn !== "open") { toast("网关未连接"); return; }
  const sym = (symbol || store.sel || "").trim();
  if (!sym) { toast("请输入合约代码"); return; }
  const tick = store.ticks[sym];
  if (!tick) { toast("暂无该合约行情"); return; }
  const offset = offsetMode === "close" ? "close" : resolveOffset(account, sym, direction, offsetMode || store.offsetMode);
  const price = orderPrice(tick, direction, store.otype, store.limitPx);
  if (!isFinite(price)) { toast("请输入有效价格"); return; }
  const volume = qtyOverride || store.qty;
  sendOrder({ account, symbol: sym, direction, offset, price, volume });
  toast(`已发送 ${orderActionLabel(direction, offset)} ${volume} 手`);
}

/* ---------- 事件 ---------- */
function bindEvents() {
  document.getElementById("nav-overview").addEventListener("click", () => showView("overview"));
  document.getElementById("nav-trade").addEventListener("click", () => showView("trade"));
  document.getElementById("nav-detail").addEventListener("click", () => showView("detail"));
  document.getElementById("back-btn").addEventListener("click", () => showView("overview"));
  document.getElementById("theme-toggle").addEventListener("click", () => toggleTheme());
  document.getElementById("reload-btn").addEventListener("click", () => {
    window.location.reload();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "F5") {
      e.preventDefault();
      window.location.reload();
    }
  });

  document.getElementById("sum-tab-symbol").addEventListener("click", () => { store.sumTab = "symbol"; render(); });
  document.getElementById("sum-tab-account").addEventListener("click", () => { store.sumTab = "account"; render(); });

  document.getElementById("sum-body-account").addEventListener("click", (e) => {
    const row = e.target.closest("[data-acct]");
    if (row) { store.activeAcct = row.getAttribute("data-acct"); showView("trade"); }
  });

  document.getElementById("acct-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (btn) { store.activeAcct = btn.getAttribute("data-view"); showView("trade"); }
    const tradeBtn = e.target.closest("[data-trade]");
    if (tradeBtn) { store.activeAcct = tradeBtn.getAttribute("data-trade"); showView("trade"); }
  });

  bindWatchlist("watchlist", "wl-add-input", "wl-add-btn", selectSymbol);
  bindWatchlist("trade-watchlist", "trade-wl-add-input", "trade-wl-add-btn", selectTradeSymbol);

  document.getElementById("tf-tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tf");
    if (b) {
      store.tf = b.getAttribute("data-tf");
      delete store.barHistory[`${store.sel}_${store.tf}`];
      fetchBarHistory(store.sel, store.tf);
      rerenderChart();
    }
  });

  bindOrderPanel("", selectSymbol);
  bindOrderPanel("trade-", selectTradeSymbol);

  document.getElementById("tab-pos").addEventListener("click", () => { store.tab = "pos"; render(); });
  document.getElementById("tab-ord").addEventListener("click", () => { store.tab = "ord"; render(); });
  document.getElementById("trade-tab-pos").addEventListener("click", () => { store.tradeTab = "pos"; render(); });
  document.getElementById("trade-tab-fills").addEventListener("click", () => { store.tradeTab = "fills"; render(); });
  document.getElementById("trade-tab-stats").addEventListener("click", () => { store.tradeTab = "stats"; render(); });
  document.getElementById("trade-tab-combo").addEventListener("click", () => { store.tradeTab = "combo"; render(); });

  document.querySelectorAll('input[name="trade-pos-mode"]').forEach((el) => {
    el.addEventListener("change", () => {
      if (!el.checked) return;
      store.tradePosMode = el.value;
      render();
    });
  });
  document.getElementById("trade-pos-type").addEventListener("change", (e) => {
    store.tradePosType = e.target.value;
    render();
  });
  document.getElementById("trade-pos-exchange").addEventListener("change", (e) => {
    store.tradePosExchange = e.target.value;
    render();
  });
  document.getElementById("trade-pos-query").addEventListener("input", (e) => {
    store.tradePosQuery = e.target.value;
    if (store.view === "trade" && (store.tradeTab === "pos" || store.tradeTab === "combo")) renderTrade();
  });
  document.getElementById("trade-close-ratio").addEventListener("change", (e) => {
    store.tradeCloseRatio = parseInt(e.target.value, 10) || 100;
  });
  document.getElementById("trade-read-sltp").addEventListener("change", (e) => {
    store.tradeReadManualSLTP = e.target.checked;
    render();
  });

  function runPosAction(fn) {
    if (store.conn !== "open") { toast("网关未连接"); return; }
    const account = store.activeAcct;
    if (!account) { toast("请先选择账户"); return; }
    const sel = selectedPositions(account);
    const ratio = store.tradeCloseRatio || 100;
    const r = fn(account, sel, { ratio });
    toast(r.ok ? r.msg : (r.msg || "操作失败"));
    if (r.ok) render();
  }

  document.getElementById("trade-act-counter-close").addEventListener("click", () => {
    runPosAction((acc, sel, opts) => batchClosePositions(acc, sel, { ...opts, priceMode: "counterparty" }));
  });
  document.getElementById("trade-act-reverse").addEventListener("click", () => {
    runPosAction((acc, sel, opts) => batchReversePositions(acc, sel, opts));
  });
  document.getElementById("trade-act-exercise").addEventListener("click", () => {
    runPosAction((acc, sel) => batchExercisePositions(acc, sel));
  });
  document.getElementById("trade-act-hedge").addEventListener("click", () => {
    runPosAction((acc, sel) => batchSelfHedgePositions(acc, sel));
  });
  document.getElementById("trade-act-rollover").addEventListener("click", () => {
    if (store.conn !== "open") { toast("网关未连接"); return; }
    const account = store.activeAcct;
    const sel = selectedPositions(account);
    if (!sel.length) { toast("请先勾选持仓"); return; }
    document.getElementById("rollover-target").value = defaultRolloverTarget(sel);
    document.getElementById("rollover-dialog").hidden = false;
  });
  document.getElementById("rollover-cancel").addEventListener("click", () => {
    document.getElementById("rollover-dialog").hidden = true;
  });
  document.getElementById("rollover-backdrop").addEventListener("click", () => {
    document.getElementById("rollover-dialog").hidden = true;
  });
  document.getElementById("rollover-confirm").addEventListener("click", () => {
    const account = store.activeAcct;
    const sel = selectedPositions(account);
    const target = document.getElementById("rollover-target").value.trim();
    const r = batchRolloverPositions(account, sel, target, { ratio: store.tradeCloseRatio || 100 });
    document.getElementById("rollover-dialog").hidden = true;
    toast(r.ok ? r.msg : (r.msg || "移仓失败"));
    if (r.ok) render();
  });
  document.getElementById("trade-add-combo").addEventListener("click", () => {
    const account = store.activeAcct;
    const sel = selectedPositions(account);
    const name = window.prompt("自组合名称", "我的组合");
    if (name == null) return;
    const r = addPositionsToCombo(name, sel);
    toast(r.msg);
    if (r.ok) {
      store.tradeTab = "combo";
      render();
    }
  });

  document.querySelectorAll('input[name="trade-fill-mode"]').forEach((el) => {
    el.addEventListener("change", () => {
      if (!el.checked) return;
      store.tradeFillMode = el.value;
      render();
    });
  });
  document.getElementById("trade-fill-type").addEventListener("change", (e) => {
    store.tradeFillType = e.target.value;
    render();
  });
  document.getElementById("trade-fill-exchange").addEventListener("change", (e) => {
    store.tradeFillExchange = e.target.value;
    render();
  });
  document.getElementById("trade-fill-query").addEventListener("input", (e) => {
    store.tradeFillQuery = e.target.value;
    if (store.view === "trade" && store.tradeTab === "fills") renderTrade();
  });

  document.getElementById("trade-stats-type").addEventListener("change", (e) => {
    store.tradeStatsType = e.target.value;
    render();
  });
  document.getElementById("trade-stats-exchange").addEventListener("change", (e) => {
    store.tradeStatsExchange = e.target.value;
    render();
  });
  document.getElementById("trade-stats-query").addEventListener("input", (e) => {
    store.tradeStatsQuery = e.target.value;
    if (store.view === "trade" && store.tradeTab === "stats") renderTrade();
  });
  document.getElementById("trade-stats-risk-btn").addEventListener("click", () => {
    toast("风险预警设置功能开发中");
  });

  document.getElementById("tables").addEventListener("click", (e) => bindCancelClick(e));
  document.getElementById("trade-pending").addEventListener("click", (e) => bindCancelClick(e));
  document.getElementById("trade-tables").addEventListener("click", (e) => {
    const chk = e.target.closest(".trade-pos-chk");
    if (chk) {
      const keys = (chk.getAttribute("data-pos-keys") || "").split(",").filter(Boolean);
      keys.forEach((k) => togglePosSelection(k, chk.checked));
      return;
    }
    const closeBtn = e.target.closest(".trade-close-pos");
    if (closeBtn) {
      store.sel = closeBtn.getAttribute("data-symbol");
      store.dir = closeBtn.getAttribute("data-dir");
      store.offsetMode = "close";
      store.qty = parseInt(closeBtn.getAttribute("data-qty"), 10) || 1;
      submitOrderFlow({
        account: store.activeAcct,
        symbol: store.sel,
        direction: store.dir,
        offsetMode: "close",
      });
      render();
      return;
    }
    bindCancelClick(e);
  });
  document.getElementById("trade-tables").addEventListener("change", (e) => {
    if (e.target.id === "trade-pos-select-all") {
      const checks = document.querySelectorAll(".trade-pos-chk");
      const keys = [];
      checks.forEach((c) => {
        (c.getAttribute("data-pos-keys") || "").split(",").forEach((k) => {
          if (k) keys.push(k);
        });
      });
      setAllPosSelection(keys, e.target.checked);
      render();
    }
  });

  document.getElementById("trade-acct-select").addEventListener("change", (e) => {
    store.activeAcct = e.target.value;
    render();
  });
  document.getElementById("trade-query-btn").addEventListener("click", () => {
    if (store.conn !== "open") { toast("网关未连接"); return; }
    requestQuery();
    toast("已请求刷新资金与持仓");
  });
  document.getElementById("trade-symbol-input").addEventListener("change", (e) => {
    const code = e.target.value.trim();
    if (!code) return;
    const res = addWatchlistSymbol(code);
    if (!res.ok && !store.ticks[code]) { toast(res.msg || "未知合约"); return; }
    store.sel = res.ok ? res.codes.find((c) => c.toLowerCase() === code.toLowerCase()) || code : code;
    if (store.conn === "open" && res.ok) sendSubscribe(res.codes);
    render();
  });
  document.getElementById("trade-clear-btn").addEventListener("click", () => {
    store.qty = 1;
    store.dir = "buy";
    store.offsetMode = "auto";
    store.otype = "market";
    render();
  });
}

function bindWatchlist(listId, inputId, btnId, onSelect) {
  document.getElementById(listId).addEventListener("click", (e) => {
    const removeBtn = e.target.closest("[data-remove]");
    if (removeBtn) {
      e.stopPropagation();
      const code = removeBtn.getAttribute("data-remove");
      const res = removeWatchlistSymbol(code);
      if (!res.ok) { toast(res.msg); return; }
      if (store.sel.toLowerCase() === code.toLowerCase()) store.sel = res.codes[0];
      if (store.conn === "open") sendSubscribe(res.codes);
      toast(`已移除 ${code}`);
      render();
      return;
    }
    const b = e.target.closest(".wl-row");
    if (!b) return;
    const code = b.getAttribute("data-code");
    if (code === store.sel) return;
    document.querySelectorAll(`#${listId} .wl-item.active`).forEach((r) => r.classList.remove("active"));
    b.closest(".wl-item")?.classList.add("active");
    onSelect(code);
  });
  document.getElementById(btnId).addEventListener("click", () => {
    const input = document.getElementById(inputId);
    const raw = input.value.trim();
    if (!raw) { toast("请输入合约代码"); return; }
    const res = addWatchlistSymbol(raw);
    if (!res.ok) { toast(res.msg); return; }
    input.value = "";
    if (store.conn === "open") sendSubscribe(res.codes);
    toast(res.msg);
    render();
  });
  document.getElementById(inputId).addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById(btnId).click();
  });
}

function bindOrderPanel(prefix, onSymbolChange) {
  const p = prefix;
  document.getElementById(`${p}dir-buy`)?.addEventListener("click", () => { store.dir = "buy"; render(); });
  document.getElementById(`${p}dir-sell`)?.addEventListener("click", () => { store.dir = "sell"; render(); });
  document.getElementById(`${p}qty-minus`)?.addEventListener("click", () => { store.qty = Math.max(1, store.qty - 1); render(); });
  document.getElementById(`${p}qty-plus`)?.addEventListener("click", () => { store.qty = Math.min(999, store.qty + 1); render(); });
  document.getElementById(`${p}qty-input`)?.addEventListener("change", (e) => {
    store.qty = Math.max(1, parseInt(e.target.value, 10) || 1);
    render();
  });
  document.getElementById(`${p}otype-market`)?.addEventListener("click", () => { store.otype = "market"; render(); });
  document.getElementById(`${p}otype-limit`)?.addEventListener("click", () => {
    store.otype = "limit";
    const t = store.ticks[store.sel];
    const li = document.getElementById(`${p}limit-input`);
    if (t && li) li.value = t.price.toFixed(1);
    render();
  });
  document.getElementById(`${p}limit-input`)?.addEventListener("change", (e) => { store.limitPx = e.target.value; });

  document.getElementById(`${p}offset-auto`)?.addEventListener("click", () => { store.offsetMode = "auto"; render(); });
  document.getElementById(`${p}offset-open`)?.addEventListener("click", () => { store.offsetMode = "open"; render(); });
  document.getElementById(`${p}offset-close`)?.addEventListener("click", () => { store.offsetMode = "close"; render(); });

  document.getElementById(`${p}submit-btn`)?.addEventListener("click", () => {
    submitOrderFlow({
      account: store.activeAcct,
      symbol: store.sel,
      direction: store.dir,
      offsetMode: p ? store.offsetMode : "open",
    });
  });
}

function bindCancelClick(e) {
  const btn = e.target.closest("[data-cancel-order]");
  if (!btn) return;
  const account = store.activeAcct;
  if (!account) { toast("请先选择账户"); return; }
  if (store.conn !== "open") { toast("网关未连接"); return; }
  sendCancel({
    account,
    order_sys_id: btn.getAttribute("data-cancel-order"),
    symbol: btn.getAttribute("data-symbol"),
    exchange: btn.getAttribute("data-exchange"),
  });
  toast(`撤单已发送：${btn.getAttribute("data-symbol")}`);
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
  if (store.view === "detail") refreshDetailLive();
  else if (store.view === "trade") refreshTradeLive();
  else {
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
  } else if (d.type === "system" || d.type === "login" || d.type === "balance" || d.type === "position" || d.type === "history") {
    render();
  } else if (d.type === "tick") {
    if (!tickRaf) tickRaf = requestAnimationFrame(onTickFrame);
  } else if (d.type === "order" || d.type === "trade") {
    if (store.view === "trade") renderTrade();
    else if (store.view === "detail") renderDetail();
  } else if (d.type === "error") {
    toast(d.msg);
  } else if (d.type === "toast") {
    toast(d.msg);
  }
});

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

setInterval(() => {
  document.getElementById("clock").textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
}, 1000);
