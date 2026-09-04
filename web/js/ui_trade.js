/**
 * ui_trade.js — 通用下单页（专业终端风格：资金条 + 自选 + 下单板 + 持仓/成交）
 */
import { store, getTick, tickIsLive, acctFloat, positionLivePnl, emit, contractMult } from "./store.js";
import { getWatchlist, symbolMeta, exchangeOf, canCancelOrder } from "./symbols.js";
import { orderActionLabel, positionFor, counterpartyPrice } from "./order.js";
import {
  positionKey, posDirLabel, filterPositions, filterComboPositions, positionMarketValue, getManualSLTP,
  groupPositionsByProduct, comboPositionRows, loadCombos, comboFormulaText,
  tradeStatsByProduct, filterTradeStats,
} from "./positions.js";

const fmt = (v, d = 0) => Number(v || 0).toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d });
const cls = (v) => (v >= 0 ? "up" : "down");

function stateAccount() {
  if (store.activeAcct && store.accounts.includes(store.activeAcct)) return store.activeAcct;
  store.activeAcct = store.accounts[0] || null;
  return store.activeAcct;
}

function currentSymbol() {
  return symbolMeta(store.sel) || getWatchlist()[0] || symbolMeta("rb2610");
}

const EXCHANGE_NAMES = {
  SHFE: "上期所", DCE: "大商所", CZCE: "郑商所", CFFEX: "中金所", INE: "能源中心", GFEX: "广期所",
};

function dirLabel(dir) {
  return dir === "0" ? "买" : "卖";
}

function offsetLabel(offset) {
  if (offset === "0") return "开";
  if (offset === "1" || offset === "3" || offset === "4") return "平";
  return offset || "—";
}

function tradeTime(t) {
  if (t.date && t.time) return `${t.date} ${t.time}`;
  return t.time || "—";
}

function matchFillQuery(trade, query) {
  const q = String(query || "").trim();
  if (!q) return true;
  const terms = q.split(/[,，\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const sym = String(trade.symbol || "").toLowerCase();
  const meta = symbolMeta(trade.symbol);
  const name = (meta?.name || "").toLowerCase();
  const prod = sym.replace(/\d+$/, "");
  return terms.some((term) => sym.includes(term) || prod.includes(term) || name.includes(term));
}

function filterTrades(account) {
  let rows = [...(store.trades[account] || [])];
  const type = store.tradeFillType || "all";
  const ex = store.tradeFillExchange || "all";
  const query = store.tradeFillQuery || "";
  if (type === "open") rows = rows.filter((t) => t.offset === "0");
  else if (type === "close") rows = rows.filter((t) => t.offset && t.offset !== "0");
  if (ex !== "all") {
    rows = rows.filter((t) => (t.exchange || exchangeOf(t.symbol)) === ex);
  }
  if (query) rows = rows.filter((t) => matchFillQuery(t, query));
  return rows;
}

function summarizeTrades(trades) {
  const map = new Map();
  trades.forEach((t) => {
    const key = `${t.symbol}|${t.direction}|${t.offset || ""}`;
    const ex = t.exchange || exchangeOf(t.symbol);
    const meta = symbolMeta(t.symbol);
    const vol = Number(t.volume) || 0;
    const px = Number(t.price) || 0;
    const comm = Number(t.commission) || 0;
    const pnl = Number(t.close_profit) || 0;
    if (!map.has(key)) {
      map.set(key, {
        symbol: t.symbol,
        exchange: ex,
        name: meta?.name || t.symbol,
        direction: t.direction,
        offset: t.offset,
        hedge: t.hedge,
        volume: vol,
        amount: px * vol,
        commission: comm,
        close_profit: pnl,
        count: 1,
      });
    } else {
      const g = map.get(key);
      g.volume += vol;
      g.amount += px * vol;
      g.commission += comm;
      g.close_profit += pnl;
      g.count += 1;
    }
  });
  return [...map.values()].map((g) => ({
    ...g,
    price: g.volume > 0 ? g.amount / g.volume : 0,
  }));
}

function updateFillToolbar() {
  const toolbar = document.getElementById("trade-fill-toolbar");
  const show = store.tradeTab === "fills";
  if (toolbar) toolbar.hidden = !show;
  document.querySelectorAll('input[name="trade-fill-mode"]').forEach((el) => {
    el.checked = el.value === (store.tradeFillMode || "detail");
  });
  const typeSel = document.getElementById("trade-fill-type");
  const exSel = document.getElementById("trade-fill-exchange");
  const qInput = document.getElementById("trade-fill-query");
  if (typeSel && typeSel.value !== (store.tradeFillType || "all")) typeSel.value = store.tradeFillType || "all";
  if (exSel && exSel.value !== (store.tradeFillExchange || "all")) exSel.value = store.tradeFillExchange || "all";
  if (qInput && qInput.value !== (store.tradeFillQuery || "")) qInput.value = store.tradeFillQuery || "";
}

function updateStatsToolbar() {
  const toolbar = document.getElementById("trade-stats-toolbar");
  const show = store.tradeTab === "stats";
  if (toolbar) toolbar.hidden = !show;
  const typeSel = document.getElementById("trade-stats-type");
  const exSel = document.getElementById("trade-stats-exchange");
  const qInput = document.getElementById("trade-stats-query");
  if (typeSel && typeSel.value !== (store.tradeStatsType || "all")) typeSel.value = store.tradeStatsType || "all";
  if (exSel && exSel.value !== (store.tradeStatsExchange || "all")) exSel.value = store.tradeStatsExchange || "all";
  if (qInput && qInput.value !== (store.tradeStatsQuery || "")) qInput.value = store.tradeStatsQuery || "";
}

function updatePosToolbar() {
  const toolbar = document.getElementById("trade-pos-toolbar");
  const show = store.tradeTab === "pos";
  if (toolbar) toolbar.hidden = !show;
  document.querySelectorAll('input[name="trade-pos-mode"]').forEach((el) => {
    el.checked = el.value === (store.tradePosMode || "single");
  });
  const typeSel = document.getElementById("trade-pos-type");
  const exSel = document.getElementById("trade-pos-exchange");
  const qInput = document.getElementById("trade-pos-query");
  const ratioSel = document.getElementById("trade-close-ratio");
  const sltpChk = document.getElementById("trade-read-sltp");
  if (typeSel && typeSel.value !== (store.tradePosType || "all")) typeSel.value = store.tradePosType || "all";
  if (exSel && exSel.value !== (store.tradePosExchange || "all")) exSel.value = store.tradePosExchange || "all";
  if (qInput && qInput.value !== (store.tradePosQuery || "")) qInput.value = store.tradePosQuery || "";
  if (ratioSel && String(ratioSel.value) !== String(store.tradeCloseRatio || 100)) {
    ratioSel.value = String(store.tradeCloseRatio || 100);
  }
  if (sltpChk) sltpChk.checked = !!store.tradeReadManualSLTP;
}

function updateComboToolbar() {
  const toolbar = document.getElementById("trade-combo-toolbar");
  const show = store.tradeTab === "combo";
  if (toolbar) toolbar.hidden = !show;
  const typeSel = document.getElementById("trade-combo-type");
  const qInput = document.getElementById("trade-combo-query");
  if (typeSel && typeSel.value !== (store.tradeComboType || "all")) typeSel.value = store.tradeComboType || "all";
  if (qInput && qInput.value !== (store.tradeComboQuery || "")) qInput.value = store.tradeComboQuery || "";
}

function sltpCells(account, p) {
  if (!store.tradeReadManualSLTP) {
    return "<td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>";
  }
  const m = getManualSLTP(account, p);
  if (!m) return "<td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>";
  return `<td class="tab">${m.stopLoss ?? "—"}</td><td class="tab">${m.takeProfit ?? "—"}</td>
    <td>${m.autoSL ? "是" : "否"}</td><td>${m.autoTP ? "是" : "否"}</td><td>${m.triggerVol ?? "—"}</td>`;
}

function connHintMsg() {
  if (store.conn !== "open") return "网关未连接，请确认期界已启动（顶部应显示 CTP 已连接）";
  const account = stateAccount();
  const login = account ? store.login[account] : null;
  if (!account || (login !== "ok" && login !== "md_ok")) return "请先在概览页连接 SimNow 账户";
  return "";
}

function posEmptyMsg() {
  const hint = connHintMsg();
  if (hint) return hint;
  return "暂无持仓";
}

function renderPosTableFoot() {}

function positionRowHtml(p, account, opts = {}) {
  const key = positionKey(p);
  const keys = opts.posKeys || [key];
  const allChecked = keys.every((k) => (store.tradePosSelected || []).includes(k));
  const meta = symbolMeta(p.symbol);
  const tick = getTick(p.symbol);
  const last = tick?.price > 0 ? fmt(tick.price, meta?.dec ?? 0) : "—";
  const floatPnl = positionLivePnl(p);
  const dir = posDirLabel(p);
  const symCell = opts.symbolLabel || p.symbol;
  const keysAttr = keys.join(",");
  return `<tr data-pos-key="${key}" data-pos-keys="${keysAttr}">
    <td class="chk"><input type="checkbox" class="trade-pos-chk" data-pos-keys="${keysAttr}"${allChecked ? " checked" : ""} /></td>
    ${opts.comboName !== undefined ? `<td>${opts.comboName}</td>` : ""}
    <td>${account}</td>
    <td>${symCell}</td>
    <td class="${dir === "买" ? "up" : "down"}">${dir}</td>
    <td>${p.volume ?? 0}</td>
    <td>${p.today_volume ?? 0}</td>
    <td>${p.yd_volume ?? 0}</td>
    <td>${p.today_frozen ?? 0}</td>
    <td>${p.yd_frozen ?? 0}</td>
    <td class="tab ${cls(p.position_profit || 0)}">${fmt(p.position_profit || 0, 2)}</td>
    <td class="tab ${cls(p.close_profit || 0)}">${fmt(p.close_profit || 0, 2)}</td>
    <td class="tab">${fmt(p.open_price || 0, meta?.dec ?? 0)}</td>
    <td class="tab">${fmt(p.margin || 0, 2)}</td>
    <td class="tab">${last}</td>
    <td class="tab ${cls(floatPnl)}">${fmt(floatPnl, 2)}</td>
    <td class="tab">${fmt(positionMarketValue(p), 2)}</td>
    ${sltpCells(account, p)}
  </tr>`;
}

function tradeEmptyMsg() {
  if (store.conn !== "open") return "登录期货账户后可查看数据";
  const account = store.activeAcct;
  const login = account ? store.login[account] : null;
  if (login !== "ok" && login !== "md_ok") return "登录期货账户后可查看数据";
  return "暂无成交记录";
}

const FILL_DETAIL_HEAD = `<table class="trade-fill-table"><thead><tr>
  <th>序号</th><th>单号</th><th>合约代码</th><th>买卖</th><th>开平</th>
  <th>成交均价</th><th>成交手数</th><th>手续费</th><th>成交时间</th><th>平仓盈亏</th>
</tr></thead><tbody>`;

const FILL_SUMMARY_HEAD = `<table class="trade-fill-table"><thead><tr>
  <th>序号</th><th>合约代码</th><th>买卖</th><th>开平</th>
  <th>成交均价</th><th>成交手数</th><th>笔数</th><th>手续费</th><th>平仓盈亏</th>
</tr></thead><tbody>`;

function fillEmptyTable(el, headHtml, colSpan, msg) {
  el.innerHTML = `${headHtml}<tr class="trade-empty-row"><td colspan="${colSpan}" class="empty">${msg}</td></tr></tbody></table>`;
}

export function renderTrade() {
  const account = stateAccount();
  if (!account) {
    emit({ type: "toast", msg: "请先在概览页配置并连接账户" });
    return;
  }
  renderTradeBar(account);
  renderTradeWatchlist();
  renderTradeOrders(account);
  renderTradeTicket(account);
  renderTradeBottom(account);
  renderTradeStatusBar(account);
}

export function selectTradeSymbol(code) {
  store.sel = code;
  renderTradeTicket(stateAccount());
  renderTradeWatchlist();
}

export function refreshTradeLive() {
  patchTradeWatchlistQuotes();
  renderTradeTicket(stateAccount());
  renderTradeStatusBar(stateAccount());
  const account = stateAccount();
  if (account) {
    renderTradeOrders(account);
    if (store.tradeTab === "pos") renderTradePositions(account);
    else if (store.tradeTab === "combo") renderTradeComboPositions(account);
    else if (store.tradeTab === "fills") renderTradeFills(account);
    else if (store.tradeTab === "stats") renderTradeStats(account);
  }
}

function renderTradeBar(account) {
  const sel = document.getElementById("trade-acct-select");
  if (sel && store.accounts.length) {
    sel.innerHTML = store.accounts.map(
      (a) => `<option value="${a}"${a === account ? " selected" : ""}>${a}</option>`,
    ).join("");
  }
  const b = store.balances[account];
  const fpnl = acctFloat(account);
  const risk = b && b.balance > 0 ? ((b.margin / b.balance) * 100).toFixed(1) + "%" : "—";
  document.getElementById("trade-funds-row").innerHTML = b ? `
    <tr>
      <td>1</td>
      <td>${account}</td>
      <td class="tab">${fmt(b.balance + (fpnl - ((b.position_profit || 0) + (b.close_profit || 0))))}</td>
      <td class="tab ${cls(fpnl)}">${fpnl >= 0 ? "+" : ""}${fmt(fpnl)}</td>
      <td class="tab">${risk}</td>
      <td class="tab">${fmt(b.balance)}</td>
      <td class="tab">—</td>
      <td class="tab">—</td>
      <td class="tab">—</td>
      <td class="tab">—</td>
      <td class="tab">—</td>
      <td class="tab">—</td>
      <td class="tab">—</td>
      <td class="tab">—</td>
    </tr>` : `<tr><td colspan="14" class="empty">等待资金回报…</td></tr>`;
}

function acctPositionFloat(account) {
  const pos = store.positions[account] || [];
  let n = 0;
  pos.forEach((p) => { n += positionLivePnl(p); });
  return n;
}

function fmtStatusMoney(v, d = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return Number(v).toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtLinkClock(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function setStatusVal(id, text, tone) {
  // 走马灯克隆了第二份指标（用 data-st-key 而非 id），需同时更新，避免旧值残留
  const els = document.querySelectorAll(`#${id}, [data-st-key="${id}"]`);
  if (!els.length) return;
  const cls = `trade-st-val${tone ? ` ${tone}` : ""}`;
  els.forEach((el) => {
    el.textContent = text;
    el.className = cls;
  });
}

/* 把资金指标条包装成无缝走马灯：内容两段首尾相接，动画从 0 平移到 -50% 循环。
   一段保留 id（供原逻辑更新），另一段用 data-st-key，由 setStatusVal 一并刷新。 */
function initStatusMarquee() {
  if (initStatusMarquee.done) return;
  const box = document.querySelector(".trade-status-metrics");
  if (!box) return;
  initStatusMarquee.done = true;
  const track = document.createElement("div");
  track.className = "trade-status-track";
  const seg = document.createElement("div");
  seg.className = "trade-status-seg";
  Array.from(box.children).forEach((n) => seg.appendChild(n));
  const seg2 = seg.cloneNode(true);
  seg2.querySelectorAll("[id]").forEach((el) => {
    const key = el.id;
    el.removeAttribute("id");
    el.setAttribute("data-st-key", key);
  });
  track.appendChild(seg);
  track.appendChild(seg2);
  box.appendChild(track);
}

export function renderTradeStatusBar(account) {
  initStatusMarquee();
  const clock = document.getElementById("trade-status-clock");
  if (clock) {
    clock.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  }
  const b = store.balances[account];
  if (!b) {
    setStatusVal("trade-st-equity", "—");
    setStatusVal("trade-st-close", "—");
    setStatusVal("trade-st-pos", "—");
    setStatusVal("trade-st-avail", "—");
  } else {
    const fpnl = acctFloat(account);
    const staleFloat = (b.position_profit || 0) + (b.close_profit || 0);
    const floatDelta = fpnl - staleFloat;
    const posFloat = acctPositionFloat(account);
    const posStale = b.position_profit || 0;
    const equity = b.balance + floatDelta;
    const avail = (b.available || 0) + (posFloat - posStale);
    const closePnl = b.close_profit || 0;
    setStatusVal("trade-st-equity", fmtStatusMoney(equity));
    setStatusVal("trade-st-close", fmtStatusMoney(closePnl), cls(closePnl));
    setStatusVal("trade-st-pos", fmtStatusMoney(posFloat), cls(posFloat));
    setStatusVal("trade-st-avail", fmtStatusMoney(avail));
  }
  const links = document.getElementById("trade-status-links");
  if (!links) return;
  const stars = store.accounts.some((a) => store.login[a] === "ok" || store.login[a] === "md_ok")
    ? "<span class=\"trade-status-stars\" aria-hidden=\"true\">★★</span>" : "";
  const chips = [];
  if (store.gatewayLinkAt) {
    const gwOk = store.conn === "open";
    chips.push(`<span class="trade-status-link ${gwOk ? "up" : "down"}">${fmtLinkClock(store.gatewayLinkAt)}</span>`);
  }
  store.accounts.forEach((acc) => {
    const link = store.accountLinkAt[acc] || {};
    if (link.trade?.at) {
      chips.push(`<span class="trade-status-link ${link.trade.ok ? "up" : "down"}">${fmtLinkClock(link.trade.at)}</span>`);
    }
    if (link.md?.at) {
      chips.push(`<span class="trade-status-link ${link.md.ok ? "up" : "down"}">${fmtLinkClock(link.md.at)}</span>`);
    }
  });
  links.innerHTML = stars + chips.join("");
}

function quoteRowBits(code, dec) {
  const tick = getTick(code);
  const price = tick?.price > 0 ? tick.price : null;
  const bid = tick?.bid1 > 0 ? tick.bid1 : null;
  const ask = tick?.ask1 > 0 ? tick.ask1 : null;
  const bidv = tick?.bidv1 > 0 ? tick.bidv1 : null;
  const askv = tick?.askv1 > 0 ? tick.askv1 : null;
  const chg = price && tick?.pre_close ? price - tick.pre_close : 0;
  return { price, bid, ask, bidv, askv, chgCls: cls(chg), stale: !!(price && !tickIsLive(code)) };
}

function trendSparkline(code) {
  let bars = store.barHistory[`${code}_1d`];
  let closes = bars?.length ? bars.slice(-2).map((b) => b.c) : [];
  if (closes.length < 2) {
    bars = store.barHistory[`${code}_5m`];
    if (bars?.length >= 2) closes = bars.slice(-48).map((b) => b.c);
  }
  if (closes.length < 2) return '<span class="trend-empty">—</span>';
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const w = 56;
  const h = 18;
  const pts = closes.map((c, i) => {
    const x = (i / (closes.length - 1)) * w;
    const y = h - ((c - min) / span) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const up = closes[closes.length - 1] >= closes[0];
  return `<svg class="trend-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${up ? "var(--up)" : "var(--down)"}" stroke-width="1.5"/></svg>`;
}

function tradeQuoteRowHtml(s, idx) {
  const q = quoteRowBits(s.code, s.dec);
  const active = store.sel === s.code;
  const canRemove = getWatchlist().length > 1;
  return `<tr class="trade-quote-row${active ? " active" : ""}${q.stale ? " stale" : ""}" data-code="${s.code}">
    <td class="col-no tab">${idx + 1}</td>
    <td><span class="quote-code">${s.code}</span>${canRemove ? `<button type="button" class="quote-remove" data-remove="${s.code}" title="移除">×</button>` : ""}</td>
    <td>${s.name}</td>
    <td class="col-trend">${trendSparkline(s.code)}</td>
    <td class="tab ${q.chgCls}">${q.price != null ? fmt(q.price, s.dec) : "—"}</td>
    <td class="tab down">${q.bid != null ? fmt(q.bid, s.dec) : "—"}</td>
    <td class="tab">${q.bidv ?? "—"}</td>
    <td class="tab up">${q.ask != null ? fmt(q.ask, s.dec) : "—"}</td>
    <td class="tab">${q.askv ?? "—"}</td>
  </tr>`;
}

function patchTradeWatchlistQuotes() {
  const root = document.getElementById("trade-watchlist");
  if (!root) return;
  getWatchlist().forEach((s, idx) => {
    const row = root.querySelector(`.trade-quote-row[data-code="${s.code}"]`);
    if (!row) return;
    const q = quoteRowBits(s.code, s.dec);
    const cells = row.querySelectorAll("td");
    if (cells[0]) cells[0].textContent = String(idx + 1);
    if (cells[3]) cells[3].innerHTML = trendSparkline(s.code);
    if (cells[4]) {
      cells[4].textContent = q.price != null ? fmt(q.price, s.dec) : "—";
      cells[4].className = `tab ${q.chgCls}`;
    }
    if (cells[5]) cells[5].textContent = q.bid != null ? fmt(q.bid, s.dec) : "—";
    if (cells[6]) cells[6].textContent = q.bidv ?? "—";
    if (cells[7]) cells[7].textContent = q.ask != null ? fmt(q.ask, s.dec) : "—";
    if (cells[8]) cells[8].textContent = q.askv ?? "—";
    row.classList.toggle("active", s.code === store.sel);
    row.classList.toggle("stale", q.stale);
  });
}

function renderTradeWatchlist() {
  const symbols = getWatchlist();
  const emptyEl = document.getElementById("trade-quote-empty");
  if (!symbols.some((s) => s.code === store.sel)) {
    store.sel = symbols[0]?.code || store.sel;
  }
  const root = document.getElementById("trade-watchlist");
  if (emptyEl) emptyEl.hidden = symbols.length > 0;
  const key = symbols.map((s) => s.code).join(",");
  if (root.dataset.codes === key && root.querySelectorAll(".trade-quote-row").length === symbols.length) {
    patchTradeWatchlistQuotes();
    return;
  }
  root.dataset.codes = key;
  root.innerHTML = symbols.map((s, i) => tradeQuoteRowHtml(s, i)).join("");
}

function orderKey(o) {
  return o.order_sys_id || `${o.symbol}_${o.order_ref || ""}_${o.time || ""}`;
}

function orderStatusLabel(o) {
  switch (o.status) {
    case "0": return "全部成交";
    case "1": return "部分成交";
    case "3": return "未成交";
    case "4": return "已撤销";
    case "5": return "错单";
    default: return o.status_msg || o.status || "—";
  }
}

function hedgeLabel(o) {
  if (o.hedge === "1") return "投机";
  if (o.hedge === "3") return "套保";
  if (o.hedge === "2") return "套利";
  return "投机";
}

function orderVolumeCells(o) {
  const total = Number(o.volume_total) || 0;
  const traded = Number(o.volume_traded) || 0;
  const pending = canCancelOrder(o) ? Math.max(0, total - traded) : 0;
  const canceled = (o.status === "4" || o.status === "5") ? Math.max(0, total - traded) : 0;
  return { total, traded, pending, canceled };
}

function matchOrderQuery(o, query) {
  const q = String(query || "").trim();
  if (!q) return true;
  const terms = q.split(/[,，\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const sym = String(o.symbol || "").toLowerCase();
  const meta = symbolMeta(o.symbol);
  const name = (meta?.name || "").toLowerCase();
  const prod = sym.replace(/\d+$/, "");
  return terms.some((term) => sym.includes(term) || prod.includes(term) || name.includes(term));
}

function filterTradeOrders(account) {
  let rows = [...(store.orders[account] || [])];
  const scope = store.tradeOrderScope || "all";
  const type = store.tradeOrderType || "all";
  const ex = store.tradeOrderExchange || "all";
  const query = store.tradeOrderQuery || "";
  if (scope === "working") rows = rows.filter((o) => canCancelOrder(o));
  else if (scope === "done") rows = rows.filter((o) => o.status === "0" || o.status === "1");
  else if (scope === "canceled") rows = rows.filter((o) => o.status === "4" || o.status === "5");
  if (type === "buy") rows = rows.filter((o) => o.direction === "0");
  else if (type === "sell") rows = rows.filter((o) => o.direction === "1");
  if (ex !== "all") rows = rows.filter((o) => (o.exchange || exchangeOf(o.symbol)) === ex);
  if (query) rows = rows.filter((o) => matchOrderQuery(o, query));
  return rows;
}

function updateOrderToolbar() {
  const scopeSel = document.getElementById("trade-order-scope");
  const typeSel = document.getElementById("trade-order-type");
  const exSel = document.getElementById("trade-order-exchange");
  const srcSel = document.getElementById("trade-order-source");
  const qInput = document.getElementById("trade-order-query");
  if (scopeSel && scopeSel.value !== (store.tradeOrderScope || "all")) scopeSel.value = store.tradeOrderScope || "all";
  if (typeSel && typeSel.value !== (store.tradeOrderType || "all")) typeSel.value = store.tradeOrderType || "all";
  if (exSel && exSel.value !== (store.tradeOrderExchange || "all")) exSel.value = store.tradeOrderExchange || "all";
  if (srcSel && srcSel.value !== (store.tradeOrderSource || "all")) srcSel.value = store.tradeOrderSource || "all";
  if (qInput && qInput.value !== (store.tradeOrderQuery || "")) qInput.value = store.tradeOrderQuery || "";
}

function orderEmptyMsg() {
  const hint = connHintMsg();
  if (hint) return hint;
  return "暂无委托";
}

function tradeOrderRowHtml(o, account, idx) {
  const key = orderKey(o);
  const selected = (store.tradeOrderSelected || []).includes(key);
  const meta = symbolMeta(o.symbol);
  const dec = meta?.dec ?? 0;
  const dir = o.direction === "0" ? "买" : "卖";
  const off = o.offset === "0" ? "开" : "平";
  const vols = orderVolumeCells(o);
  const avgPx = vols.traded > 0 ? (Number(o.traded_price) || Number(o.limit_price) || 0) : 0;
  return `<tr class="trade-order-row${selected ? " selected" : ""}" data-order-key="${key}"
    data-cancel-order="${o.order_sys_id || ""}" data-symbol="${o.symbol}" data-exchange="${o.exchange || exchangeOf(o.symbol)}">
    <td class="col-no tab">${idx + 1}</td>
    <td>${account}</td>
    <td>${o.symbol}</td>
    <td class="${dir === "买" ? "up" : "down"}">${dir}</td>
    <td>${off}</td>
    <td><span class="badge ${o.status === "0" ? "b-ok" : canCancelOrder(o) ? "b-wait" : "b-off"}">${orderStatusLabel(o)}</span></td>
    <td class="tab">${fmt(o.limit_price || 0, dec)}</td>
    <td class="tab">${avgPx ? fmt(avgPx, dec) : "—"}</td>
    <td>${vols.total}</td>
    <td>${vols.pending || "—"}</td>
    <td>${vols.traded || "—"}</td>
    <td>${vols.canceled || "—"}</td>
    <td>${hedgeLabel(o)}</td>
  </tr>`;
}

export function renderTradeOrders(account) {
  updateOrderToolbar();
  const emptyEl = document.getElementById("trade-order-empty");
  const root = document.getElementById("trade-order-body");
  if (!root) return;
  if ((store.tradeOrderTab || "ord") !== "ord") {
    root.innerHTML = "";
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = "该列表功能开发中";
    }
    return;
  }
  const rows = filterTradeOrders(account);
  if (emptyEl) emptyEl.hidden = rows.length > 0;
  if (!rows.length) {
    root.innerHTML = "";
    if (emptyEl) emptyEl.textContent = orderEmptyMsg();
    return;
  }
  root.innerHTML = rows.map((o, i) => tradeOrderRowHtml(o, account, i)).join("");
}

export function selectedTradeOrders(account) {
  const keys = new Set(store.tradeOrderSelected || []);
  return filterTradeOrders(account).filter((o) => keys.has(orderKey(o)));
}

export function cancelableTradeOrders(account) {
  return (store.orders[account] || []).filter((o) => canCancelOrder(o) && o.order_sys_id);
}

function renderTradeTicket(account) {
  const tick = getTick(store.sel);
  const meta = symbolMeta(store.sel);
  const dec = meta?.dec ?? 0;
  const price = tick?.price > 0 ? tick.price : 0;
  const pos = positionFor(account, store.sel);
  const offset = store.offsetMode || "auto";
  const autoOffset = store.tradeAutoOffset !== false;

  const symInput = document.getElementById("trade-symbol-input");
  if (symInput) {
    symInput.value = store.sel;
    symInput.disabled = !!store.tradeSymbolLocked;
  }
  const scopeSel = document.getElementById("trade-ticket-scope");
  if (scopeSel && scopeSel.value !== (store.tradeTicketScope || "all")) {
    scopeSel.value = store.tradeTicketScope || "all";
  }
  const lockBtn = document.getElementById("trade-symbol-lock");
  if (lockBtn) lockBtn.classList.toggle("active", !!store.tradeSymbolLocked);

  const chgEl = document.getElementById("trade-t-change");
  if (chgEl) {
    if (price && tick?.pre_close > 0) {
      const chg = price - tick.pre_close;
      chgEl.textContent = (chg >= 0 ? "+" : "") + fmt(chg, dec);
      chgEl.className = `ticket-change ${cls(chg)}`;
    } else {
      chgEl.textContent = price ? fmt(price, dec) : "—";
      chgEl.className = "ticket-change";
    }
  }

  document.getElementById("trade-dir-buy").className = `ticket-dir buy${store.dir === "buy" ? " active" : ""}`;
  document.getElementById("trade-dir-sell").className = `ticket-dir sell${store.dir === "sell" ? " active" : ""}`;

  const autoChk = document.getElementById("trade-auto-offset");
  if (autoChk) autoChk.checked = autoOffset;
  const cancelChk = document.getElementById("trade-cancel-original");
  if (cancelChk) cancelChk.checked = !!store.tradeCancelOriginal;
  const cancelN = document.getElementById("trade-cancel-original-n");
  if (cancelN) cancelN.value = String(store.tradeCancelOriginalN || 2);

  const manualRow = document.getElementById("trade-offset-manual");
  if (manualRow) manualRow.hidden = autoOffset;
  if (!autoOffset) {
    document.getElementById("trade-offset-open").className = `ticket-seg${offset === "open" ? " active" : ""}`;
    document.getElementById("trade-offset-close").className = `ticket-seg${offset === "close" ? " active" : ""}`;
  }

  const priceMode = store.tradePriceMode || (store.otype === "limit" ? "limit" : "counter");
  const counterChk = document.getElementById("trade-price-counter");
  const limitChk = document.getElementById("trade-price-limit");
  if (counterChk) counterChk.checked = priceMode === "counter";
  if (limitChk) limitChk.checked = priceMode === "limit";

  const li = document.getElementById("trade-limit-input");
  if (li) {
    const cp = tick ? counterpartyPrice(tick, store.dir, false) : NaN;
    const showPx = priceMode === "limit"
      ? (store.limitPx || (price ? price.toFixed(dec) : ""))
      : (isFinite(cp) ? cp.toFixed(dec) : (price ? price.toFixed(dec) : ""));
    if (document.activeElement !== li) li.value = showPx;
    li.readOnly = priceMode === "counter";
  }

  const limits = estimateLimitPrices(tick, store.sel);
  const bid1 = tick?.bid1 > 0 ? tick.bid1 : null;
  const ask1 = tick?.ask1 > 0 ? tick.ask1 : null;
  const avail = pos?.avail > 0 ? pos.avail : (pos?.volume || 0);
  const qtyHint = document.getElementById("trade-qty-hint");
  if (qtyHint) qtyHint.textContent = pos ? `≤ ${avail} 手` : `≤ — 手`;
  const upEl = document.getElementById("trade-limit-up");
  if (upEl) upEl.textContent = limits.up ? `涨 ${fmt(limits.up, dec)}` : "涨 —";
  const dnEl = document.getElementById("trade-limit-down");
  if (dnEl) dnEl.textContent = limits.down ? `跌 ${fmt(limits.down, dec)}` : "跌 —";
  const bidEl = document.getElementById("trade-bid1");
  if (bidEl) bidEl.textContent = bid1 ? `① ${fmt(bid1, dec)}` : "① —";
  const askEl = document.getElementById("trade-ask1");
  if (askEl) askEl.textContent = ask1 ? `① ${fmt(ask1, dec)}` : "① —";

  document.getElementById("trade-qty-input").value = store.qty;

  const orderPx = priceMode === "limit"
    ? parseFloat(li?.value)
    : (tick ? counterpartyPrice(tick, store.dir, false) : price);
  const marginEl = document.getElementById("trade-margin-est");
  if (marginEl) {
    marginEl.textContent = isFinite(orderPx) && orderPx > 0
      ? fmt(estimateMargin(store.sel, orderPx, store.qty, account, pos), 0)
      : "—";
  }

  const resolved = autoOffset
    ? (pos && pos.avail > 0
      ? (store.dir === "sell" && String(pos.direction).includes("Long") ? "close"
        : store.dir === "buy" && !String(pos.direction).includes("Long") ? "close" : "open")
      : "open")
    : offset;

  const submitBtn = document.getElementById("trade-submit-btn");
  if (submitBtn) {
    submitBtn.textContent = "下单";
    submitBtn.className = `ticket-submit ${store.dir === "buy" ? "buy" : "sell"}`;
    submitBtn.title = `${orderActionLabel(store.dir, resolved === "close" ? "close" : "open")} ${store.qty} 手`;
  }

  const hint = document.getElementById("trade-pos-hint");
  if (pos && pos.volume > 0) {
    const dir = String(pos.direction).includes("Long") ? "多" : "空";
    hint.textContent = `持仓 ${dir} ${pos.volume} 手，可平 ${pos.avail} 手`;
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }
}

function estimateLimitPrices(tick, symbol) {
  const pre = tick?.pre_close;
  if (!(pre > 0)) return { up: null, down: null };
  const prod = String(symbol || "").replace(/\d+$/, "").toUpperCase();
  const ratio = ["IF", "IH", "IC", "IM", "T", "TF", "TS"].includes(prod) ? 0.1 : 0.06;
  return { up: pre * (1 + ratio), down: pre * (1 - ratio) };
}

function estimateMargin(symbol, price, qty, account, pos) {
  if (pos && pos.volume > 0 && pos.margin > 0) {
    return Math.round((pos.margin / pos.volume) * qty);
  }
  return Math.round(price * qty * contractMult(symbol) * 0.1);
}

function renderTradeBottom(account) {
  updateFillToolbar();
  updatePosToolbar();
  updateComboToolbar();
  updateStatsToolbar();
  if (store.tradeTab === "ord") store.tradeTab = "pos";
  document.getElementById("trade-tab-pos").className = `bt${store.tradeTab === "pos" ? " active" : ""}`;
  document.getElementById("trade-tab-fills").className = `bt${store.tradeTab === "fills" ? " active" : ""}`;
  document.getElementById("trade-tab-stats").className = `bt${store.tradeTab === "stats" ? " active" : ""}`;
  document.getElementById("trade-tab-combo").className = `bt${store.tradeTab === "combo" ? " active" : ""}`;
  const pos = store.positions[account] || [];
  const fills = store.trades[account] || [];
  document.getElementById("trade-tab-pos").textContent = `持仓列表 (${pos.length})`;
  document.getElementById("trade-tab-fills").textContent = `成交列表 (${fills.length})`;
  document.getElementById("trade-tab-combo").textContent = "自组合持仓列表";
  if (store.tradeTab === "pos") renderTradePositions(account);
  else if (store.tradeTab === "combo") renderTradeComboPositions(account);
  else if (store.tradeTab === "fills") renderTradeFills(account);
  else if (store.tradeTab === "stats") renderTradeStats(account);
}

function posTableHead(extraCol = "") {
  return `<table class="trade-pos-table"><thead><tr>
    <th class="chk"><input type="checkbox" id="trade-pos-select-all" title="全选" /></th>
    ${extraCol}
    <th>用户描述</th><th>合约代码</th><th>买卖</th><th>总仓</th><th>今仓</th><th>昨仓</th>
    <th>今仓冻结</th><th>昨仓冻结</th><th>持仓盈亏</th><th>平仓盈亏</th><th>持仓均价</th>
    <th>占用保证金</th><th>最新价</th><th>浮动盈亏</th><th>持仓市值</th>
    <th>止损价格</th><th>止盈价格</th><th>自动止损</th><th>自动止盈</th><th>触发手数</th>
  </tr></thead><tbody>`;
}

function renderTradePositions(account) {
  const el = document.getElementById("trade-tables");
  let rows = filterPositions(store.positions[account] || []);
  if ((store.tradePosMode || "single") === "group") {
    renderTradePosGroup(account, rows);
    return;
  }
  if (!rows.length) {
    renderPosTableFoot(null);
    el.innerHTML = `<div class="empty">${posEmptyMsg()}</div>`;
    return;
  }
  let html = posTableHead();
  const totals = { volume: 0, margin: 0, float_pnl: 0, mktval: 0, pos_pnl: 0, close_pnl: 0 };
  rows.forEach((p) => {
    html += positionRowHtml(p, account);
    totals.volume += p.volume || 0;
    totals.margin += p.margin || 0;
    totals.float_pnl += positionLivePnl(p);
    totals.mktval += positionMarketValue(p);
    totals.pos_pnl += p.position_profit || 0;
    totals.close_pnl += p.close_profit || 0;
  });
  el.innerHTML = html + "</tbody></table>";
  renderPosTableFoot({
    volume: totals.volume,
    margin: totals.margin,
    float_pnl: totals.float_pnl,
    mktval: totals.mktval,
  });
}

function renderTradePosGroup(account, rows) {
  const el = document.getElementById("trade-tables");
  const groups = groupPositionsByProduct(rows);
  if (!groups.length) {
    renderPosTableFoot(null);
    el.innerHTML = `<div class="empty">${posEmptyMsg()}</div>`;
    return;
  }
  let html = posTableHead();
  const totals = { volume: 0, margin: 0, float_pnl: 0, mktval: 0, pos_pnl: 0, close_pnl: 0 };
  groups.forEach((g) => {
    const pseudo = {
      symbol: g.symbol,
      direction: g.direction,
      volume: g.volume,
      today_volume: g.today_volume,
      yd_volume: g.yd_volume,
      today_frozen: g.today_frozen,
      yd_frozen: g.yd_frozen,
      position_profit: g.position_profit,
      close_profit: g.close_profit,
      open_price: g.open_price,
      margin: g.margin,
      avail: g.volume,
    };
    html += positionRowHtml(pseudo, account, {
      symbolLabel: `${g.name} (${g.symbols.join("/")})`,
      posKeys: g.legs.map(positionKey),
    });
    totals.volume += g.volume;
    totals.margin += g.margin;
    totals.float_pnl += g.float_pnl;
    totals.mktval += g.market_value;
    totals.pos_pnl += g.position_profit;
    totals.close_pnl += g.close_profit;
  });
  el.innerHTML = html + "</tbody></table>";
  renderPosTableFoot({
    volume: totals.volume,
    margin: totals.margin,
    float_pnl: totals.float_pnl,
    mktval: totals.mktval,
  });
}

function comboEmptyMsg() {
  const hint = connHintMsg();
  if (hint) return hint;
  if (!loadCombos().length) return "请在「持仓列表」勾选持仓后，点击「加入自组合」创建组合";
  return "自组合暂无匹配持仓（组合内合约当前无持仓）";
}

const COMBO_TABLE_HEAD = `<table class="trade-combo-table"><thead><tr>
  <th>用户描述</th><th>合约名</th><th>合约代码</th><th>买卖</th><th>份数</th><th>持仓手数</th>
  <th>计算公式</th><th>持仓均价</th><th>持仓盈亏</th><th>浮动盈亏</th><th>开仓均价</th>
</tr></thead><tbody>`;

function comboRowHtml(p, account) {
  const key = positionKey(p);
  const selected = (store.tradePosSelected || []).includes(key);
  const meta = symbolMeta(p.symbol);
  const dec = meta?.dec ?? 0;
  const dir = posDirLabel(p);
  const floatPnl = positionLivePnl(p);
  const posAvg = p.position_cost ? (p.position_cost / (p.volume || 1)) : (p.open_price || 0);
  return `<tr class="trade-combo-row${selected ? " selected" : ""}" data-pos-key="${key}" data-pos-keys="${key}">
    <td>${p.comboName || "—"}</td>
    <td>${meta?.name || "—"}</td>
    <td>${p.symbol}</td>
    <td class="${dir === "买" ? "up" : "down"}">${dir}</td>
    <td>${p.legRatio || 1}</td>
    <td>${p.volume ?? 0}</td>
    <td class="combo-formula">${comboFormulaText(p.comboId)}</td>
    <td class="tab">${fmt(posAvg, dec)}</td>
    <td class="tab ${cls(p.position_profit || 0)}">${fmt(p.position_profit || 0, 2)}</td>
    <td class="tab ${cls(floatPnl)}">${fmt(floatPnl, 2)}</td>
    <td class="tab">${fmt(p.open_price || 0, dec)}</td>
  </tr>`;
}

function renderTradeComboPositions(account) {
  const el = document.getElementById("trade-tables");
  const rows = filterComboPositions(comboPositionRows(account));
  if (!rows.length) {
    fillEmptyTable(el, COMBO_TABLE_HEAD, 11, comboEmptyMsg());
    return;
  }
  let html = COMBO_TABLE_HEAD;
  rows.forEach((p) => {
    html += comboRowHtml(p, account);
  });
  el.innerHTML = html + "</tbody></table>";
}

function renderTradeFills(account) {
  const el = document.getElementById("trade-tables");
  const rows = filterTrades(account);
  const emptyMsg = tradeEmptyMsg();
  if ((store.tradeFillMode || "detail") === "summary") {
    if (!rows.length) {
      fillEmptyTable(el, FILL_SUMMARY_HEAD, 9, emptyMsg);
      return;
    }
    renderTradeFillsSummary(el, rows);
    return;
  }
  if (!rows.length) {
    fillEmptyTable(el, FILL_DETAIL_HEAD, 10, emptyMsg);
    return;
  }
  let html = FILL_DETAIL_HEAD;
  rows.forEach((t, i) => {
    const meta = symbolMeta(t.symbol);
    const vol = Number(t.volume) || 0;
    const comm = Number(t.commission) || 0;
    const pnl = Number(t.close_profit) || 0;
    const dir = dirLabel(t.direction);
    html += `<tr>
      <td>${i + 1}</td>
      <td class="tab">${t.order_sys_id || t.trade_id || "—"}</td>
      <td>${t.symbol}</td>
      <td class="${dir === "买" ? "up" : "down"}">${dir}</td>
      <td>${offsetLabel(t.offset)}</td>
      <td class="tab">${fmt(t.price, meta?.dec ?? 0)}</td>
      <td>${vol}</td>
      <td class="tab">${comm ? fmt(comm, 2) : "—"}</td>
      <td>${tradeTime(t)}</td>
      <td class="tab ${pnl ? cls(pnl) : ""}">${pnl ? fmt(pnl, 2) : "—"}</td>
    </tr>`;
  });
  el.innerHTML = html + "</tbody></table>";
}

function renderTradeFillsSummary(el, rows) {
  const groups = summarizeTrades(rows);
  let html = FILL_SUMMARY_HEAD;
  groups.forEach((g, i) => {
    const dir = dirLabel(g.direction);
    html += `<tr>
      <td>${i + 1}</td>
      <td>${g.symbol}</td>
      <td class="${dir === "买" ? "up" : "down"}">${dir}</td>
      <td>${offsetLabel(g.offset)}</td>
      <td class="tab">${fmt(g.price, symbolMeta(g.symbol)?.dec ?? 0)}</td>
      <td>${g.volume}</td>
      <td>${g.count}</td>
      <td class="tab">${g.commission ? fmt(g.commission, 2) : "—"}</td>
      <td class="tab ${g.close_profit ? cls(g.close_profit) : ""}">${g.close_profit ? fmt(g.close_profit, 2) : "—"}</td>
    </tr>`;
  });
  el.innerHTML = html + "</tbody></table>";
}

function statsEmptyMsg(account) {
  if (store.conn !== "open") return "登录期货账户后可查看数据";
  const login = account ? store.login[account] : null;
  if (login !== "ok" && login !== "md_ok") return "登录期货账户后可查看数据";
  return "暂无统计数据";
}

const STATS_HEAD = `<table class="trade-stats-table trade-fill-table"><thead><tr>
  <th>品种统计</th><th>用户描述</th><th>总持仓</th><th>净持仓</th><th>多头持仓</th><th>空头持仓</th>
  <th>持仓盈亏</th><th>浮动盈亏</th><th>平仓盈亏</th><th>手续费</th><th>总盈亏</th><th>权利金</th>
  <th>持仓市值</th><th>$Delta</th><th>1%$Gamma</th><th>$Vega</th><th>$Theta</th><th>$Rho</th><th>$时间价</th>
</tr></thead><tbody>`;

function renderTradeStats(account) {
  const el = document.getElementById("trade-tables");
  const rows = filterTradeStats(tradeStatsByProduct(account));
  const emptyMsg = statsEmptyMsg(account);
  if (!rows.length) {
    fillEmptyTable(el, STATS_HEAD, 19, emptyMsg);
    return;
  }
  let html = STATS_HEAD;
  rows.forEach((g) => {
    html += `<tr>
      <td>${g.label}</td>
      <td>${account}</td>
      <td>${g.total}</td>
      <td class="${cls(g.net)}">${g.net >= 0 ? "+" : ""}${g.net}</td>
      <td>${g.long}</td>
      <td>${g.short}</td>
      <td class="tab ${cls(g.posPnl)}">${fmt(g.posPnl, 2)}</td>
      <td class="tab ${cls(g.floatPnl)}">${fmt(g.floatPnl, 2)}</td>
      <td class="tab ${cls(g.closePnl)}">${fmt(g.closePnl, 2)}</td>
      <td class="tab">${g.commission ? fmt(g.commission, 2) : "—"}</td>
      <td class="tab ${cls(g.totalPnl)}">${fmt(g.totalPnl, 2)}</td>
      <td>—</td>
      <td class="tab">${g.mktVal ? fmt(g.mktVal, 2) : "—"}</td>
      <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>
    </tr>`;
  });
  el.innerHTML = html + "</tbody></table>";
}
