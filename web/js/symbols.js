/**
 * symbols.js — 合约元数据、自选列表（localStorage）、交易所推断。
 */
const WATCHLIST_KEY = "fg_watchlist";

/** 常用合约目录（SimNow 主力月；换月时可在此更新默认值） */
export const SYMBOL_CATALOG = [
  { code: "rb2610", name: "螺纹钢", dec: 0, tick: 1 },
  { code: "cu2611", name: "沪铜", dec: 0, tick: 10 },
  { code: "au2612", name: "沪金", dec: 1, tick: 0.02 },
  { code: "ag2612", name: "沪银", dec: 0, tick: 1 },
  { code: "sc2609", name: "原油", dec: 1, tick: 0.1 },
  { code: "IF2609", name: "沪深300", dec: 1, tick: 0.2 },
  { code: "m2609", name: "豆粕", dec: 0, tick: 1 },
  { code: "i2609", name: "铁矿石", dec: 1, tick: 0.5 },
  { code: "hc2610", name: "热卷", dec: 0, tick: 1 },
  { code: "al2611", name: "沪铝", dec: 0, tick: 5 },
  { code: "zn2611", name: "沪锌", dec: 0, tick: 5 },
  { code: "ni2611", name: "沪镍", dec: 0, tick: 10 },
  { code: "sn2611", name: "沪锡", dec: 0, tick: 10 },
  { code: "fu2609", name: "燃油", dec: 0, tick: 1 },
  { code: "ru2609", name: "橡胶", dec: 0, tick: 5 },
  { code: "p2609", name: "棕榈油", dec: 0, tick: 2 },
  { code: "y2609", name: "豆油", dec: 0, tick: 2 },
  { code: "c2609", name: "玉米", dec: 0, tick: 1 },
  { code: "SR609", name: "白糖", dec: 0, tick: 1 },
  { code: "TA609", name: "PTA", dec: 0, tick: 2 },
  { code: "MA609", name: "甲醇", dec: 0, tick: 1 },
  { code: "FG609", name: "玻璃", dec: 0, tick: 1 },
  { code: "AP610", name: "苹果", dec: 0, tick: 1 },
  { code: "CF609", name: "棉花", dec: 0, tick: 5 },
];

const PRODUCT_NAMES = {
  RB: "螺纹钢", HC: "热卷", I: "铁矿石", J: "焦炭", JM: "焦煤",
  CU: "沪铜", AL: "沪铝", ZN: "沪锌", NI: "沪镍", SN: "沪锡", AU: "沪金", AG: "沪银",
  SC: "原油", FU: "燃油", RU: "橡胶", BU: "沥青",
  IF: "沪深300", IH: "上证50", IC: "中证500", IM: "中证1000",
  M: "豆粕", Y: "豆油", P: "棕榈油", C: "玉米", A: "豆一", B: "豆二",
  SR: "白糖", CF: "棉花", TA: "PTA", MA: "甲醇", FG: "玻璃", AP: "苹果", CJ: "红枣",
};

const DEFAULT_CODES = SYMBOL_CATALOG.slice(0, 8).map((s) => s.code);

function normCode(raw) {
  const c = String(raw || "").trim();
  if (!c) return "";
  const m = c.match(/^([a-zA-Z]+)(\d+)$/);
  if (!m) return "";
  return m[1] + m[2];
}

function loadCodes() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (!raw) return [...DEFAULT_CODES];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || !arr.length) return [...DEFAULT_CODES];
    return arr.map(normCode).filter(Boolean);
  } catch (_) {
    return [...DEFAULT_CODES];
  }
}

function saveCodes(codes) {
  const uniq = [];
  codes.forEach((c) => {
    const n = normCode(c);
    if (n && !uniq.includes(n)) uniq.push(n);
  });
  if (!uniq.length) uniq.push(DEFAULT_CODES[0]);
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(uniq));
  return uniq;
}

/** 根据合约代码推断交易所（与 gateway/ctp.py 保持一致） */
export function exchangeOf(symbol) {
  const s = String(symbol || "");
  if (s.startsWith("IF") || s.startsWith("IH") || s.startsWith("IC") || s.startsWith("IM")) return "CFFEX";
  if (s.startsWith("sc") || s.startsWith("lu") || s.startsWith("ec") || s.startsWith("nr")) return "INE";
  if (/^(au|ag|cu|rb|al|zn|ni|sn|pb|ss|fu|ru|bu|sp|ao|bc|br|wr)/i.test(s)) return "SHFE";
  if (/^(m|y|p|a|b|c|cs|jd|lh|rr|l|v|pp|eb|eg|pg|fb|bb|i|j|jm|qh)/i.test(s)) return "DCE";
  if (/^(SR|CF|TA|MA|FG|ZC|SA|UR|PK|AP|CJ|SF|SM|CY|PF|SH|PX)/.test(s)) return "CZCE";
  return "SHFE";
}

function inferDecTick(prod) {
  const p = prod.toUpperCase();
  if (["IF", "IH", "IC", "IM"].includes(p)) return { dec: 1, tick: 0.2 };
  if (["AU", "SC"].includes(p)) return { dec: 1, tick: 0.1 };
  if (["I", "JM"].includes(p)) return { dec: 1, tick: 0.5 };
  if (["CU", "AL", "ZN"].includes(p)) return { dec: 0, tick: 10 };
  if (["NI", "SN"].includes(p)) return { dec: 0, tick: 10 };
  if (["P", "Y", "TA"].includes(p)) return { dec: 0, tick: 2 };
  if (["CF"].includes(p)) return { dec: 0, tick: 5 };
  return { dec: 0, tick: 1 };
}

/** 查找或推断合约元数据 */
export function symbolMeta(code) {
  const n = normCode(code);
  if (!n) return null;
  const hit = SYMBOL_CATALOG.find((s) => s.code.toLowerCase() === n.toLowerCase());
  if (hit) return { ...hit, code: n };
  const prod = n.replace(/\d+$/, "");
  const { dec, tick } = inferDecTick(prod);
  return { code: n, name: PRODUCT_NAMES[prod.toUpperCase()] || prod.toUpperCase(), dec, tick };
}

/** 当前自选列表（含元数据） */
export function getWatchlist() {
  return loadCodes().map((c) => symbolMeta(c)).filter(Boolean);
}

export function getWatchlistCodes() {
  return loadCodes();
}

/** 添加自选；返回 { ok, msg, codes } */
export function addWatchlistSymbol(raw) {
  const meta = symbolMeta(raw);
  if (!meta) return { ok: false, msg: "合约格式无效，示例：rb2610、IF2609" };
  const codes = loadCodes();
  if (codes.some((c) => c.toLowerCase() === meta.code.toLowerCase())) {
    return { ok: false, msg: `${meta.code} 已在列表中` };
  }
  if (codes.length >= 24) return { ok: false, msg: "自选最多 24 个合约" };
  const next = saveCodes([...codes, meta.code]);
  return { ok: true, msg: `已添加 ${meta.name} ${meta.code}`, codes: next, meta };
}

/** 移除自选；至少保留 1 个 */
export function removeWatchlistSymbol(code) {
  const n = normCode(code);
  const codes = loadCodes();
  if (codes.length <= 1) return { ok: false, msg: "至少保留一个合约" };
  if (!codes.some((c) => c.toLowerCase() === n.toLowerCase())) {
    return { ok: false, msg: "合约不在列表中" };
  }
  const next = saveCodes(codes.filter((c) => c.toLowerCase() !== n.toLowerCase()));
  return { ok: true, codes: next };
}

/** 委托是否可撤（CTP：排队中 / 部分成交排队中） */
export function canCancelOrder(o) {
  return o && (o.status === "3" || o.status === "1");
}
