import "./polyfill.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { esc, fmt, cls } from "../js/util.js";

test("esc 转义 & < > 引号", () => {
  assert.equal(esc('<img src=x onerror=1> & "a" \'b\''),
    "&lt;img src=x onerror=1&gt; &amp; &quot;a&quot; &#39;b&#39;");
  assert.equal(esc(null), "");
  assert.equal(esc(0), "0");
});

test("fmt 千分位与小数位", () => {
  assert.equal(fmt(1234567.891), "1,234,568");
  assert.equal(fmt(1234.5, 2), "1,234.50");
  assert.equal(fmt(0), "0");
  assert.equal(fmt(""), "0");
});

test("cls 涨跌类名", () => {
  assert.equal(cls(3), "up");
  assert.equal(cls(-1), "down");
  assert.equal(cls(0), "up");
});
