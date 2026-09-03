/**
 * boot.js — 启动登录进度：CTP 交易登录成功后才进入主界面。
 */
const POLL_MS = 400;
const TIMEOUT_MS = 60000;
const WAIT_HINT_MS = 8000;

let entered = false;
let startedAt = Date.now();
let readySince = 0;
let pollTimer = null;
let waitHintShown = false;

function $(id) {
  return document.getElementById(id);
}

function setStatus(text, kind) {
  const el = $("status");
  if (!el) return;
  el.textContent = text || "";
  el.className = "status" + (kind ? " " + kind : "");
}

function setStep(id, state) {
  const el = document.querySelector(`.step[data-step="${id}"]`);
  if (!el) return;
  el.classList.remove("pending", "active", "done", "error");
  el.classList.add(state);
  const mark = el.querySelector(".mark");
  if (mark) {
    mark.textContent = state === "done" ? "✓" : state === "error" ? "!" : state === "active" ? "●" : "○";
  }
}

function showSpinner(show) {
  const el = $("spinner");
  if (el) el.hidden = !show;
}

function mainHref(path = "/") {
  if (location.protocol.startsWith("http")) return `${location.origin}${path}`;
  return `http://127.0.0.1:8765${path}`;
}

async function waitApi(timeoutMs = 2500) {
  if (window.pywebview && window.pywebview.api) return window.pywebview.api;
  return await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    window.addEventListener("pywebviewready", () => {
      clearTimeout(timer);
      resolve(window.pywebview ? window.pywebview.api : null);
    }, { once: true });
  });
}

async function enterMain() {
  if (entered) return;
  entered = true;
  clearInterval(pollTimer);
  setStep("funds", "done");
  setStatus("登录成功，正在进入交易界面…", "ok");
  showSpinner(false);
  const api = await waitApi(800);
  if (api && typeof api.enter_main === "function") {
    try { await api.enter_main(); } catch (_) { /* ignore */ }
  }
  location.replace(mainHref("/"));
}

async function enterBrowseMode() {
  if (entered) return;
  entered = true;
  clearInterval(pollTimer);
  showSpinner(false);
  setStatus("正在进入界面（SimNow 仍在后台登录）…", "ok");
  const api = await waitApi(800);
  if (api && typeof api.enter_main === "function") {
    try { await api.enter_main(); } catch (_) { /* ignore */ }
  }
  location.replace(mainHref("/"));
}

function applyStatus(data) {
  const accounts = data.accounts || [];
  const first = accounts[0] || {};
  const failedAcc = accounts.find((a) => a.login === "fail") || null;
  const login = first.login;
  const msg = (failedAcc || first).msg || "";
  const name = (failedAcc || first).name || "账户";

  setStep("gateway", "done");

  if (!accounts.length) {
    setStep("front", "active");
    setStep("login", "pending");
    setStep("funds", "pending");
    setStatus("正在启动交易通道…");
    return "wait";
  }

  if (data.failed || login === "fail") {
    setStep("front", "done");
    setStep("login", "error");
    setStep("funds", "pending");
    setStatus(msg || `${name} 登录失败`, "err");
    return "fail";
  }

  if (data.ready) {
    setStep("front", "done");
    setStep("login", "done");
    if (accounts.every((a) => a.has_balance)) {
      setStep("funds", "done");
      setStatus("登录成功，资金已同步", "ok");
    } else {
      setStep("funds", "active");
      setStatus("登录成功，正在同步资金…", "ok");
    }
    return "ready";
  }

  if (login === "connecting" || login === "md_ok") {
    const frontDone = /前置已连接|认证|登录/.test(msg);
    setStep("front", frontDone || login === "md_ok" ? "done" : "active");
    setStep("login", "active");
    setStep("funds", "pending");
    setStatus(msg || `${name} 正在登录 SimNow…`);
    return "wait";
  }

  setStep("front", "active");
  setStep("login", "pending");
  setStep("funds", "pending");
  setStatus(msg || "正在连接 SimNow 前置…");
  return "wait";
}

function maybeShowWaitHint() {
  if (waitHintShown || entered) return;
  if (Date.now() - startedAt < WAIT_HINT_MS) return;
  waitHintShown = true;
  const el = $("status");
  if (!el || el.classList.contains("err") || el.classList.contains("ok")) return;
  const base = el.textContent || "正在登录 SimNow…";
  if (!base.includes("账号配置")) {
    setStatus(`${base}（等待较久时可点「账号配置」或「进入界面」）`);
  }
}

async function poll() {
  if (entered) return;
  maybeShowWaitHint();
  try {
    const res = await fetch("/api/boot-status");
    if (!res.ok) throw new Error("boot-status " + res.status);
    const data = await res.json();
    const phase = applyStatus(data);
    if (phase === "ready") {
      if (!readySince) readySince = Date.now();
      const fundsReady = (data.accounts || []).every((a) => a.has_balance);
      if (fundsReady || Date.now() - readySince > 2500) {
        enterMain();
      }
      return;
    }
    readySince = 0;
    if (phase === "fail") {
      showSpinner(false);
      return;
    }
  } catch (_) {
    setStatus("正在等待本地网关…");
  }
  if (Date.now() - startedAt > TIMEOUT_MS) {
    clearInterval(pollTimer);
    showSpinner(false);
    setStatus("登录超时。请检查网络、前置站点或账号密码。", "err");
    setStep("login", "error");
  }
}

async function onSetup() {
  const api = await waitApi(1500);
  if (api && typeof api.open_account_setup === "function") {
    await api.open_account_setup();
    return;
  }
  location.href = "/setup.html?mode=settings";
}

function onRetry() {
  startedAt = Date.now();
  readySince = 0;
  waitHintShown = false;
  entered = false;
  showSpinner(true);
  setStep("front", "pending");
  setStep("login", "pending");
  setStep("funds", "pending");
  setStatus("正在重新检查登录状态…");
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, POLL_MS);
  poll();
}

function wireActions() {
  $("btn-setup")?.addEventListener("click", onSetup);
  $("btn-retry")?.addEventListener("click", onRetry);
  $("btn-enter")?.addEventListener("click", () => enterBrowseMode());
}

function boot() {
  wireActions();

  if (location.protocol === "file:") {
    setStatus("正在连接本地网关，请稍候…（稍后会自动跳转）");
    setStep("gateway", "active");
    const enterBtn = $("btn-enter");
    if (enterBtn) {
      enterBtn.disabled = true;
      enterBtn.title = "请等待网关就绪后再进入";
    }
    return;
  }

  setStep("gateway", "done");
  pollTimer = setInterval(poll, POLL_MS);
  poll();
}

document.addEventListener("DOMContentLoaded", boot);
