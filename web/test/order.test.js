import "./polyfill.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { store } from "../js/store.js";
import {
  resolveOffset,
  counterpartyPrice,
  marketPrice,
  orderPrice,
  orderActionLabel,
  batchClosePositions,
  batchReversePositions,
  batchRolloverPositions,
  defaultRolloverTarget,
  __setOrderSender,
} from "../js/order.js";

let sent = [];

beforeEach(() => {
  sent.length = 0;
  store.accounts = [];
  store.positions = {};
  store.lastTicks = {};
  store.ticks = {};
  store.tradeCloseRatio = 100;
  __setOrderSender((o) => sent.push(o));
});

function tick(sym, price) {
  const t = { symbol: sym, price, bid1: price - 5, ask1: price + 5, _ts: Date.now() };
  store.ticks[sym] = t;
  store.lastTicks[sym] = t;
}

const POS = (over) => ({
  symbol: "rb2610", direction: "Long", volume: 10, avail: 8,
  today_volume: 4, yd_volume: 6, today_frozen: 1, yd_frozen: 1,
  open_price: 3500, margin: 1000, position_profit: 0, close_profit: 0,
  exchange: "SHFE", ...over,
});

test("resolveOffset 自动开平按持仓方向", () => {
  store.positions.a = [{ symbol: "rb2610", direction: "Long", avail: 3 }];
  assert.equal(resolveOffset("a", "rb2610", "sell", "auto"), "close");
  assert.equal(resolveOffset("a", "rb2610", "buy", "auto"), "open");
  assert.equal(resolveOffset("a", "rb2610", "buy", "open"), "open");
  assert.equal(resolveOffset("a", "rb2610", "sell", "close"), "close");
  // 无可平 → open
  store.positions.a = [{ symbol: "rb2610", direction: "Long", avail: 0 }];
  assert.equal(resolveOffset("a", "rb2610", "sell", "auto"), "open");
});

test("对价/市价取价：卖看买一、买看卖一", () => {
  const t = { price: 3500, bid1: 3490, ask1: 3510 };
  assert.equal(counterpartyPrice(t, "sell", true), 3490);
  assert.equal(counterpartyPrice(t, "buy", true), 3510);
  assert.equal(marketPrice(t, "sell"), 3490);
  assert.equal(orderPrice(t, "sell", "market", ""), 3490);
});

test("orderActionLabel 文案", () => {
  assert.equal(orderActionLabel("buy", "open"), "买入开多");
  assert.equal(orderActionLabel("sell", "close"), "卖出平多");
  assert.equal(orderActionLabel("buy", "close"), "买入平空");
});

test("SHFE 今昨混仓平仓拆成 平昨+平今 两单", () => {
  tick("rb2610", 3500);
  const p = POS({});
  const r = batchClosePositions("a", [p], { ratio: 100, priceMode: "counterparty" });
  assert.equal(r.ok, true);
  assert.equal(sent.length, 2);
  // avail=8 = 今3(4-1) + 昨5(6-1)；发送对象键为 volume（与 sendOrder 一致）
  assert.equal(sent[0].offset, "close"); // 平昨 5
  assert.equal(sent[0].volume, 5);
  assert.equal(sent[1].offset, "close_today"); // 平今 3
  assert.equal(sent[1].volume, 3);
  // 卖出平多 → 对价用买一
  assert.equal(sent[0].direction, "sell");
  assert.equal(sent[0].price, 3495);
});

test("反手：平仓失败(无行情)则不开新仓", () => {
  const p = POS({ symbol: "cu9999", exchange: "DCE", volume: 1, avail: 1 });
  const r = batchReversePositions("a", [p], { ratio: 100 });
  assert.equal(r.ok, false);
  assert.equal(sent.length, 0);
});

test("反手成功：先平后开、方向相反", () => {
  tick("rb2610", 3500);
  const p = POS({ exchange: "DCE", today_volume: 0, yd_volume: 1, today_frozen: 0, yd_frozen: 0, avail: 1, volume: 1 });
  const r = batchReversePositions("a", [p], { ratio: 100 });
  assert.equal(r.ok, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].offset, "close");
  assert.equal(sent[0].direction, "sell");
  assert.equal(sent[1].offset, "open");
  assert.equal(sent[1].direction, "sell"); // 平多后开空
});

test("移仓：平仓失败则不开目标仓", () => {
  const p = POS({ symbol: "cu9999", exchange: "DCE", volume: 1, avail: 1 });
  const r = batchRolloverPositions("a", [p], "cu2612", { ratio: 100 });
  assert.equal(r.ok, false);
  assert.equal(sent.length, 0);
});

test("defaultRolloverTarget 取首腿顺延月", () => {
  assert.equal(defaultRolloverTarget([POS({ symbol: "rb2610" })]), "rb2611");
});
