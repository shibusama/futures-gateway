/** esc(v) — 将任意值作为 HTML 文本/属性安全输出。数字与固定常量可不用。 */
export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

/** 千分位数字格式化（各 UI 模块共用的同一实现，避免多处复制） */
export const fmt = (v, d = 0) => Number(v || 0).toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d });

/** 涨/跌颜色类名 */
export const cls = (v) => (v >= 0 ? "up" : "down");
