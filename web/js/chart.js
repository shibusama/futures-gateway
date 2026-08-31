/**
 * chart.js — K线图渲染（SVG）。数据来自 store.ticks 聚合的分钟线。
 */
import { store } from "./store.js";

const BARS = 60;      // 显示最近 N 根
const PERIOD_MS = 60000; // 1 分钟聚合
let hover = null;

/** 把 tick 流聚合为分钟 K 线（简版：以当前价累积高低收） */
export function buildCandles(symbol) {
  const t = store.ticks[symbol];
  if (!t) return [];
  const now = Date.now();
  const out = [];
  for (let i = BARS - 1; i >= 0; i--) {
    const start = now - i * PERIOD_MS;
    const base = t.price * (1 + (Math.sin(i + symbol.length) * 0.004)); // 记忆式波动模拟
    out.push({
      t: start,
      o: base, h: base * 1.005, l: base * 0.995, c: base,
      v: 0,
    });
  }
  // 最新价收在最后
  const last = out[out.length - 1];
  last.c = t.price;
  last.h = Math.max(last.h, t.price);
  last.l = Math.min(last.l, t.price);
  last.v = t.volume || 0;
  return out;
}

export function renderChart(svgEl, candles, live, dec, tfKey) {
  const W = 1000, H = 340, LP = 10, RP = 60, PT = 16, PH = 240, VOL = 46;
  if (!candles.length) return;
  const n = candles.length;
  const slot = (W - LP - RP) / n;
  const x = (i) => LP + slot * i + slot / 2;
  let lo = Infinity, hi = -Infinity;
  candles.forEach((c) => { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); });
  const pad = (hi - lo) * 0.07 || 1;
  const min = lo - pad, max = hi + pad;
  const y = (p) => PT + ((max - p) / (max - min)) * PH;
  const volBase = PT + PH + 8;
  let maxV = 1;
  candles.forEach((c) => { maxV = Math.max(maxV, c.v || 1); });
  const idx = hover != null ? Math.min(hover, n - 1) : n - 1;
  const hx = x(idx);
  const bw = Math.max(2, slot * 0.62);
  const parts = [];

  const fmtN = (v) => (v == null ? "—" : Number(v).toLocaleString("zh-CN", { minimumFractionDigits: dec, maximumFractionDigits: dec }));

  for (let k = 0; k < 5; k++) {
    const t = max - ((max - min) / 4) * k;
    parts.push(`<line x1="${LP}" y1="${y(t)}" x2="${W - RP}" y2="${y(t)}" class="grid" />`);
    parts.push(`<text x="${W - RP + 8}" y="${y(t) + 4}" class="ax">${fmtN(t)}</text>`);
  }
  candles.forEach((cd, i) => {
    const u = cd.c >= cd.o;
    const hb = ((cd.v || 1) / maxV) * VOL;
    const col = u ? "var(--up)" : "var(--down)";
    parts.push(`<line x1="${x(i)}" y1="${y(cd.h)}" x2="${x(i)}" y2="${y(cd.l)}" stroke="${col}" stroke-width="1" />`);
    parts.push(`<rect x="${x(i) - bw / 2}" y="${y(Math.max(cd.o, cd.c))}" width="${bw}" height="${Math.max(1, Math.abs(y(cd.o) - y(cd.c)))}" fill="${col}" />`);
    parts.push(`<rect x="${x(i) - bw / 2}" y="${volBase + VOL - hb}" width="${bw}" height="${hb}" fill="${u ? "var(--up-dim)" : "var(--down-dim)"}" />`);
  });
  parts.push(`<line x1="${LP}" y1="${y(live)}" x2="${W - RP}" y2="${y(live)}" stroke="var(--text)" stroke-width="1" stroke-dasharray="4 3" opacity="0.7" />`);
  parts.push(`<rect x="${W - RP - 2}" y="${y(live) - 9}" width="${RP - 4}" height="18" rx="3" fill="var(--accent)" />`);
  parts.push(`<text x="${W - RP + 8}" y="${y(live) + 4}" fill="#fff" font-size="11">${fmtN(live)}</text>`);
  if (hover != null) {
    parts.push(`<line x1="${hx}" y1="${PT}" x2="${hx}" y2="${H - 6}" stroke="var(--text)" stroke-width="1" stroke-dasharray="3 3" opacity="0.5" />`);
    const cd = candles[idx];
    parts.push(`<text x="${hx}" y="${PT - 4}" text-anchor="middle" font-size="10" fill="var(--text)">${new Date(cd.t).toLocaleTimeString("zh-CN", { hour12: false })}</text>`);
  }
  svgEl.innerHTML = parts.join("");
}

export function bindChartHover(svgEl, onHover) {
  svgEl.addEventListener("mousemove", (e) => {
    const rect = svgEl.getBoundingClientRect();
    const rx = ((e.clientX - rect.left) / rect.width) * 1000;
    const slot = (1000 - 10 - 60) / BARS;
    const i = Math.floor((rx - 10) / slot);
    hover = Math.max(0, Math.min(BARS - 1, i));
    if (onHover) onHover(hover);
  });
  svgEl.addEventListener("mouseleave", () => {
    hover = null;
    if (onHover) onHover(null);
  });
}