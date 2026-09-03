/**
 * ui_trade.js — 通用下单页（专业终端风格：资金条 + 自选/挂单 + 下单板 + 持仓报单）
 */
import { store, getTick, tickIsLive, acctFloat, positionLivePnl, emit } from "./store.js";
import { getWatchlist, symbolMeta, canCancelOrder, exchangeOf, addWatchlistSymbol, removeWatchlistSymbol } from "./symbols.js";
import { orderActionLabel, positionFor } from "./order.js";
import {
  positionKey, posDirLabel, filterPositions, positionMarketValue, getManualSLTP,
  groupPositionsByProduct, comboPositionRows, loadCombos,
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

function orderStatus(o) {
  switch (o.status) {
    case "0": return "全部成交";
    case "1": return "部分成交";
    case "3": return "未成交";
    case "4": return "已撤销";
    default: return o.status_msg || o.status;
  }
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

function hedgeLabel(hedge) {
  if (hedge === "3") return "套保";
  return "投机";
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
  const show = store.tradeTab === "pos" || store.tradeTab === "combo";
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
  const addCombo = document.getElementById("trade-add-combo");
  if (addCombo) addCombo.hidden = store.tradeTab !== "combo";
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

function posEmptyMsg() {
  if (store.conn !== "open") return "登录期货账户后可查看数据";
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

function pendingOrders(account) {
  return (store.orders[account] || []).filter((o) => canCancelOrder(o));
}

export function renderTrade() {
  const account = stateAccount();
  if (!account) {
    emit({ type: "toast", msg: "请先在概览页配置并连接账户" });
    return;
  }
  renderTradeBar(account);
  renderTradeWatchlist();
  renderTradeTicket(account);
  renderTradePending(account);
  renderTradeBottom(account);
}

export function selectTradeSymbol(code) {
  store.sel = code;
  renderTradeTicket(stateAccount());
  renderTradeWatchlist();
}

export function refreshTradeLive() {
  patchTradeWatchlistQuotes();
  renderTradeTicket(stateAccount());
  const account = stateAccount();
  if (account) {
    renderTradePending(account);
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
      <td>${account}</td>
      <td class="tab">${fmt(b.balance + (fpnl - ((b.position_profit || 0) + (b.close_profit || 0))))}</td>
      <td class="tab">${fmt(b.available)}</td>
      <td class="tab ${cls(fpnl)}">${fpnl >= 0 ? "+" : ""}${fmt(fpnl)}</td>
      <td class="tab">${fmt(b.margin)}</td>
      <td class="tab">${risk}</td>
      <td class="tab">${fmt(b.commission)}</td>
    </tr>` : `<tr><td colspan="7" class="empty">等待资金回报…</td></tr>`;
}

function quoteBits(s) {
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
  return { p, pcText, pcCls, stale: !!(p && !tickIsLive(s.code)) };
}

function patchTradeWatchlistQuotes() {
  const root = document.getElementById("trade-watchlist");
  if (!root) return;
  getWatchlist().forEach((s) => {
    const row = root.querySelector(`.wl-row[data-code="${s.code}"]`);
    if (!row) return;
    const item = row.closest(".wl-item");
    const tabs = row.querySelectorAll(".tab");
    const q = quoteBits(s);
    if (tabs[0]) tabs[0].textContent = q.p ? fmt(q.p, s.dec) : "—";
    if (tabs[1]) {
      tabs[1].textContent = q.pcText;
      tabs[1].className = `right tab ${q.pcCls}`;
    }
    if (item) {
      item.classList.toggle("active", s.code === store.sel);
      item.classList.toggle("stale", q.stale);
    }
  });
}

function renderTradeWatchlist() {
  const symbols = getWatchlist();
  if (!symbols.some((s) => s.code === store.sel)) {
    store.sel = symbols[0]?.code || store.sel;
  }
  const root = document.getElementById("trade-watchlist");
  const key = symbols.map((s) => s.code).join(",");
  if (root.dataset.codes === key && root.querySelectorAll(".wl-row").length === symbols.length) {
    patchTradeWatchlistQuotes();
    return;
  }
  root.dataset.codes = key;
  const canRemove = symbols.length > 1;
  root.innerHTML = symbols.map((s) => {
    const q = quoteBits(s);
    return `<div class="wl-item${store.sel === s.code ? " active" : ""}${q.stale ? " stale" : ""}">
      <button type="button" class="wl-row" data-code="${s.code}">
        <span class="wl-name">${s.name}<small>${s.code}</small></span>
        <span class="right tab">${q.p ? fmt(q.p, s.dec) : "—"}</span>
        <span class="right tab ${q.pcCls}">${q.pcText}</span>
      </button>
      ${canRemove ? `<button type="button" class="wl-remove" data-remove="${s.code}" title="移除">×</button>` : ""}
    </div>`;
  }).join("");
}

function renderTradeTicket(account) {
  const sym = currentSymbol();
  const tick = getTick(store.sel);
  const price = tick?.price > 0 ? tick.price : 0;
  const pos = positionFor(account, store.sel);
  const offset = store.offsetMode || "auto";

  document.getElementById("trade-symbol-input").value = store.sel;
  document.getElementById("trade-t-price").textContent = price ? fmt(price, sym.dec) : "—";
  document.getElementById("trade-t-price").className = price ? cls((tick.pre_close ? price - tick.pre_close : 0)) : "";

  document.getElementById("trade-dir-buy").className = `dt buy${store.dir === "buy" ? " active" : ""}`;
  document.getElementById("trade-dir-sell").className = `dt sell${store.dir === "sell" ? " active" : ""}`;
  document.getElementById("trade-offset-auto").className = `seg${offset === "auto" ? " active" : ""}`;
  document.getElementById("trade-offset-open").className = `seg${offset === "open" ? " active" : ""}`;
  document.getElementById("trade-offset-close").className = `seg${offset === "close" ? " active" : ""}`;

  document.getElementById("trade-qty-input").value = store.qty;
  document.getElementById("trade-otype-market").className = `seg${store.otype === "market" ? " active" : ""}`;
  document.getElementById("trade-otype-limit").className = `seg${store.otype === "limit" ? " active" : ""}`;
  const li = document.getElementById("trade-limit-input");
  li.style.display = store.otype === "limit" ? "block" : "none";
  if (store.otype === "limit" && !li.value && price) li.value = price.toFixed(sym.dec);

  const resolved = offset === "auto"
    ? (pos && pos.avail > 0
      ? (store.dir === "sell" && String(pos.direction).includes("Long") ? "close"
        : store.dir === "buy" && !String(pos.direction).includes("Long") ? "close" : "open")
      : "open")
    : offset;

  const label = orderActionLabel(store.dir, resolved === "close" ? "close" : "open");
  document.getElementById("trade-submit-btn").textContent = `${label} ${store.qty} 手`;
  document.getElementById("trade-submit-btn").className = `big-btn ${store.dir === "buy" ? "buy" : "sell"}`;

  const hint = document.getElementById("trade-pos-hint");
  if (pos && pos.volume > 0) {
    const dir = String(pos.direction).includes("Long") ? "多" : "空";
    hint.textContent = `持仓 ${dir} ${pos.volume} 手，可平 ${pos.avail} 手`;
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }
}

function renderTradePending(account) {
  const el = document.getElementById("trade-pending");
  const ords = pendingOrders(account);
  document.getElementById("trade-pending-count").textContent = ords.length;
  if (!ords.length) {
    el.innerHTML = '<div class="empty trade-empty">暂无未成交委托</div>';
    return;
  }
  let html = `<table><thead><tr>
    <th>合约</th><th>方向</th><th>开平</th><th>价格</th><th>数量</th><th>状态</th><th></th>
  </tr></thead><tbody>`;
  ords.forEach((o) => {
    const dir = o.direction === "0" ? "买" : "卖";
    const off = o.offset === "0" ? "开" : "平";
    html += `<tr>
      <td>${o.symbol}</td>
      <td class="${dir === "买" ? "up" : "down"}">${dir}</td>
      <td>${off}</td>
      <td class="tab">${fmt(o.limit_price, 0)}</td>
      <td>${o.volume_total - (o.volume_traded || 0)}</td>
      <td><span class="badge b-wait">${orderStatus(o)}</span></td>
      <td><button type="button" class="btn-cancel" data-cancel-order="${o.order_sys_id || ""}"
        data-symbol="${o.symbol}" data-exchange="${o.exchange || exchangeOf(o.symbol)}">撤</button></td>
    </tr>`;
  });
  el.innerHTML = html + "</tbody></table>";
}

function renderTradeBottom(account) {
  updateFillToolbar();
  updatePosToolbar();
  updateStatsToolbar();
  if (store.tradeTab === "ord") store.tradeTab = "pos";
  document.getElementById("trade-tab-pos").className = `bt${store.tradeTab === "pos" ? " active" : ""}`;
  document.getElementById("trade-tab-fills").className = `bt${store.tradeTab === "fills" ? " active" : ""}`;
  document.getElementById("trade-tab-stats").className = `bt${store.tradeTab === "stats" ? " active" : ""}`;
  document.getElementById("trade-tab-combo").className = `bt${store.tradeTab === "combo" ? " active" : ""}`;
  const pos = store.positions[account] || [];
  const fills = store.trades[account] || [];
  const combos = loadCombos();
  document.getElementById("trade-tab-pos").textContent = `持仓列表 (${pos.length})`;
  document.getElementById("trade-tab-fills").textContent = `成交列表 (${fills.length})`;
  document.getElementById("trade-tab-combo").textContent = `自组合持仓 (${combos.length})`;
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

function renderTradeComboPositions(account) {
  const el = document.getElementById("trade-tables");
  let rows = comboPositionRows(account);
  rows = filterPositions(rows);
  if (!rows.length) {
    renderPosTableFoot(null);
    const hint = loadCombos().length
      ? "自组合暂无匹配持仓（组合内合约当前无持仓）"
      : "请勾选持仓后点击「加入自组合」创建组合";
    el.innerHTML = `<div class="empty">${store.conn === "open" ? hint : "登录期货账户后可查看数据"}</div>`;
    return;
  }
  let html = posTableHead("<th>组合名称</th>");
  const totals = { volume: 0, margin: 0, float_pnl: 0, mktval: 0, pos_pnl: 0, close_pnl: 0 };
  rows.forEach((p) => {
    html += positionRowHtml(p, account, { comboName: p.comboName });
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
