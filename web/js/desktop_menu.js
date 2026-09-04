/**
 * desktop_menu.js — 桌面版顶栏「文件 / 帮助」菜单（替代原生 Windows 菜单栏）
 */
import { openAboutDialog } from "./about.js";

function toast(text) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = text;
  t.style.display = "block";
  setTimeout(() => { t.style.display = "none"; }, 3000);
}

async function waitForDesktopApi() {
  if (window.pywebview?.api) return window.pywebview.api;
  return new Promise((resolve) => {
    const done = () => resolve(window.pywebview?.api || null);
    if (window.pywebview?.api) {
      done();
      return;
    }
    window.addEventListener("pywebviewready", done, { once: true });
    setTimeout(done, 4000);
  });
}

async function isDesktopApp() {
  const api = await waitForDesktopApi();
  if (!api?.get_app_info) return false;
  try {
    const info = JSON.parse(await api.get_app_info());
    return !!info.desktop;
  } catch {
    return false;
  }
}

function closeAllMenus() {
  document.querySelectorAll(".header-menu-drop").forEach((el) => { el.hidden = true; });
  document.querySelectorAll(".header-menu-btn").forEach((btn) => {
    btn.setAttribute("aria-expanded", "false");
  });
}

function toggleMenu(btn, drop) {
  const open = drop.hidden;
  closeAllMenus();
  if (open) {
    drop.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  }
}

async function runDesktopAction(action, api) {
  closeAllMenus();
  switch (action) {
    case "reload":
      if (window.__fgSoftRefresh) window.__fgSoftRefresh();
      else location.reload();
      break;
    case "hide-tray":
      if (api?.hide_to_tray) {
        const raw = await api.hide_to_tray();
        const result = JSON.parse(raw);
        if (!result.ok) toast(result.msg || "无法隐藏到托盘");
      }
      break;
    case "quit":
      if (api?.quit_app) await api.quit_app();
      break;
    case "about":
      openAboutDialog();
      break;
    case "check-update":
      if (api?.check_for_updates) {
        toast("正在检查更新…");
        try {
          const raw = await api.check_for_updates();
          const result = JSON.parse(raw);
          toast(result.msg || (result.ok ? "完成" : "失败"));
        } catch (err) {
          toast(String(err));
        }
      }
      break;
    case "export-diagnostics":
      if (api?.export_diagnostics) {
        toast("正在导出诊断包…");
        try {
          const raw = await api.export_diagnostics();
          const result = JSON.parse(raw);
          toast(result.msg || (result.ok ? "完成" : "失败"));
        } catch (err) {
          toast(String(err));
        }
      }
      break;
    case "account-setup":
      if (api?.open_account_setup) {
        try {
          const raw = await api.open_account_setup();
          const result = JSON.parse(raw);
          toast(result.msg || (result.ok ? "已打开" : "失败"));
        } catch (err) {
          toast(String(err));
        }
      }
      break;
    case "uninstall":
      if (!confirm("确定要卸载期界吗？\n\n卸载程序启动后，本程序将退出。")) return;
      if (api?.uninstall_app) {
        try {
          const raw = await api.uninstall_app();
          const result = JSON.parse(raw);
          toast(result.msg || "正在启动卸载…");
        } catch (err) {
          toast(String(err));
        }
      }
      break;
    default:
      break;
  }
}

export async function initDesktopMenu() {
  if (!(await isDesktopApp())) return;

  const menus = document.getElementById("desktop-menus");
  const reloadBtn = document.getElementById("reload-btn");
  const aboutBtn = document.getElementById("about-btn");
  if (menus) menus.hidden = false;
  if (reloadBtn) reloadBtn.hidden = true;
  if (aboutBtn) aboutBtn.hidden = true;

  const api = await waitForDesktopApi();

  document.getElementById("menu-file-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu(e.currentTarget, document.getElementById("menu-file-drop"));
  });
  document.getElementById("menu-help-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu(e.currentTarget, document.getElementById("menu-help-drop"));
  });

  document.querySelectorAll(".header-menu-item").forEach((item) => {
    item.addEventListener("click", () => {
      runDesktopAction(item.getAttribute("data-action"), api);
    });
  });

  document.addEventListener("click", closeAllMenus);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllMenus();
  });
}
