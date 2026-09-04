import "./polyfill.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  store,
  positionLivePnl,
  contractMult,
  acctFloat,
  totals,
  tickIsLive,
  mergeLoginStatus,
  pxOf,
} from "../js/store.js";

beforeEach(() => {
  store.accounts = [];
  store.positions = {};
  store.trades = {};
  store.balances = {};
  store.ticks = {};
  store.lastTicks = {};
});

function seed(sym, price) {
  const now = Date.now();
  store.ticks[sym] = { symbol: sym, price, _ts: now, pre_close: price - 10 };
  store.lastTicks[sym] = store.ticks[sym];
}

test("contractMult 品种乘数与缺省", () => {
  assert.equal(contractMult("rb2610"), 10);
  assert.equal(contractMult("HC2610"), 10);
  assert.equal(contractMult("IF2609"), 300);
  assert.equal(contractMult("au2612"), 1000);
  assert.equal(contractMult("zz9999"), 10);
});

test("positionLivePnl 多头/空头与无行情回退", () => {
  seed("rb2610", 3600);
  assert.equal(positionLivePnl({ symbol: "rb2610", direction: "Long", volume: 2, open_price: 3500 }), 2000);
  // 空头开 3800、现价 3600（跌）→ 盈利 +4000
  assert.equal(positionLivePnl({ symbol: "rb2610", direction: "Short", volume: 2, open_price: 3800 }), 4000);
  assert.equal(positionLivePnl({ symbol: "cu1111", direction: "Long", volume: 1, position_profit: 123 }), 123);
});

test("pxOf / acctFloat 累加平仓盈亏", () => {
  seed("rb2610", 3600);
  store.accounts = ["a"];
  store.positions.a = [{ symbol: "rb2610", direction: "Long", volume: 1, open_price: 3500 }];
  store.balances.a = { close_profit: 500 };
  assert.equal(pxOf("rb2610"), 3600);
  // 浮动 1000 + 已平 500
  assert.equal(acctFloat("a"), 1500);
});

test("totals 权益/可用剥离网关已算浮盈", () => {
  store.accounts = ["a"];
  store.positions.a = [];
  store.balances.a = { balance: 10000, available: 5000, margin: 3000, position_profit: 100, close_profit: 0 };
  const t = totals();
  assert.ok(t.hasBalance);
  assert.equal(t.float, 0);
  assert.equal(t.equity, 9900);
  assert.equal(t.avail, 4900);
  assert.equal(t.margin, 3000);
});

test("tickIsLive 时效判定", () => {
  store.ticks.rb2610 = { symbol: "rb2610", price: 1, _ts: Date.now() };
  assert.equal(tickIsLive("rb2610"), true);
  store.ticks.rb2610 = { symbol: "rb2610", price: 1, _ts: Date.now() - 180000 };
  assert.equal(tickIsLive("rb2610"), false);
  assert.equal(tickIsLive("cu1111"), false);
});

test("mergeLoginStatus 交易 ok 不被行情 md_ok 覆盖", () => {
  assert.equal(mergeLoginStatus("ok", "md_ok"), "ok");
  assert.equal(mergeLoginStatus(undefined, "ok"), "ok");
  assert.equal(mergeLoginStatus("fail", "connecting"), "connecting");
});
