import "./polyfill.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { exchangeOf, symbolMeta, addWatchlistSymbol, removeWatchlistSymbol, getWatchlistCodes } from "../js/symbols.js";

test("exchangeOf 大小写无关且交易所判定正确", () => {
  assert.equal(exchangeOf("rb2610"), "SHFE");
  assert.equal(exchangeOf("RB2610"), "SHFE");
  assert.equal(exchangeOf("sc2609"), "INE");
  assert.equal(exchangeOf("SC2609"), "INE");
  assert.equal(exchangeOf("sr609"), "CZCE");
  assert.equal(exchangeOf("SR609"), "CZCE");
  assert.equal(exchangeOf("IF2609"), "CFFEX");
  assert.equal(exchangeOf("au2612"), "SHFE");
  assert.equal(exchangeOf("m2609"), "DCE");
});

test("symbolMeta 目录命中与推断档价", () => {
  const rb = symbolMeta("rb2610");
  assert.equal(rb.name, "螺纹钢");
  assert.equal(rb.dec, 0);
  assert.equal(rb.tick, 1);
  // 目录未收录的 AU 月份按最小变动 0.02 推断（与目录一致）
  assert.equal(symbolMeta("au2701").tick, 0.02);
  assert.equal(symbolMeta("SC2701").tick, 0.1);
  assert.equal(symbolMeta("i2701").tick, 0.5);
  assert.equal(symbolMeta("cu2701").tick, 10);
  assert.equal(symbolMeta("IF2701").tick, 0.2);
  // 非法格式
  assert.equal(symbolMeta("not-a-code"), null);
});

test("自选增删链", () => {
  localStorage.clear();
  const base = getWatchlistCodes();
  const added = addWatchlistSymbol("rb2611");
  assert.equal(added.ok, true);
  assert.ok(added.codes.includes("rb2611"));
  // 重复添加拒绝
  assert.equal(addWatchlistSymbol("rb2611").ok, false);
  // 非法格式拒绝
  assert.equal(addWatchlistSymbol("hello world").ok, false);
  const removed = removeWatchlistSymbol("rb2611");
  assert.equal(removed.ok, true);
  assert.ok(!removed.codes.includes("rb2611"));
  assert.equal(base.length > 0, true);
});
