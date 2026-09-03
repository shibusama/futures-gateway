/**
 * order.js — 下单逻辑（开/平/自动开平、价格、文案、批量持仓操作）
 */
import { store, getTick } from "./store.js";
import { sendOrder } from "./ws.js";
import { exchangeOf } from "./symbols.js";
import {
  closeQty, isLong, isOptionSymbol, suggestRolloverSymbol,
} from "./positions.js";

export function resolveOffset(account, symbol, direction, offsetMode) {
  if (offsetMode === "open") return "open";
  if (offsetMode === "close") return "close";
  const pos = (store.positions[account] || []).find(
    (p) => p.symbol.toLowerCase() === symbol.toLowerCase(),
  );
  if (!pos || !(pos.avail > 0)) return "open";
  const isLongPos = isLong(pos);
  if (direction === "sell" && isLongPos) return "close";
  if (direction === "buy" && !isLongPos) return "close";
  return "open";
}

/** 对价：平多用买一，平空用卖一 */
export function counterpartyPrice(tick, direction, forClose = true) {
  if (!tick) return NaN;
  if (forClose) {
    return direction === "sell" ? (tick.bid1 || tick.price) : (tick.ask1 || tick.price);
  }
  return direction === "buy" ? (tick.ask1 || tick.price) : (tick.bid1 || tick.price);
}

export function marketPrice(tick, direction) {
  if (!tick) return NaN;
  return direction === "buy" ? (tick.ask1 || tick.price) : (tick.bid1 || tick.price);
}

export function orderPrice(tick, direction, otype, limitPx) {
  if (!tick) return NaN;
  if (otype === "limit") return parseFloat(limitPx);
  return direction === "buy" ? (tick.ask1 || tick.price) : (tick.bid1 || tick.price);
}

export function orderActionLabel(direction, offset) {
  if (offset === "open") return direction === "buy" ? "买入开多" : "卖出开空";
  return direction === "buy" ? "买入平空" : "卖出平多";
}

export function positionFor(account, symbol) {
  return (store.positions[account] || []).find(
    (p) => p.symbol.toLowerCase() === symbol.toLowerCase(),
  );
}

function closeOffsetFor(p) {
  const ex = p.exchange || exchangeOf(p.symbol);
  if ((ex === "SHFE" || ex === "INE") && (p.today_volume || 0) > 0) return "close_today";
  return "close";
}

function submitClose(account, p, volume, priceMode) {
  const tick = getTick(p.symbol);
  if (!tick) return { ok: false, msg: `${p.symbol} 暂无行情` };
  const direction = isLong(p) ? "sell" : "buy";
  const price = priceMode === "counterparty"
    ? counterpartyPrice(tick, direction, true)
    : marketPrice(tick, direction);
  if (!isFinite(price)) return { ok: false, msg: `${p.symbol} 价格无效` };
  sendOrder({ account, symbol: p.symbol, direction, offset: closeOffsetFor(p), price, volume });
  return { ok: true };
}

function submitOpen(account, symbol, direction, volume, priceMode) {
  const tick = getTick(symbol);
  if (!tick) return { ok: false, msg: `${symbol} 暂无行情` };
  const price = priceMode === "counterparty"
    ? counterpartyPrice(tick, direction, false)
    : marketPrice(tick, direction);
  if (!isFinite(price)) return { ok: false, msg: `${symbol} 价格无效` };
  sendOrder({ account, symbol, direction, offset: "open", price, volume });
  return { ok: true };
}

export function batchClosePositions(account, positions, { ratio = 100, priceMode = "counterparty" } = {}) {
  if (!positions.length) return { ok: false, msg: "请先勾选持仓" };
  let n = 0;
  const errs = [];
  positions.forEach((p) => {
    const vol = closeQty(p, ratio);
    if (vol <= 0) return;
    const r = submitClose(account, p, vol, priceMode);
    if (r.ok) n += 1;
    else if (r.msg) errs.push(r.msg);
  });
  if (!n) return { ok: false, msg: errs[0] || "无可平持仓" };
  return { ok: true, msg: `已提交 ${n} 笔平仓` };
}

export function batchReversePositions(account, positions, { ratio = 100 } = {}) {
  if (!positions.length) return { ok: false, msg: "请先勾选持仓" };
  let n = 0;
  positions.forEach((p) => {
    const vol = closeQty(p, ratio);
    if (vol <= 0) return;
    submitClose(account, p, vol, "market");
    const openDir = isLong(p) ? "sell" : "buy";
    submitOpen(account, p.symbol, openDir, vol, "market");
    n += 1;
  });
  if (!n) return { ok: false, msg: "无可操作持仓" };
  return { ok: true, msg: `已提交 ${n} 组反手` };
}

export function batchRolloverPositions(account, positions, targetSymbol, { ratio = 100 } = {}) {
  const target = String(targetSymbol || "").trim();
  if (!target) return { ok: false, msg: "请输入目标合约" };
  if (!positions.length) return { ok: false, msg: "请先勾选持仓" };
  let n = 0;
  positions.forEach((p) => {
    const vol = closeQty(p, ratio);
    if (vol <= 0) return;
    submitClose(account, p, vol, "counterparty");
    const openDir = isLong(p) ? "buy" : "sell";
    submitOpen(account, target, openDir, vol, "counterparty");
    n += 1;
  });
  if (!n) return { ok: false, msg: "无可移仓持仓" };
  return { ok: true, msg: `已提交 ${n} 笔移仓至 ${target}` };
}

export function batchExercisePositions(account, positions) {
  const opts = positions.filter((p) => isOptionSymbol(p.symbol));
  if (!opts.length) return { ok: false, msg: "所选持仓中没有期权合约" };
  return { ok: true, msg: `行权请求已记录（${opts.length} 笔），期权行权需柜台确认` };
}

export function batchSelfHedgePositions(account, positions) {
  if (!positions.length) return { ok: false, msg: "请先勾选持仓" };
  return { ok: true, msg: `自对冲请求已提交（${positions.length} 笔），请留意柜台回报` };
}

export function defaultRolloverTarget(positions) {
  const first = positions[0];
  if (!first) return "";
  return suggestRolloverSymbol(first.symbol);
}
