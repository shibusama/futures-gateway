import "./polyfill.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { store } from "../js/store.js";
import {
  closeQty,
  positionKey,
  isLong,
  posDirLabel,
  filterPositions,
  matchPosQuery,
  groupPositionsByProduct,
  positionMarketValue,
  suggestRolloverSymbol,
} from "../js/positions.js";

beforeEach(() => {
  store.positions = {};
  store.lastTicks = {};
  store.ticks = {};
  store.tradePosType = "all";
  store.tradePosExchange = "all";
  store.tradePosQuery = "";
  store.tradeComboType = "all";
  store.tradeStatsType = "all";
  store.tradeStatsExchange = "all";
  store.tradeStatsQuery = "";
});

const P = (over) => ({
  symbol: "rb2610", direction: "Long", volume: 10, avail: 8,
  today_volume: 4, yd_volume: 6, today_frozen: 1, yd_frozen: 1,
  open_price: 3500, margin: 1000, position_profit: 0, close_profit: 0, ...over,
});

test("closeQty：可平 0 不得回退总仓", () => {
  assert.equal(closeQty(P({ avail: 0, volume: 10 }), 100), 0);
  assert.equal(closeQty(P({ avail: 0, volume: 10 }), 50), 0);
  // 缺字段时回退 volume
  const noAvail = P({ volume: 5 });
  delete noAvail.avail;
  assert.equal(closeQty(noAvail, 100), 5);
});

test("closeQty 比例舍入语义", () => {
  assert.equal(closeQty(P({ avail: 8 }), 100), 8);
  assert.equal(closeQty(P({ avail: 8 }), 50), 4);
  assert.equal(closeQty(P({ avail: 3 }), 25), 1); // floor0.75→兜底1
  assert.equal(closeQty(P({ avail: 0 }), 25), 0);
});

test("positionKey/isLong/posDirLabel", () => {
  const p = P({ direction: "Long" });
  assert.equal(positionKey(p), "rb2610_Long");
  assert.equal(isLong(p), true);
  assert.equal(posDirLabel(p), "买");
  assert.equal(posDirLabel(P({ direction: "Short" })), "卖");
});

test("filterPositions 按方向/交易所/关键字", () => {
  const rows = [P({}), P({ symbol: "rb2610", direction: "Short" }), P({ symbol: "cu2611", direction: "Long" })];
  store.tradePosType = "long";
  assert.equal(filterPositions(rows).length, 2);
  store.tradePosType = "short";
  assert.equal(filterPositions(rows).length, 1);
  store.tradePosType = "all";
  store.tradePosExchange = "SHFE";
  assert.equal(filterPositions(rows).length, 3);
  store.tradePosExchange = "DCE";
  assert.equal(filterPositions(rows).length, 0);
  store.tradePosExchange = "all";
  store.tradePosQuery = "rb";
  assert.equal(filterPositions(rows).length, 2);
});

test("matchPosQuery 支持品种/合约/名称", () => {
  assert.equal(matchPosQuery(P({ symbol: "rb2610" }), "RB"), true);
  assert.equal(matchPosQuery(P({ symbol: "rb2610" }), "cu"), false);
  assert.equal(matchPosQuery(P({ symbol: "cu2611" }), "沪铜"), true);
});

test("groupPositionsByProduct 汇总多合约同方向", () => {
  const rows = [
    P({ symbol: "rb2610", volume: 4, today_volume: 2, yd_volume: 2, margin: 400 }),
    P({ symbol: "rb2609", volume: 6, today_volume: 0, yd_volume: 6, margin: 600 }),
  ];
  const g = groupPositionsByProduct(rows);
  assert.equal(g.length, 1);
  assert.equal(g[0].product, "RB");
  assert.equal(g[0].volume, 10);
  assert.equal(g[0].margin, 1000);
});

test("positionMarketValue 用实时价*乘数", () => {
  store.lastTicks.rb2610 = { price: 3600, _ts: Date.now() };
  assert.equal(positionMarketValue(P({ volume: 2 })), 3600 * 2 * 10);
  // 无行情 → 0
  assert.equal(positionMarketValue(P({ symbol: "zz9999", volume: 2 })), 0);
});

test("suggestRolloverSymbol 顺延主力月（跨年）", () => {
  assert.equal(suggestRolloverSymbol("rb2610"), "rb2611");
  assert.equal(suggestRolloverSymbol("rb2612"), "rb2701");
  assert.equal(suggestRolloverSymbol("IF2609"), "IF2610");
  assert.equal(suggestRolloverSymbol("bad-sym"), "");
});
