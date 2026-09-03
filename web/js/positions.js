/**
 * positions.js — 持仓筛选、组合、手工止盈止损（UI 本地存储）
 */
import { store, getTick, positionLivePnl, contractMult, pxOf } from "./store.js";
import { exchangeOf, symbolMeta } from "./symbols.js";

const SLTP_KEY = "fg_pos_sltp";
const COMBO_KEY = "fg_combo_portfolios";

export function tradeStatsByProduct(account) {
  const pos = store.positions[account] || [];
  const trades = store.trades[account] || [];
  const map = new Map();

  function ensure(prod) {
    if (!map.has(prod)) {
      const meta = symbolMeta(prod + "2609") || symbolMeta(prod + "609");
      map.set(prod, {
        product: prod,
        label: meta?.name ? `${meta.name}(${prod.toUpperCase()})` : prod.toUpperCase(),
        long: 0,
        short: 0,
        posPnl: 0,
        floatPnl: 0,
        closePnl: 0,
        commission: 0,
        mktVal: 0,
        exchanges: new Set(),
      });
    }
    return map.get(prod);
  }

  pos.forEach((p) => {
    const prod = String(p.symbol || "").replace(/\d+$/, "");
    if (!prod) return;
    const g = ensure(prod);
    const vol = p.volume || 0;
    if (isLong(p)) g.long += vol;
    else g.short += vol;
    g.posPnl += Number(p.position_profit) || 0;
    g.floatPnl += positionLivePnl(p);
    g.closePnl += Number(p.close_profit) || 0;
    g.mktVal += positionMarketValue(p);
    g.exchanges.add(p.exchange || exchangeOf(p.symbol));
  });

  trades.forEach((t) => {
    const prod = String(t.symbol || "").replace(/\d+$/, "");
    if (!prod) return;
    const g = ensure(prod);
    g.commission += Number(t.commission) || 0;
  });

  return [...map.values()]
    .map((g) => ({
      ...g,
      exchanges: [...g.exchanges],
      total: g.long + g.short,
      net: g.long - g.short,
      totalPnl: g.floatPnl + g.closePnl,
    }))
    .sort((a, b) => String(a.product).localeCompare(String(b.product)));
}

export function filterTradeStats(rows) {
  let filtered = [...(rows || [])];
  const type = store.tradeStatsType || "all";
  const ex = store.tradeStatsExchange || "all";
  const query = String(store.tradeStatsQuery || "").trim();
  if (type === "long") filtered = filtered.filter((g) => g.net > 0);
  else if (type === "short") filtered = filtered.filter((g) => g.net < 0);
  if (ex !== "all") filtered = filtered.filter((g) => g.exchanges.includes(ex));
  if (query) {
    const terms = query.split(/[,，\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    filtered = filtered.filter((g) => {
      const prod = String(g.product || "").toLowerCase();
      const label = String(g.label || "").toLowerCase();
      return terms.some((term) => prod.includes(term) || label.includes(term));
    });
  }
  return filtered;
}

export function positionKey(p) {
  return `${p.symbol}_${p.direction}`;
}

export function isLong(p) {
  return String(p.direction).includes("Long");
}

export function posDirLabel(p) {
  return isLong(p) ? "买" : "卖";
}

export function matchPosQuery(p, query) {
  const q = String(query || "").trim();
  if (!q) return true;
  const terms = q.split(/[,，\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const sym = String(p.symbol || "").toLowerCase();
  const meta = symbolMeta(p.symbol);
  const name = (meta?.name || "").toLowerCase();
  const prod = sym.replace(/\d+$/, "");
  return terms.some((term) => sym.includes(term) || prod.includes(term) || name.includes(term));
}

export function filterPositions(list) {
  let rows = [...(list || [])];
  const type = store.tradePosType || "all";
  const ex = store.tradePosExchange || "all";
  const query = store.tradePosQuery || "";
  if (type === "long") rows = rows.filter(isLong);
  else if (type === "short") rows = rows.filter((p) => !isLong(p));
  if (ex !== "all") rows = rows.filter((p) => (p.exchange || exchangeOf(p.symbol)) === ex);
  if (query) rows = rows.filter((p) => matchPosQuery(p, query));
  return rows;
}

export function positionMarketValue(p) {
  const px = pxOf(p.symbol);
  if (!(px > 0)) return 0;
  return px * (p.volume || 0) * contractMult(p.symbol);
}

function loadSLTPMap() {
  try {
    const raw = localStorage.getItem(SLTP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function saveSLTPMap(map) {
  try {
    localStorage.setItem(SLTP_KEY, JSON.stringify(map));
  } catch (_) { /* ignore */ }
}

export function sltpKey(account, p) {
  return `${account}_${positionKey(p)}`;
}

export function getManualSLTP(account, p) {
  const map = loadSLTPMap();
  return map[sltpKey(account, p)] || null;
}

export function setManualSLTP(account, p, data) {
  const map = loadSLTPMap();
  map[sltpKey(account, p)] = { ...data };
  saveSLTPMap(map);
}

export function loadCombos() {
  try {
    const raw = localStorage.getItem(COMBO_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

export function saveCombos(list) {
  localStorage.setItem(COMBO_KEY, JSON.stringify(list));
}

export function addPositionsToCombo(comboName, positions) {
  const name = String(comboName || "").trim();
  if (!name) return { ok: false, msg: "请输入组合名称" };
  if (!positions.length) return { ok: false, msg: "请先勾选持仓" };
  const combos = loadCombos();
  let combo = combos.find((c) => c.name === name);
  if (!combo) {
    combo = { id: `c_${Date.now()}`, name, legs: [] };
    combos.push(combo);
  }
  positions.forEach((p) => {
    const leg = { symbol: p.symbol, direction: p.direction, ratio: 1 };
    const exists = combo.legs.some(
      (l) => l.symbol === leg.symbol && l.direction === leg.direction,
    );
    if (!exists) combo.legs.push(leg);
  });
  saveCombos(combos);
  return { ok: true, msg: `已加入组合「${name}」`, combos };
}

export function comboPositionRows(account) {
  const combos = loadCombos();
  const pos = store.positions[account] || [];
  const rows = [];
  combos.forEach((combo) => {
    combo.legs.forEach((leg) => {
      const hit = pos.find(
        (p) => p.symbol === leg.symbol && p.direction === leg.direction && p.volume > 0,
      );
      if (hit) rows.push({ ...hit, comboName: combo.name, comboId: combo.id, legRatio: leg.ratio || 1 });
    });
  });
  return rows;
}

export function groupPositionsByProduct(list) {
  const map = new Map();
  list.forEach((p) => {
    const prod = String(p.symbol || "").replace(/\d+$/, "").toUpperCase();
    const key = `${prod}_${isLong(p) ? "L" : "S"}`;
    const meta = symbolMeta(p.symbol);
    if (!map.has(key)) {
      map.set(key, {
        product: prod,
        name: meta?.name || prod,
        direction: p.direction,
        symbols: [],
        volume: 0,
        today_volume: 0,
        yd_volume: 0,
        today_frozen: 0,
        yd_frozen: 0,
        margin: 0,
        position_profit: 0,
        close_profit: 0,
        open_amount: 0,
        legs: [],
      });
    }
    const g = map.get(key);
    g.symbols.push(p.symbol);
    g.volume += p.volume || 0;
    g.today_volume += p.today_volume || 0;
    g.yd_volume += p.yd_volume || 0;
    g.today_frozen += p.today_frozen || 0;
    g.yd_frozen += p.yd_frozen || 0;
    g.margin += p.margin || 0;
    g.position_profit += p.position_profit || 0;
    g.close_profit += p.close_profit || 0;
    g.open_amount += (p.open_price || 0) * (p.volume || 0);
    g.legs.push(p);
  });
  return [...map.values()].map((g) => ({
    ...g,
    open_price: g.volume > 0 ? g.open_amount / g.volume : 0,
    float_pnl: g.legs.reduce((s, p) => s + positionLivePnl(p), 0),
    market_value: g.legs.reduce((s, p) => s + positionMarketValue(p), 0),
    symbol: g.symbols.join(","),
  }));
}

export function closeQty(p, ratioPct) {
  const ratio = Math.max(0, Math.min(100, Number(ratioPct) || 100)) / 100;
  const avail = p.avail || p.volume || 0;
  if (ratio >= 1) return avail;
  return Math.max(1, Math.floor(avail * ratio));
}

export function isOptionSymbol(symbol) {
  return /[-]?[CPcp]\d/.test(String(symbol || "")) || /_o/i.test(String(symbol || ""));
}

export function suggestRolloverSymbol(symbol) {
  const m = String(symbol || "").match(/^([a-zA-Z]+)(\d+)$/);
  if (!m) return "";
  const prod = m[1];
  const num = m[2];
  if (num.length === 4) {
    const y = parseInt(num.slice(0, 2), 10);
    const mo = parseInt(num.slice(2), 10);
    const nextMo = mo >= 12 ? 1 : mo + 1;
    const nextY = mo >= 12 ? y + 1 : y;
    return `${prod}${String(nextY).padStart(2, "0")}${String(nextMo).padStart(2, "0")}`;
  }
  return "";
}

export function selectedPositions(account) {
  const keys = new Set(store.tradePosSelected || []);
  return (store.positions[account] || []).filter((p) => keys.has(positionKey(p)));
}

export function togglePosSelection(key, checked) {
  const set = new Set(store.tradePosSelected || []);
  if (checked) set.add(key);
  else set.delete(key);
  store.tradePosSelected = [...set];
}

export function setAllPosSelection(keys, checked) {
  const set = new Set(store.tradePosSelected || []);
  keys.forEach((k) => {
    if (checked) set.add(k);
    else set.delete(k);
  });
  store.tradePosSelected = [...set];
}
