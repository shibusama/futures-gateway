/**
 * ui_detail.js — 账户明细页：行情列表 / K线 / 盘口 / 下单面板 / 持仓委托。
 */
import { store, pxOf, emit, getTick, tickIsLive, acctFloat, positionLivePnl } from "./store.js";
import { buildCandles, renderChart, updateChartLive } from "./chart.js";
import { fetchBarHistory } from "./history.js";
import { getWatchlist, symbolMeta, canCancelOrder, exchangeOf } from "./symbols.js";

const TIME_FRAMES = [
  { key: "1m", label: "1分" },
  { key: "5m", label: "5分" },
  { key: "1d", label: "日线" },
];

const fmt = (v, d = 0) => Number(v || 0).toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d });
const cls = (v) => (v >= 0 ? "up" : "down");

export function renderDetail() {
  const account = stateAccount();
  if (!account) { emit({ type: "toast", msg: "请先在概览页选择账户" }); return; }
  renderDetailHeader();
  renderWatchlist();
  renderSymbolPanel();
  renderTables(account);
  emit({ type: "ui", view: "detail", account });
}

/** 切换合约：不重绘左侧列表，响应更快 */
export function selectSymbol(code) {
  store.sel = code;
  renderSymbolPanel();
}

/** tick 节流刷新：只更新报价和 K 线末根，不重绘表格 */
export function refreshDetailLive() {
  renderWatchlist();
  renderSymbolPanel({ liveOnly: true });
  const account = stateAccount();
  if (account) document.getElementById("d-stats").innerHTML = accountStats(account);
}

function renderWatchlist() {
  const symbols = getWatchlist();
  if (!symbols.some((s) => s.code === store.sel)) {
    store.sel = symbols[0]?.code || store.sel;
  }
  document.getElementById("watchlist").innerHTML = symbols.map((s) => {
    const t = getTick(s.code);
    const p = t?.price > 0 ? t.price : 0;
    const pre = t?.pre_close;
    let pcText = p ? "0.00%" : "—";
    let pcCls = "";
    if (p && pre && pre > 0) {
      const pc = ((p - pre) / pre) * 100;
      pcText = (pc >= 0 ? "+" : "") + pc.toFixed(2) + "%";
      pcCls = cls(pc);
    }
    const stale = p && !tickIsLive(s.code) ? " stale" : "";
    const canRemove = symbols.length > 1;
    return `<div class="wl-item${store.sel === s.code ? " active" : ""}${stale}">
      <button type="button" class="wl-row" data-code="${s.code}">
        <span class="wl-name">${s.name}<small>${s.code}</small></span>
        <span class="right tab">${p ? fmt(p, s.dec) : "—"}</span>
        <span class="right tab ${pcCls}">${pcText}</span>
      </button>
      ${canRemove ? `<button type="button" class="wl-remove" data-remove="${s.code}" title="移除">×</button>` : ""}
    </div>`;
  }).join("");
}

function renderSymbolPanel(opts = {}) {
  const sym = currentSymbol();
  const tick = getTick(store.sel);
  const live = tickIsLive(store.sel);
  const price = tick?.price > 0 ? tick.price : 0;
  const pre = tick?.pre_close || 0;
  const chg = pre ? price - pre : 0;
  const pct = pre ? (chg / pre) * 100 : 0;
  const pClass = price ? cls(chg) : "";

  // 图表头
  document.getElementById("ch-name").innerHTML = `${sym.name}<small>${sym.code}</small>`;
  document.getElementById("ch-exch").textContent = live ? "SimNow" : (tick ? "快照" : "连接中…");
  document.getElementById("ch-price").textContent = price ? fmt(price, sym.dec) : "—";
  document.getElementById("ch-price").className = pClass;
  document.getElementById("ch-change").textContent = chg ? `${chg >= 0 ? "+" : ""}${fmt(chg, sym.dec)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)` : "—";
  document.getElementById("ch-change").className = pClass;

  if (!opts.liveOnly) {
    document.getElementById("tf-tabs").innerHTML = TIME_FRAMES.map((t) =>
      `<button class="tf${store.tf === t.key ? " active" : ""}" data-tf="${t.key}">${t.label}</button>`).join("");
    fetchBarHistory(store.sel, store.tf);
  }

  const candles = buildCandles(store.sel);
  const chartEl = document.getElementById("chart-container");
  if (opts.liveOnly) {
    updateChartLive(chartEl, candles, price, sym.dec, store.tf);
  } else {
    renderChart(chartEl, candles, price, sym.dec, store.tf);
  }

  // 盘口
  document.getElementById("book-code").textContent = store.sel;
  renderBook(tick, sym.dec, sym.tick);

  // 下单面板
  document.getElementById("t-sym").textContent = `${sym.name} ${sym.code}`;
  document.getElementById("t-price").textContent = price ? fmt(price, sym.dec) : "—";
  document.getElementById("t-price").className = pClass;
  document.getElementById("dir-buy").className = `dt buy${store.dir === "buy" ? " active" : ""}`;
  document.getElementById("dir-sell").className = `dt sell${store.dir === "sell" ? " active" : ""}`;
  document.getElementById("qty-input").value = store.qty;
  document.getElementById("otype-market").className = `seg${store.otype === "market" ? " active" : ""}`;
  document.getElementById("otype-limit").className = `seg${store.otype === "limit" ? " active" : ""}`;
  const li = document.getElementById("limit-input");
  li.style.display = store.otype === "limit" ? "block" : "none";
  if (store.otype === "limit" && li.value === "") li.value = price ? price.toFixed(sym.dec) : "";
  document.getElementById("submit-btn").textContent = `${store.dir === "buy" ? "买入开多" : "卖出开空"} ${store.qty} 手`;
  document.getElementById("submit-btn").className = `big-btn ${store.dir === "buy" ? "buy" : "sell"}`;
}

function renderDetailHeader() {
  const account = stateAccount();
  if (!account) return;
  document.getElementById("d-name").innerHTML = account;
  document.getElementById("d-account-id").textContent = "SimNow";
  document.getElementById("d-stats").innerHTML = accountStats(account);
}

function stateAccount() {
  if (store.activeAcct && store.accounts.includes(store.activeAcct)) return store.activeAcct;
  store.activeAcct = store.accounts[0] || null;
  return store.activeAcct;
}

function currentSymbol() {
  return symbolMeta(store.sel) || getWatchlist()[0] || symbolMeta("rb2610");
}

function accountStats(account) {
  const b = store.balances[account];
  if (!b) return `<div class="ds-item"><span>等待资金回报</span><b>—</b></div>`;
  const fpnl = acctFloat(account);
  const staleFloat = (b.position_profit || 0) + (b.close_profit || 0);
  const delta = fpnl - staleFloat;
  return `
    <div class="ds-item"><span>权益</span><b class="tab">${fmt(b.balance + delta)}</b></div>
    <div class="ds-item"><span>可用资金</span><b class="tab">${fmt(b.available + delta)}</b></div>
    <div class="ds-item"><span>浮动盈亏</span><b class="tab ${cls(fpnl)}">${fpnl >= 0 ? "+" : ""}${fmt(fpnl)}</b></div>
    <div class="ds-item"><span>保证金</span><b class="tab">${fmt(b.margin)}</b></div>
    <div class="ds-item"><span>手续费</span><b class="tab">${fmt(b.commission)}</b></div>`;
}

function renderBook(tick, dec, tickSize) {
  if (!tick || !(tick.price > 0)) {
    document.getElementById("book-asks").innerHTML = "";
    document.getElementById("book-bids").innerHTML = "";
    document.getElementById("book-mid").textContent = "—";
    return;
  }
  const row = (price, vol, side) => {
    if (price == null || !isFinite(price)) return "";
    return `<div class="book-row ${side}"><span class="bar" style="width:${Math.min(100, vol / 30 * 100)}%"></span><span class="px">${fmt(price, dec)}</span><span class="qty">${vol}</span></div>`;
  };
  const ts = (tickSize && tickSize > 0) ? tickSize : 1;
  // 档位补齐：SimNow 第二套环境只推第1档，用第1档价 ± n*tick 推算 2-5 档（无真实值的近似展示）
  const roundP = (v) => Number(v.toFixed(dec));
  let asks = "";
  for (let i = 5; i >= 1; i--) {
    let p = tick[`ask${i}`], v = tick[`askv${i}`];
    if (p == null && tick.ask1 != null) { p = roundP(tick.ask1 + (i - 1) * ts); v = tick.askv1 || 1; }
    asks += p != null ? row(p, v, "ask") : "";
  }
  let bids = "";
  for (let i = 1; i <= 5; i++) {
    let p = tick[`bid${i}`], v = tick[`bidv${i}`];
    if (p == null && tick.bid1 != null) { p = roundP(tick.bid1 - (i - 1) * ts); v = tick.bidv1 || 1; }
    bids += p != null ? row(p, v, "bid") : "";
  }
  document.getElementById("book-asks").innerHTML = asks;
  document.getElementById("book-mid").textContent = fmt(tick.price, dec);
  document.getElementById("book-mid").className = "book-mid " + cls(tick.price - (tick.pre_close || tick.price));
  document.getElementById("book-bids").innerHTML = bids;
}

function renderTables(account) {
  const el = document.getElementById("tables");
  if (store.tab === "pos") {
    const pos = store.positions[account] || [];
    if (!pos.length) { el.innerHTML = '<div class="empty">暂无持仓或其数据未返回</div>'; return; }
    let html = "<table><thead><tr><th>合约</th><th>方向</th><th>手数</th><th>可平</th><th>开仓价</th><th>浮动盈亏</th><th>保证金</th></tr></thead><tbody>";
    pos.forEach((p) => {
      const dir = String(p.direction).includes("Long") ? "多" : "空";
      const dirCls = dir === "多" ? "b-up" : "b-down";
      html += `<tr><td>${p.symbol}</td>
        <td><span class="badge ${dirCls}">${dir}</span></td>
        <td>${p.volume}</td><td>${p.avail}</td>
        <td class="tab">${fmt(p.open_price, 0)}</td>
        <td class="tab ${cls(positionLivePnl(p))}">${fmt(positionLivePnl(p))}</td>
        <td class="tab">${fmt(p.margin)}</td></tr>`;
    });
    el.innerHTML = html + "</tbody></table>";
  } else {
    const ords = store.orders[account] || [];
    if (!ords.length) { el.innerHTML = '<div class="empty">暂无委托</div>'; return; }
    let html = "<table><thead><tr><th>时间</th><th>合约</th><th>方向</th><th>开平</th><th>手数</th><th>价格</th><th>成交</th><th>状态</th><th></th></tr></thead><tbody>";
    ords.forEach((o) => {
      const dir = o.direction === "0" ? "买" : "卖";
      const off = o.offset === "0" ? "开" : "平";
      const stCls = o.status === "0" ? "b-ok" : o.status === "3" ? "b-wait" : "b-off";
      const cancelBtn = canCancelOrder(o)
        ? `<button type="button" class="btn-cancel" data-cancel-order="${o.order_sys_id || ""}"
            data-symbol="${o.symbol}" data-exchange="${o.exchange || exchangeOf(o.symbol)}">撤单</button>`
        : "";
      html += `<tr><td>${o.time || "—"}</td><td>${o.symbol}</td>
        <td class="${dir === "买" ? "up" : "down"}">${dir}</td><td>${off}</td>
        <td>${o.volume_total}</td><td class="tab">${fmt(o.limit_price, 0)}</td>
        <td>${o.volume_traded || 0}</td>
        <td><span class="badge ${stCls}">${orderStatus(o)}</span></td>
        <td>${cancelBtn}</td></tr>`;
    });
    el.innerHTML = html + "</tbody></table>";
  }
}

function orderStatus(o) {
  switch (o.status) {
    case "0": return "全部成交";
    case "1": return "部分成交";
    case "3": return "未成交";
    case "4": return "已撤销";
    default: return o.status_msg || o.status;
  }
}

/** 供 app.js 在切换周期时重绘 K 线 */
export function rerenderChart() {
  const sym = currentSymbol();
  const tick = store.ticks[store.sel];
  const candles = buildCandles(store.sel);
  renderChart(document.getElementById("chart-container"), candles, tick ? tick.price : 0, sym.dec, store.tf);
}