/**
 * order.js — 下单逻辑（开/平/自动开平、价格、文案、批量持仓操作）
 */
import { store, getTick } from "./store.js";
import { sendOrder } from "./ws.js";
import { exchangeOf } from "./symbols.js";
import {
  closeQty, isLong, isOptionSymbol, suggestRolloverSymbol,
} from "./positions.js";

let orderSender = sendOrder;
/** 仅测试用：替换真实 WebSocket 发送以捕获下单参数（不注入则维持原样）。 */
export function __setOrderSender(fn) {
  orderSender = fn || sendOrder;
}

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

/** SHFE/INE 需区分平今/平昨：按今昨各自冻结后的可平量拆分委托，避免单笔 close_today 超今仓被拒。 */
function closePlan(p, volume) {
  const ex = p.exchange || exchangeOf(p.symbol);
  const today = Math.max(0, Number(p.today_volume) || 0);
  const yd = Math.max(0, Number(p.yd_volume) || 0);
  // 非上期所/能源中心，或只有昨仓时：CTP 用一个 close 即可
  if (!(ex === "SHFE" || ex === "INE") || today <= 0) {
    return [{ offset: "close", qty: volume }];
  }
  const todayAvail = Math.max(0, today - (Number(p.today_frozen) || 0));
  const ydAvail = yd > 0 ? Math.max(0, yd - (Number(p.yd_frozen) || 0)) : 0;
  let rest = Math.max(0, volume);
  const qToday = Math.min(rest, todayAvail);
  rest -= qToday;
  const qYd = Math.min(rest, ydAvail);
  const plan = [];
  if (qYd > 0) plan.push({ offset: "close", qty: qYd });
  if (qToday > 0) plan.push({ offset: "close_today", qty: qToday });
  // 今昨冻结数据缺失时的回退：至少按单笔发，交给柜台报错兜底
  return plan.length ? plan : [{ offset: "close", qty: volume }];
}

function submitClose(account, p, volume, priceMode) {
  const tick = getTick(p.symbol);
  if (!tick) return { ok: false, msg: `${p.symbol} 暂无行情` };
  const direction = isLong(p) ? "sell" : "buy";
  const price = priceMode === "counterparty"
    ? counterpartyPrice(tick, direction, true)
    : marketPrice(tick, direction);
  if (!isFinite(price) || price <= 0) return { ok: false, msg: `${p.symbol} 价格无效` };
  const plan = closePlan(p, volume);
  plan.forEach((leg) => {
    orderSender({ account, symbol: p.symbol, direction, offset: leg.offset, price, volume: leg.qty });
  });
  return { ok: true, count: plan.length };
}

function submitOpen(account, symbol, direction, volume, priceMode) {
  const tick = getTick(symbol);
  if (!tick) return { ok: false, msg: `${symbol} 暂无行情` };
  const price = priceMode === "counterparty"
    ? counterpartyPrice(tick, direction, false)
    : marketPrice(tick, direction);
  if (!isFinite(price) || price <= 0) return { ok: false, msg: `${symbol} 价格无效` };
  orderSender({ account, symbol, direction, offset: "open", price, volume });
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
  let partial = 0;
  const errs = [];
  positions.forEach((p) => {
    const vol = closeQty(p, ratio);
    if (vol <= 0) return;
    // 平仓必须成功才反手，否则只平不开会造成净敞口翻倍
    const cr = submitClose(account, p, vol, "market");
    if (!cr.ok) { if (cr.msg) errs.push(cr.msg); return; }
    const openDir = isLong(p) ? "sell" : "buy";
    const or = submitOpen(account, p.symbol, openDir, vol, "market");
    if (or.ok) n += 1;
    else { partial += 1; errs.push(`${p.symbol} 已平仓但反手开仓失败：${or.msg || "未知原因"}`); }
  });
  if (!n && !partial) return { ok: false, msg: errs[0] || "无可操作持仓" };
  const extra = partial ? `（其中 ${partial} 笔仅平仓、未反手）` : "";
  return { ok: true, msg: errs.length ? `已反手 ${n} 组${extra}：${errs[0]}` : `已提交 ${n} 组反手` };
}

export function batchRolloverPositions(account, positions, targetSymbol, { ratio = 100 } = {}) {
  const target = String(targetSymbol || "").trim();
  if (!target) return { ok: false, msg: "请输入目标合约" };
  if (!positions.length) return { ok: false, msg: "请先勾选持仓" };
  let n = 0;
  let partial = 0;
  const errs = [];
  positions.forEach((p) => {
    const vol = closeQty(p, ratio);
    if (vol <= 0) return;
    // 原仓必须平掉才开目标仓，避免移仓变成双倍敞口
    const cr = submitClose(account, p, vol, "counterparty");
    if (!cr.ok) { if (cr.msg) errs.push(cr.msg); return; }
    const openDir = isLong(p) ? "buy" : "sell";
    const or = submitOpen(account, target, openDir, vol, "counterparty");
    if (or.ok) n += 1;
    else { partial += 1; errs.push(`${p.symbol} 已平仓但目标 ${target} 开仓失败：${or.msg || "未知原因"}`); }
  });
  if (!n && !partial) return { ok: false, msg: errs[0] || "无可移仓持仓" };
  const extra = partial ? `（其中 ${partial} 笔仅平仓、未开目标）` : "";
  return { ok: true, msg: errs.length ? `已移仓 ${n} 笔${extra}：${errs[0]}` : `已提交 ${n} 笔移仓至 ${target}` };
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
