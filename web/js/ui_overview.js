/**
 * ui_overview.js — 多账户概览页渲染。
 */
import { store, totals, symbolSummary, emit } from "./store.js";

const fmt = (v, d = 0) => Number(v || 0).toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d });
const cls = (v) => (v >= 0 ? "up" : "down");

export function renderOverview() {
  const t = totals();

  // 4 大数字
  document.getElementById("ov-stats").innerHTML = `
    <div class="stat-card"><span>总权益</span><b class="${cls(t.equity)}">${fmt(t.equity)}</b></div>
    <div class="stat-card"><span>可用资金</span><b>${fmt(t.avail)}</b></div>
    <div class="stat-card"><span>浮动盈亏</span><b class="${cls(t.float)}">${t.float >= 0 ? "+" : ""}${fmt(t.float)}</b></div>
    <div class="stat-card"><span>占用保证金</span><b>${fmt(t.margin)}</b></div>`;

  // 账户列表
  const list = store.accounts;
  let rows = "";
  list.forEach((acc) => {
    const b = store.balances[acc];
    const st = store.login[acc];
    const stMap = { ok: "已登录", connecting: "连接中", disconnected: "已断开", closed: "未连接" };
    const stBadge = `<span class="badge ${st === "ok" ? "b-ok" : "b-wait"}">${stMap[st] || "未连接"}</span>`;
    if (b) {
      const fpnl = (b.position_profit || 0) + (b.close_profit || 0);
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

  // 按品种汇总
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
  document.getElementById("sum-body").innerHTML = srows;
  document.getElementById("sum-empty").style.display = sums.length ? "none" : "block";

  document.getElementById("roadmap").innerHTML =
    `<b>连接状态 →</b> 网关 ${store.conn === "open" ? "已连接" : "未连接"} · ${store.accounts.length} 个账户 ·
     行情/持仓/委托实时来自本地 CTP(SimNow) 网关。`;

  emit({ type: "ui", view: "overview" });
}