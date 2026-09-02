/**
 * chart.js — K 线图（KLineChart，Apache-2.0）
 * 蜡烛 + 成交量副图 + 北京时间 + 红涨绿跌
 */
import { init, dispose } from "./vendor/klinecharts.esm.js";
import { store } from "./store.js";
import { effectiveDark } from "./theme.js";

let chart = null;
let containerEl = null;
let resizeObs = null;
let pushLive = null;
let pendingBars = [];
let lastRenderedKey = null;
let volReady = false;

function fmtPrice(v, dec) {
  if (v == null || !isFinite(v)) return "—";
  return Number(v).toLocaleString("zh-CN", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function fmtStamp(ts, tf) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  if (tf === "1d") {
    return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
  }
  return d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function periodOf(tf) {
  if (tf === "5m") return { span: 5, type: "minute" };
  if (tf === "1d") return { span: 1, type: "day" };
  return { span: 1, type: "minute" };
}

function toBar(c) {
  return {
    timestamp: c.t,
    open: c.o,
    high: c.h,
    low: c.l,
    close: c.c,
    volume: c.v || 0,
  };
}

function withLiveClose(bar, live) {
  if (!(live > 0) || !bar) return bar;
  const cap = Math.max(Math.abs(bar.close) * 0.0015, 1);
  if (Math.abs(live - bar.close) > cap) return bar;
  return {
    ...bar,
    close: live,
    high: Math.max(bar.high, live),
    low: Math.min(bar.low, live),
  };
}

function chartStyles() {
  const dark = effectiveDark();
  const line = dark ? "#2a3444" : "#e2e6ef";
  const bg = dark ? "#161c26" : "#ffffff";
  const text = dark ? "#8a94a7" : "#6b7486";
  const up = "#e03838";
  const down = "#129e58";
  return {
    grid: {
      show: true,
      horizontal: { show: true, color: line, style: "solid", size: 1 },
      vertical: { show: true, color: line, style: "solid", size: 1 },
    },
    candle: {
      type: "candle_solid",
      bar: {
        upColor: up,
        downColor: down,
        noChangeColor: text,
        upBorderColor: up,
        downBorderColor: down,
        noChangeBorderColor: text,
        upWickColor: up,
        downWickColor: down,
        noChangeWickColor: text,
      },
      tooltip: { showRule: "none" },
      priceMark: {
        last: { show: true },
        high: { show: false },
        low: { show: false },
      },
    },
    indicator: {
      tooltip: { showRule: "none" },
    },
    xAxis: {
      axisLine: { color: line },
      tickLine: { color: line },
      tickText: { color: text, size: 11, family: fontFamily() },
    },
    yAxis: {
      axisLine: { color: line },
      tickLine: { color: line },
      tickText: { color: text, size: 11, family: fontFamily() },
    },
    separator: { color: line },
    crosshair: {
      show: true,
      horizontal: { line: { color: "#2f6bff", style: "dashed" } },
      vertical: { line: { color: text, style: "dashed" } },
    },
  };
}

function fontFamily() {
  return '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
}

function formatDate({ timestamp, type }) {
  const tf = store._chartTf || "1m";
  if (tf === "1d") return fmtStamp(timestamp, "1d");
  if (type === "xAxis") return fmtStamp(timestamp, "1m");
  const d = new Date(timestamp);
  return `${d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })} ${fmtStamp(timestamp, "1m")}`;
}

const dataLoader = {
  getBars({ callback }) {
    callback(pendingBars, false);
  },
  subscribeBar({ callback }) {
    pushLive = callback;
  },
  unsubscribeBar() {
    pushLive = null;
  },
};

function ensureChart(el) {
  if (chart && containerEl === el) {
    chart.setStyles(chartStyles());
    return chart;
  }
  teardown();
  containerEl = el;
  el.innerHTML = "";
  chart = init(el, {
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    styles: chartStyles(),
    formatter: { formatDate },
    thousandsSeparator: { sign: "," },
    layout: {
      yAxis: { position: "right", inside: false },
    },
  });
  if (!chart) return null;
  chart.setDataLoader(dataLoader);
  if (!volReady) {
    chart.createIndicator({ name: "VOL", paneId: "pane_vol" });
    chart.setPaneOptions({ id: "pane_vol", height: 78, minHeight: 52 });
    volReady = true;
  }
  chart.setBarSpace(8);
  chart.setOffsetRightDistance(18);
  chart.subscribeAction("onCrosshairChange", (data) => {
    const k = data?.kLineData;
    if (!k) return;
    updateOhlc(k, k.timestamp, store._chartDec ?? 0, store._chartTf || "1m");
  });
  resizeObs = new ResizeObserver(() => {
    if (chart && el.clientWidth > 0) chart.resize();
  });
  resizeObs.observe(el);
  requestAnimationFrame(() => {
    try { chart.resize(); } catch (_) { /* ignore */ }
  });
  return chart;
}

function teardown() {
  if (resizeObs) {
    resizeObs.disconnect();
    resizeObs = null;
  }
  if (chart && containerEl) {
    dispose(containerEl);
  }
  chart = null;
  containerEl = null;
  pushLive = null;
  volReady = false;
}

function updateOhlc(bar, time, dec, tf) {
  const el = document.getElementById("ohlc");
  if (!el || !bar) return;
  el.innerHTML = `
    <span>开 <b>${fmtPrice(bar.open, dec)}</b></span>
    <span>高 <b class="up">${fmtPrice(bar.high, dec)}</b></span>
    <span>低 <b class="down">${fmtPrice(bar.low, dec)}</b></span>
    <span>收 <b>${fmtPrice(bar.close, dec)}</b></span>
    <span>量 <b>${Math.round(bar.volume ?? bar.value ?? 0)}</b></span>
    <span class="ohlc-src">K线·新浪实盘</span>
    <span class="ohlc-time">${fmtStamp(time, tf)}</span>`;
}

function lastPainted(candles, live) {
  const raw = toBar(candles[candles.length - 1]);
  return withLiveClose(raw, live);
}

/** 仅更新最后一根 K 线（tick 节流用） */
export function updateChartLive(el, candles, live, dec, tfKey) {
  if (!el || !candles.length) return;
  store._chartDec = dec;
  store._chartTf = tfKey;
  const key = `${store.sel}_${tfKey}`;
  if (!chart || lastRenderedKey !== key) {
    renderChart(el, candles, live, dec, tfKey);
    return;
  }
  const bar = lastPainted(candles, live);
  if (pushLive) pushLive(bar);
  updateOhlc(bar, bar.timestamp, dec, tfKey);
}

export function renderChart(el, candles, live, dec, tfKey) {
  if (!el) return;
  store._chartDec = dec;
  store._chartTf = tfKey;

  if (!candles.length) {
    teardown();
    el.innerHTML = `<div class="chart-empty">等待行情数据…</div>`;
    const ohlc = document.getElementById("ohlc");
    if (ohlc) ohlc.textContent = "";
    lastRenderedKey = null;
    return;
  }

  pendingBars = candles.map(toBar);
  const last = lastPainted(candles, live);
  pendingBars[pendingBars.length - 1] = last;

  const c = ensureChart(el);
  if (!c) {
    el.innerHTML = `<div class="chart-empty">K 线图加载失败</div>`;
    return;
  }

  const key = `${store.sel}_${tfKey}`;
  if (lastRenderedKey !== key) {
    c.setSymbol({
      ticker: store.sel,
      pricePrecision: dec,
      volumePrecision: 0,
    });
    c.setPeriod(periodOf(tfKey));
    lastRenderedKey = key;
  } else {
    c.resetData();
  }

  updateOhlc(last, last.timestamp, dec, tfKey);
}

/** 兼容 app.js 旧调用 */
export function bindChartHover(_el, onHover) {
  if (onHover) onHover(null);
}

export function destroyChart() {
  teardown();
  lastRenderedKey = null;
  pendingBars = [];
}
