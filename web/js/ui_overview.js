/**
 * ui_overview.js — 多账户概览页渲染。
 */
import { store, totals, symbolSummary, accountSummary, loginBadge, acctFloat, emit } from "./store.js";

const fmt = (v, d = 0) => Number(v || 0).toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d });
const cls = (v) => (v >= 0 ? "up" : "down");

export function renderOverview() {
  const t = totals();
  const equityText = t.hasBalance ? fmt(t.equity) : "—";
  const availText = t.hasBalance ? fmt(t.avail) : "—";
  const floatText = t.hasBalance ? `${t.float >= 0 ? "+" : ""}${fmt(t.float)}` : "—";
  const marginText = t.hasBalance ? fmt(t.margin) : "—";

  // 4 大数字
  document.getElementById("ov-stats").innerHTML = `
    <div class="stat-card"><span>总权益</span><b class="${t.hasBalance ? cls(t.equity) : ""}">${equityText}</b></div>
    <div class="stat-card"><span>可用资金</span><b>${availText}</b></div>
    <div class="stat-card"><span>浮动盈亏</span><b class="${t.hasBalance ? cls(t.float) : ""}">${floatText}</b></div>
    <div class="stat-card"><span>占用保证金</span><b>${marginText}</b></div>`;

  // 账户列表
  const list = store.accounts;
  let rows = "";
  list.forEach((acc) => {
    const b = store.balances[acc];
    const st = store.login[acc];
    const badge = loginBadge(st, !!b);
    const stBadge = `<span class="badge ${badge.ok ? "b-ok" : "b-wait"}">${badge.text}</span>`;
    if (b) {
      const fpnl = acctFloat(acc);
      rows += `<tr class="row-click" data-acct="${acc}">
        <td>${acc}</td><td class="tab">${b.account || "—"}</td><td>SimNow</td>
        <td>${stBadge}</td>
        <td class="tab">${fmt(b.balance)}</td>
        <td class="tab">${fmt(b.available)}</td>
        <td class="tab ${cls(fpnl)}">${fpnl >= 0 ? "+" : ""}${fmt(fpnl)}</td>
        <td class="tab">${fmt(b.margin)}</td>
        <td><button class="close-btn" data-view="${acc}">查看</button></td></tr>`;
    } else {
      rows += `<tr class="row-click" data-acct="${acc}">
        <td>${acc}</td><td class="tab">—</td><td>SimNow</td>
        <td>${stBadge}</td>
        <td class="tab">—</td><td class="tab">—</td><td class="tab">—</td><td class="tab">—</td>
        <td><button class="close-btn" data-view="${acc}">查看</button></td></tr>`;
    }
  });
  document.getElementById("acct-list").innerHTML = rows;
  document.getElementById("acct-empty").style.display = list.length ? "none" : "block";

  // 汇总区 Tab
  const bySymbol = store.sumTab === "symbol";
  document.getElementById("sum-tab-symbol").className = "bt" + (bySymbol ? " active" : "");
  document.getElementById("sum-tab-account").className = "bt" + (!bySymbol ? " active" : "");
  document.getElementById("sum-hint").textContent = bySymbol ? "（跨账户合并）" : "（单账户持仓汇总）";
  document.getElementById("sum-table-symbol").style.display = bySymbol ? "block" : "none";
  document.getElementById("sum-table-account").style.display = bySymbol ? "none" : "block";

  if (bySymbol) {
    const sums = symbolSummary();
    let srows = "";
    sums.forEach((m) => {
      const net = m.long - m.short;
      srows += `<tr>
        <td>${m.symbol}</td>
        <td class="tab">${m.long}</td>
        <td class="tab">${m.short}</td>
        <td class="tab ${cls(net) === "down" && net < 0 ? "down" : "up"}">${net}</td>
        <td class="tab ${cls(m.pnl)}">${m.pnl >= 0 ? "+" : ""}${fmt(m.pnl)}</td></tr>`;
    });
    document.getElementById("sum-body-symbol").innerHTML = srows;
    document.getElementById("sum-empty").style.display = sums.length ? "none" : "block";
  } else {
    const accts = accountSummary();
    let arows = "";
    accts.forEach((a) => {
      const net = a.long - a.short;
      arows += `<tr class="row-click" data-acct="${a.account}">
        <td>${a.account}</td>
        <td class="tab">${a.long}</td>
        <td class="tab">${a.short}</td>
        <td class="tab ${cls(net) === "down" && net < 0 ? "down" : "up"}">${net}</td>
        <td class="tab">${fmt(a.margin)}</td>
        <td class="tab ${cls(a.pnl)}">${a.pnl >= 0 ? "+" : ""}${fmt(a.pnl)}</td></tr>`;
    });
    document.getElementById("sum-body-account").innerHTML = arows;
    const hasPos = accts.some((a) => a.long || a.short || a.pnl || a.margin);
    document.getElementById("sum-empty").style.display = hasPos ? "none" : "block";
  }

  document.getElementById("roadmap").innerHTML =
    store.conn === "offline"
      ? `<b>UI 对比模式 →</b> 未连接 Python 网关 · 演示数据 · 布局与线上一致，仅供界面对照。`
      : `<b>连接状态 →</b> 网关 ${store.conn === "open" ? "已连接" : "未连接"} · ${store.accounts.length} 个账户 ·
         行情/持仓/委托实时来自本地 CTP(SimNow) 网关。`;

  emit({ type: "ui", view: "overview" });
}