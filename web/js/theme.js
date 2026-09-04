/**
 * theme.js — 深/浅色切换（localStorage 记忆，顶栏按钮）
 */
const STORAGE_KEY = "ftd-theme";

export function effectiveDark() {
  const forced = document.documentElement.dataset.theme;
  if (forced === "dark") return true;
  if (forced === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Sync Windows native title bar with app theme (desktop only). */
async function syncNativeTitlebar() {
  const api = window.pywebview?.api;
  if (!api?.set_titlebar_theme) return;
  try {
    await api.set_titlebar_theme(effectiveDark());
  } catch {
    /* not in desktop shell */
  }
}

/** @param {"system"|"light"|"dark"} theme */
export function applyTheme(theme) {
  if (theme === "system") {
    delete document.documentElement.dataset.theme;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* private mode */
    }
  } else {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* private mode */
    }
  }
  document.documentElement.style.colorScheme = effectiveDark() ? "dark" : "light";
  updateThemeButton();
  syncNativeTitlebar();
  window.dispatchEvent(new CustomEvent("theme-change"));
}

export function initTheme() {
  const fromUrl = new URLSearchParams(location.search).get("theme");
  if (fromUrl === "dark" || fromUrl === "light") {
    applyTheme(fromUrl);
    return;
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") {
      applyTheme(saved);
      return;
    }
  } catch {
    /* ignore */
  }
  applyTheme("system");
}

export function toggleTheme() {
  applyTheme(effectiveDark() ? "light" : "dark");
}

export function updateThemeButton() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const dark = effectiveDark();
  btn.textContent = dark ? "浅色" : "深色";
  btn.title = dark ? "切换到浅色主题" : "切换到深色主题";
  btn.setAttribute("aria-pressed", dark ? "true" : "false");
}

if (typeof window !== "undefined") {
  window.addEventListener("pywebviewready", () => {
    syncNativeTitlebar();
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!document.documentElement.dataset.theme) {
      document.documentElement.style.colorScheme = effectiveDark() ? "dark" : "light";
      updateThemeButton();
      syncNativeTitlebar();
      window.dispatchEvent(new CustomEvent("theme-change"));
    }
  });
}
