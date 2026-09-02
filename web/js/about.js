/**
 * about.js — 「关于」对话框（浏览器 + 桌面版共用）
 */
let aboutLoaded = false;

function $(sel) {
  return document.querySelector(sel);
}

async function fetchAppInfo() {
  try {
    const res = await fetch("/api/app-info");
    if (res.ok) return await res.json();
  } catch (_) {
    /* gateway not ready yet */
  }
  if (window.pywebview && window.pywebview.api) {
    await new Promise((resolve) => {
      if (window.pywebview.api) resolve();
      else window.addEventListener("pywebviewready", resolve, { once: true });
    });
    return JSON.parse(await window.pywebview.api.get_app_info());
  }
  return { desktop: false, version: "—", github: "https://github.com/shibusama/futures-gateway" };
}

function setAboutStatus(text, kind) {
  const el = $("#about-status");
  if (!el) return;
  el.textContent = text || "";
  el.className = "about-status" + (kind ? " " + kind : "");
}

export async function openAboutDialog() {
  const dlg = $("#about-dialog");
  if (!dlg) return;
  dlg.hidden = false;

  if (!aboutLoaded) {
    const info = await fetchAppInfo();
    $("#about-version").textContent = info.version || "—";
    const link = $("#about-github");
    link.href = info.github || "https://github.com/shibusama/futures-gateway";
    link.textContent = info.github || "GitHub";
    const desktopActions = $("#about-desktop-actions");
    if (desktopActions) desktopActions.hidden = !info.desktop;
    aboutLoaded = true;
  }
  setAboutStatus("");
}

export function closeAboutDialog() {
  const dlg = $("#about-dialog");
  if (dlg) dlg.hidden = true;
}

export function bindAboutDialog() {
  $("#about-btn")?.addEventListener("click", () => openAboutDialog());
  $("#about-close")?.addEventListener("click", () => closeAboutDialog());
  $("#about-backdrop")?.addEventListener("click", () => closeAboutDialog());
  $("#about-check-update")?.addEventListener("click", async () => {
    if (!window.pywebview?.api?.check_for_updates) {
      window.open("https://github.com/shibusama/futures-gateway/releases", "_blank");
      return;
    }
    setAboutStatus("正在检查更新…", "wait");
    try {
      const raw = await window.pywebview.api.check_for_updates();
      const result = JSON.parse(raw);
      setAboutStatus(result.msg || (result.ok ? "完成" : "失败"), result.ok ? "ok" : "err");
    } catch (err) {
      setAboutStatus(String(err), "err");
    }
  });
  $("#about-setup")?.addEventListener("click", async () => {
    if (!window.pywebview?.api?.open_account_setup) return;
    setAboutStatus("正在打开账号配置…", "wait");
    try {
      const raw = await window.pywebview.api.open_account_setup();
      const result = JSON.parse(raw);
      setAboutStatus(result.msg || "", result.ok ? "ok" : "err");
    } catch (err) {
      setAboutStatus(String(err), "err");
    }
  });
  $("#about-export")?.addEventListener("click", async () => {
    if (!window.pywebview?.api?.export_diagnostics) return;
    setAboutStatus("正在导出诊断包…", "wait");
    try {
      const raw = await window.pywebview.api.export_diagnostics();
      const result = JSON.parse(raw);
      setAboutStatus(result.msg || "", result.ok ? "ok" : "err");
    } catch (err) {
      setAboutStatus(String(err), "err");
    }
  });
}
