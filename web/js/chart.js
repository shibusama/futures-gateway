/**
 * chart.js — K 线图（TradingView Lightweight Charts）
 * 标准蜡烛图 + 成交量 + 时间横轴 + 十字光标
 */
import { createChart } from "https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.mjs";
import { store } from "./store.js";
import { historyKey } from "./history.js";

const DISPLAY_SLOTS = 500;
let chart = null;
let candleSeries = null;
let volumeSeries = null;
let containerEl = null;
let resizeObs = null;
let lastTf = null;

/** 从 tick 流聚合实时 K 线 */
function buildLiveCandles(symbol) {
  const hist = store.tickHistory[symbol];
  if (!hist || !hist.length) return [];

  const bucketMs = tfBucketMs(store.tf);
  const buckets = {};
  let prevCumVol = null;

  hist.forEach((t) => {
    const px = t.price;
    if (!px || !isFinite(px) || px <= 0) return;
    const ts = t._ts || Date.now();
    const key = Math.floor(ts / bucketMs) * bucketMs;
    if (!buckets[key]) {
      buckets[key] = { t: key, o: px, h: px, l: px, c: px, v: 0 };
    }
    const b = buckets[key];
    b.h = Math.max(b.h, px);
    b.l = Math.min(b.l, px);
    b.c = px;

    const cum = t.volume || 0;
    if (prevCumVol != null && cum > prevCumVol) {
      b.v += cum - prevCumVol;
    } else if (prevCumVol == null || cum === prevCumVol) {
      b.v += 1;
    }
    prevCumVol = cum;
  });

  return Object.values(buckets).sort((a, b) => a.t - b.t);
}

/** 历史 + 实时合并（同时间桶以实时为准） */
export function buildCandles(symbol) {
  const key = historyKey(symbol, store.tf);
  const history = store.barHistory[key] || [];
  const live = buildLiveCandles(symbol);
  const map = new Map();
  history.forEach((b) => map.set(b.t, { ...b }));
  live.forEach((b) => {
    const prev = map.get(b.t);
    // 同时间桶：历史 K 线优先，仅用实时价更新 close/high/low
    if (prev && store.tf !== "1d") {
      map.set(b.t, {
        ...prev,
        c: b.c,
        h: Math.max(prev.h, b.c),
        l: Math.min(prev.l, b.c),
        v: Math.max(prev.v || 0, b.v || 0),
      });
    } else {
      map.set(b.t, { ...b });
    }
  });
  return Array.from(map.values())
    .sort((a, b) => a.t - b.t)
    .slice(-DISPLAY_SLOTS);
}

function tfBucketMs(tf) {
  if (tf === "5m") return 5 * 60000;
  if (tf === "1d") return 24 * 3600000;
  return 60000;
}

function isDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function chartTheme() {
  const dark = isDark();
  const line = dark ? "#2a3444" : "#e2e6ef";
  const bg = dark ? "#161c26" : "#ffffff";
  const text = dark ? "#8a94a7" : "#6b7486";
  return { dark, line, bg, text };
}

function fmtPrice(v, dec) {
  if (v == null || !isFinite(v)) return "—";
  return Number(v).toLocaleString("zh-CN", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function fmtTimeLabel(time, tf) {
  if (typeof time === "string") return time;
  const d = new Date(time * 1000);
  if (tf === "1d") {
    return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
  }
  return d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function toChartTime(ts, tf) {
  if (tf === "1d") {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return Math.floor(ts / 1000);
}

function ensureChart(el, tfKey) {
  const theme = chartTheme();
  const needRecreate = !chart || containerEl !== el || lastTf !== tfKey;

  if (needRecreate) {
    if (chart) {
      chart.remove();
      chart = null;
    }
    if (resizeObs) {
      resizeObs.disconnect();
      resizeObs = null;
    }

    containerEl = el;
    lastTf = tfKey;
    el.innerHTML = "";

    chart = createChart(el, {
      width: el.clientWidth,
      height: 360,
      layout: {
        background: { color: theme.bg },
        textColor: theme.text,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: theme.line, style: 1 },
        horzLines: { color: theme.line, style: 1 },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: theme.text, width: 1, style: 2, labelBackgroundColor: theme.line },
        horzLine: { color: theme.text, width: 1, style: 2, labelBackgroundColor: "#2f6bff" },
      },
      rightPriceScale: {
        borderColor: theme.line,
        scaleMargins: { top: 0.08, bottom: 0.22 },
      },
      timeScale: {
        borderColor: theme.line,
        timeVisible: true,
        secondsVisible: tfKey === "1m",
        fixLeftEdge: false,
        fixRightEdge: false,
        rightOffset: 4,
        barSpacing: 10,
        minBarSpacing: 4,
      },
      localization: {
        locale: "zh-CN",
        dateFormat: "yyyy-MM-dd",
      },
    });

    candleSeries = chart.addCandlestickSeries({
      upColor: "#e03838",
      downColor: "#129e58",
      borderUpColor: "#e03838",
      borderDownColor: "#129e58",
      wickUpColor: "#e03838",
      wickDownColor: "#129e58",
    });

    volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) return;
      const bar = param.seriesData.get(candleSeries);
      const volBar = param.seriesData.get(volumeSeries);
      if (bar) {
        updateOhlc(
          { ...bar, value: volBar?.value ?? 0 },
          param.time,
          store._chartDec ?? 0,
          store._chartTf ?? "1m",
        );
      }
    });

    resizeObs = new ResizeObserver(() => {
      if (chart && el.clientWidth > 0) {
        chart.applyOptions({ width: el.clientWidth });
      }
    });
    resizeObs.observe(el);
  }

  return { chart, candleSeries, volumeSeries };
}

function updateOhlc(bar, time, dec, tf) {
  const el = document.getElementById("ohlc");
  if (!el || !bar) return;
  el.innerHTML = `
    <span>开 <b>${fmtPrice(bar.open, dec)}</b></span>
    <span>高 <b class="up">${fmtPrice(bar.high, dec)}</b></span>
    <span>低 <b class="down">${fmtPrice(bar.low, dec)}</b></span>
    <span>收 <b>${fmtPrice(bar.close, dec)}</b></span>
    <span>量 <b>${Math.round(bar.value ?? bar.volume ?? 0)}</b></span>
    <span class="ohlc-time">${fmtTimeLabel(time, tf)}</span>`;
}

function dedupeBars(items) {
  const map = new Map();
  items.forEach((item) => map.set(String(item.time), item));
  return Array.from(map.values()).sort((a, b) => {
    const ta = typeof a.time === "number" ? a.time : Date.parse(a.time);
    const tb = typeof b.time === "number" ? b.time : Date.parse(b.time);
    return ta - tb;
  });
}

let lastRenderedKey = null;

/** 仅更新最后一根 K 线（tick 节流用，避免整表 setData） */
export function updateChartLive(el, candles, live, dec, tfKey) {
  if (!el || !candles.length) return;
  store._chartDec = dec;
  store._chartTf = tfKey;
  const key = `${store.sel}_${tfKey}`;
  if (!chart || !candleSeries || !volumeSeries || lastRenderedKey !== key) {
    renderChart(el, candles, live, dec, tfKey);
    return;
  }
  const last = candles[candles.length - 1];
  const time = toChartTime(last.t, tfKey);
  const bar = { time, open: last.o, high: last.h, low: last.l, close: live > 0 ? live : last.c };
  candleSeries.update(bar);
  volumeSeries.update({
    time,
    value: last.v || 0,
    color: bar.close >= bar.open ? "rgba(224, 56, 56, 0.45)" : "rgba(18, 158, 88, 0.45)",
  });
  updateOhlc(
    { open: bar.open, high: bar.high, low: bar.low, close: bar.close, value: last.v },
    time, dec, tfKey,
  );
}

export function renderChart(el, candles, live, dec, tfKey) {
  if (!el) return;
  store._chartDec = dec;
  store._chartTf = tfKey;

  if (!candles.length) {
    el.innerHTML = `<div class="chart-empty">等待行情数据…</div>`;
    document.getElementById("ohlc").textContent = "";
    if (chart) {
      chart.remove();
      chart = null;
    }
    return;
  }

  const { candleSeries: cs, volumeSeries: vs } = ensureChart(el, tfKey);

  const ohlc = dedupeBars(candles.map((c) => ({
    time: toChartTime(c.t, tfKey),
    open: c.o,
    high: c.h,
    low: c.l,
    close: c.c,
  })));

  const vol = dedupeBars(candles.map((c) => ({
    time: toChartTime(c.t, tfKey),
    value: c.v || 0,
    color: c.c >= c.o ? "rgba(224, 56, 56, 0.45)" : "rgba(18, 158, 88, 0.45)",
  })));

  cs.setData(ohlc);
  vs.setData(vol);

  if (live > 0) {
    cs.update({ ...ohlc[ohlc.length - 1], close: live });
  }

  chart.timeScale().fitContent();

  const last = ohlc[ohlc.length - 1];
  updateOhlc(
    { open: last.open, high: last.high, low: last.low, close: live > 0 ? live : last.close, value: vol[vol.length - 1]?.value },
    last.time,
    dec,
    tfKey,
  );
  lastRenderedKey = `${store.sel}_${tfKey}`;
}

/** 兼容 app.js 旧调用，Lightweight Charts 自带十字光标 */
export function bindChartHover(_el, onHover) {
  if (onHover) onHover(null);
}

export function destroyChart() {
  if (resizeObs) resizeObs.disconnect();
  if (chart) chart.remove();
  chart = null;
  candleSeries = null;
  volumeSeries = null;
  containerEl = null;
  lastRenderedKey = null;
}
